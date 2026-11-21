-- =============================================================================
-- 670Send — database-level integrity guards that Prisma cannot express.
-- Shipped as the second migration (after `init`) — see apps/api/prisma/README.md.
--
-- Philosophy: the API enforces every rule first (clear localized errors), and
-- the database refuses to store anything that breaks the money or compliance
-- invariants even if a future bug, script or admin console skips the API.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. IMMUTABILITY: ledger, audit trail and tracking timeline are append-only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is forbidden: table is append-only (immutable)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_transactions', 'audit_logs', 'shipment_events']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_immutable ON %1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_immutable BEFORE UPDATE OR DELETE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_no_truncate ON %1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_no_truncate BEFORE TRUNCATE ON %1$I
         FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. DOUBLE-ENTRY: every ledger transaction must net to exactly zero.
--    Deferred, so all entries of a transaction can be inserted before the check.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_ledger_transaction_balanced() RETURNS trigger AS $$
DECLARE
  net numeric(14,4);
BEGIN
  SELECT COALESCE(SUM(CASE entry_type WHEN 'CREDIT' THEN amount ELSE -amount END), 0)
    INTO net
    FROM ledger_entries
   WHERE transaction_id = NEW.transaction_id;

  IF net <> 0 THEN
    RAISE EXCEPTION 'Ledger transaction % is unbalanced (credits - debits = %)', NEW.transaction_id, net
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_entries_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_ledger_transaction_balanced();

ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ck_ledger_entries_amount_positive,
  DROP CONSTRAINT IF EXISTS ck_ledger_entries_balance_math;
ALTER TABLE ledger_entries
  ADD CONSTRAINT ck_ledger_entries_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT ck_ledger_entries_balance_math CHECK (
    (entry_type = 'CREDIT' AND balance_after = balance_before + amount) OR
    (entry_type = 'DEBIT'  AND balance_after = balance_before - amount)
  );

-- -----------------------------------------------------------------------------
-- 3. WALLETS
--    • Only EXTERNAL_CLEARING (money entering/leaving the system) may go negative.
--    • System wallets use the sentinel owner id 'SYSTEM' and vice versa.
-- -----------------------------------------------------------------------------
ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS ck_wallets_balance_non_negative,
  DROP CONSTRAINT IF EXISTS ck_wallets_locked_valid,
  DROP CONSTRAINT IF EXISTS ck_wallets_system_owner;
ALTER TABLE wallets
  ADD CONSTRAINT ck_wallets_balance_non_negative CHECK (wallet_type = 'EXTERNAL_CLEARING' OR balance >= 0),
  ADD CONSTRAINT ck_wallets_locked_valid CHECK (locked_balance >= 0 AND (wallet_type = 'EXTERNAL_CLEARING' OR locked_balance <= balance)),
  ADD CONSTRAINT ck_wallets_system_owner CHECK ((owner_type = 'SYSTEM') = (owner_id = 'SYSTEM'));

-- -----------------------------------------------------------------------------
-- 4. SHIPMENTS — money, weight and compliance gates
-- -----------------------------------------------------------------------------
ALTER TABLE shipments
  DROP CONSTRAINT IF EXISTS ck_shipments_fees_non_negative,
  DROP CONSTRAINT IF EXISTS ck_shipments_weight_valid,
  DROP CONSTRAINT IF EXISTS ck_shipments_prohibited_gate,
  DROP CONSTRAINT IF EXISTS ck_shipments_insurance_cap,
  DROP CONSTRAINT IF EXISTS ck_shipments_otp_attempts;
ALTER TABLE shipments
  ADD CONSTRAINT ck_shipments_fees_non_negative CHECK (
    base_shipping_fee_usd >= 0 AND pickup_addon_fee_usd >= 0 AND delivery_addon_fee_usd >= 0
    AND storage_penalty_usd >= 0 AND total_fee_usd >= 0 AND insurance_fee_usd >= 0
  ),
  ADD CONSTRAINT ck_shipments_weight_valid CHECK (
    actual_weight_kg > 0 AND chargeable_weight_kg >= 1 AND chargeable_weight_kg <= 500
    AND length_cm > 0 AND width_cm > 0 AND height_cm > 0
  ),
  -- A shipment can never be stored without the explicit prohibited-items confirmation.
  ADD CONSTRAINT ck_shipments_prohibited_gate CHECK (prohibited_check_passed = true),
  ADD CONSTRAINT ck_shipments_insurance_cap CHECK (
    (is_insured = false AND insurance_fee_usd = 0)
    OR (is_insured = true AND declared_value_usd IS NOT NULL AND insured_amount_usd IS NOT NULL
        AND insured_amount_usd <= 500 AND insurance_fee_usd >= 1)
  ),
  ADD CONSTRAINT ck_shipments_otp_attempts CHECK (pickup_otp_attempts >= 0);

-- Oecusse (RAEOA) & Ataúro: land transit is FORBIDDEN. Sea manifest only — to avoid
-- cross-border customs violations through Indonesian (NTT) territory.
CREATE OR REPLACE FUNCTION enforce_sea_route_rule_shipments() RETURNS trigger AS $$
DECLARE
  sea boolean;
BEGIN
  SELECT COALESCE(bool_or(is_sea_route), false) INTO sea
    FROM municipalities
   WHERE id IN (NEW.origin_municipality_id, NEW.dest_municipality_id);

  IF sea AND NEW.transport_canal <> 'SEA_FERRY_CARGO' THEN
    RAISE EXCEPTION 'SEA_ROUTE_BUS_FORBIDDEN: shipments to/from Oecusse or Ataúro must use SEA_FERRY_CARGO'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT sea AND NEW.transport_canal = 'SEA_FERRY_CARGO' THEN
    RAISE EXCEPTION 'SEA_FERRY_CARGO is only valid for routes touching Oecusse or Ataúro'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipments_sea_route ON shipments;
CREATE TRIGGER trg_shipments_sea_route
  BEFORE INSERT OR UPDATE OF origin_municipality_id, dest_municipality_id, transport_canal ON shipments
  FOR EACH ROW EXECUTE FUNCTION enforce_sea_route_rule_shipments();

-- Cron-friendly partial index for the daily unclaimed-parcel sweep.
CREATE INDEX IF NOT EXISTS ix_shipments_unclaimed
  ON shipments (arrived_dest_at)
  WHERE status = 'ARRIVED_AT_DEST_AGENT';

-- -----------------------------------------------------------------------------
-- 5. MANIFESTS — sea rule, vehicle/canal consistency, one-of item reference
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_manifest_rules() RETURNS trigger AS $$
DECLARE
  sea boolean;
  v_type text;
BEGIN
  SELECT (m.is_sea_route OR h.type = 'PORT') INTO sea
    FROM municipalities m, hubs h
   WHERE m.id = NEW.dest_municipality_id AND h.id = NEW.origin_hub_id;

  SELECT vehicle_type::text INTO v_type FROM vehicles WHERE id = NEW.vehicle_id;

  IF COALESCE(sea, false) AND NEW.transport_canal <> 'SEA_FERRY_CARGO' THEN
    RAISE EXCEPTION 'SEA_ROUTE_BUS_FORBIDDEN: manifests touching Oecusse/Ataúro must be SEA_FERRY_CARGO'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.transport_canal = 'SEA_FERRY_CARGO' AND v_type <> 'SEA_FERRY' THEN
    RAISE EXCEPTION 'SEA_FERRY_CARGO manifests require a SEA_FERRY vehicle' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.transport_canal = 'BUS_BAGGAGE' AND v_type <> 'BUS_PASSENGER' THEN
    RAISE EXCEPTION 'BUS_BAGGAGE manifests require a BUS_PASSENGER vehicle' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.transport_canal = 'CARGO_TRUCK_PICKUP' AND v_type NOT IN ('PICKUP_CARGO', 'TRUCK_CARGO') THEN
    RAISE EXCEPTION 'CARGO_TRUCK_PICKUP manifests require a PICKUP_CARGO or TRUCK_CARGO vehicle' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.transport_canal = 'SEA_FERRY_CARGO' AND NEW.status NOT IN ('DRAFT', 'CANCELLED') AND NEW.port_manifest_no IS NULL THEN
    RAISE EXCEPTION 'Official port cargo manifest number is required before dispatch' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('HANDED_OVER', 'IN_TRANSIT') AND NEW.baggage_photo_url IS NULL AND NEW.transport_canal = 'BUS_BAGGAGE' THEN
    RAISE EXCEPTION 'Baggage compartment placement photo is required before a bus trip departs' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_manifests_rules ON manifests;
CREATE TRIGGER trg_manifests_rules
  BEFORE INSERT OR UPDATE ON manifests
  FOR EACH ROW EXECUTE FUNCTION enforce_manifest_rules();

ALTER TABLE manifest_items DROP CONSTRAINT IF EXISTS ck_manifest_items_one_ref;
ALTER TABLE manifest_items
  ADD CONSTRAINT ck_manifest_items_one_ref CHECK ((master_bag_id IS NULL) <> (shipment_id IS NULL));

-- -----------------------------------------------------------------------------
-- 6. FINANCE
-- -----------------------------------------------------------------------------
ALTER TABLE deposit_requests DROP CONSTRAINT IF EXISTS ck_deposit_requests_one_owner, DROP CONSTRAINT IF EXISTS ck_deposit_requests_amount;
ALTER TABLE deposit_requests
  ADD CONSTRAINT ck_deposit_requests_one_owner CHECK ((agent_id IS NULL) <> (courier_id IS NULL)),
  ADD CONSTRAINT ck_deposit_requests_amount CHECK (amount_usd > 0);

ALTER TABLE shipment_settlements DROP CONSTRAINT IF EXISTS ck_settlement_non_negative;
ALTER TABLE shipment_settlements
  ADD CONSTRAINT ck_settlement_non_negative CHECK (
    base_fee_usd >= 0 AND fleet_share_usd >= 0 AND platform_share_usd >= 0 AND origin_share_usd >= 0
    AND dest_share_usd >= 0 AND claim_reserve_usd >= 0
    AND fleet_share_usd + platform_share_usd + origin_share_usd + dest_share_usd + claim_reserve_usd = base_fee_usd
  );

ALTER TABLE fleet_payouts DROP CONSTRAINT IF EXISTS ck_fleet_payouts_math;
ALTER TABLE fleet_payouts
  ADD CONSTRAINT ck_fleet_payouts_math CHECK (
    gross_amount_usd >= 0 AND claim_deduction_usd >= 0 AND net_amount_usd = gross_amount_usd - claim_deduction_usd
    AND period_end > period_start
  );

-- A shipment's fleet earning can be paid out only once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_payout_items_earning_once
  ON fleet_payout_items (shipment_id) WHERE kind = 'EARNING';

ALTER TABLE claims DROP CONSTRAINT IF EXISTS ck_claims_amounts;
ALTER TABLE claims
  ADD CONSTRAINT ck_claims_amounts CHECK (
    requested_amount_usd > 0 AND max_eligible_liability_usd >= 0
    AND (approved_amount_usd IS NULL OR (approved_amount_usd >= 0 AND approved_amount_usd <= max_eligible_liability_usd))
    AND recovered_amount_usd >= 0
  );

-- -----------------------------------------------------------------------------
-- 7. PRICING & ASSETS
-- -----------------------------------------------------------------------------
ALTER TABLE pricing_zones DROP CONSTRAINT IF EXISTS ck_pricing_zones_rates;
ALTER TABLE pricing_zones
  ADD CONSTRAINT ck_pricing_zones_rates CHECK (
    doc_rate_usd >= 0 AND small_base_2kg_usd >= 0 AND extra_per_kg_usd >= 0
    AND cargo_base_10kg_usd >= 0 AND cargo_extra_per_kg_usd >= 0
  );

ALTER TABLE addon_tariffs DROP CONSTRAINT IF EXISTS ck_addon_tariffs_split;
ALTER TABLE addon_tariffs
  ADD CONSTRAINT ck_addon_tariffs_split CHECK (
    fee_usd >= 0 AND courier_split_pct >= 0 AND platform_split_pct >= 0
    AND courier_split_pct + platform_split_pct = 100
  );

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS ck_vehicles_slots;
ALTER TABLE vehicles ADD CONSTRAINT ck_vehicles_slots CHECK (max_parcel_slots > 0);
