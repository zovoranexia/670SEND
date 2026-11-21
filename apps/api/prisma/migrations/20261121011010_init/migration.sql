-- CreateEnum
CREATE TYPE "LanguageCode" AS ENUM ('TET', 'PT', 'EN', 'ID');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "RouteCorridor" AS ENUM ('LOCAL', 'EAST', 'SOUTH', 'WEST', 'SEA');

-- CreateEnum
CREATE TYPE "HubType" AS ENUM ('TERMINAL', 'PORT', 'REGIONAL');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('BUS_PASSENGER', 'PICKUP_CARGO', 'TRUCK_CARGO', 'SEA_FERRY');

-- CreateEnum
CREATE TYPE "CourierVehicleType" AS ENUM ('MOTORBIKE', 'PICKUP');

-- CreateEnum
CREATE TYPE "PayoutCycle" AS ENUM ('DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "FleetPayoutChannel" AS ENUM ('BNCTL', 'BNU', 'MANDIRI', 'BRI', 'MOSAN', 'TPAY');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('BNCTL', 'BNU', 'MANDIRI', 'BRI', 'MOSAN', 'TPAY', 'CASH');

-- CreateEnum
CREATE TYPE "AddonServiceType" AS ENUM ('MOTOR_PICKUP', 'MOTOR_DELIVERY', 'CARGO_PICKUP', 'CARGO_DELIVERY');

-- CreateEnum
CREATE TYPE "ServiceScheme" AS ENUM ('SCHEME_A', 'SCHEME_B', 'SCHEME_C', 'SCHEME_D');

-- CreateEnum
CREATE TYPE "TransportCanal" AS ENUM ('BUS_BAGGAGE', 'CARGO_TRUCK_PICKUP', 'SEA_FERRY_CARGO');

-- CreateEnum
CREATE TYPE "IntakeChannel" AS ENUM ('AGENT_DROP_OFF', 'COURIER_PICKUP', 'HUB_DESK');

-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('BI', 'KARTAUN_ELEITORAL', 'PASSPORT');

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('DOCUMENT', 'GENERAL', 'CLOTHING', 'ELECTRONICS', 'LIQUID', 'FOOD', 'OTHER');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PICKUP_ASSIGNED', 'DROPPED_AT_ORIGIN', 'CONSOLIDATED_AT_HUB', 'IN_TRANSIT', 'ARRIVED_AT_DEST_AGENT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD_ISSUE', 'RETURN_TO_SENDER');

-- CreateEnum
CREATE TYPE "PhotoType" AS ENUM ('OPEN_BOX_CONTENT', 'SEALED_PARCEL', 'BAGGAGE_PLACEMENT', 'INBOUND_INCIDENT', 'PROOF_OF_DELIVERY');

-- CreateEnum
CREATE TYPE "PickupBookingStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'PICKED_UP', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MasterBagStatus" AS ENUM ('OPEN', 'SEALED', 'DISPATCHED', 'RECEIVED', 'DISCREPANCY');

-- CreateEnum
CREATE TYPE "ManifestStatus" AS ENUM ('DRAFT', 'READY', 'HANDED_OVER', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'DISCREPANCY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InboundCondition" AS ENUM ('INTACT', 'DAMAGED_SEAL', 'WET', 'MISSING');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLAIM_FILED');

-- CreateEnum
CREATE TYPE "WalletOwnerType" AS ENUM ('USER', 'AGENT', 'COURIER', 'FLEET_OWNER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('DEPOSIT', 'COMMISSION', 'FLEET_PAYABLE', 'COURIER_EARNINGS', 'PLATFORM_REVENUE', 'PLATFORM_HUB_OPS', 'CLAIM_ESCROW_RESERVE', 'INSURANCE_POOL', 'PENDING_SETTLEMENT', 'EXTERNAL_CLEARING');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "LedgerReferenceType" AS ENUM ('SHIPMENT_INTAKE', 'ORIGIN_COMMISSION', 'DEST_COMMISSION', 'FLEET_SHARE', 'COURIER_ADDON_SHARE', 'ESCROW_ALLOCATION', 'INSURANCE_PREMIUM', 'STORAGE_PENALTY', 'CLAIM_PAYOUT', 'FLEET_PAYOUT', 'DEPOSIT_TOPUP', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OriginShareMode" AS ENUM ('AGENT_CASH_RETAINED', 'HUB_OPS');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('HELD', 'RELEASED', 'REVERSED');

-- CreateEnum
CREATE TYPE "DepositRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FleetPayoutStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutItemKind" AS ENUM ('EARNING', 'CLAIM_DEDUCTION');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('LOST', 'DAMAGED', 'SEAL_TAMPERED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "LiableParty" AS ENUM ('FLEET_PARTNER', 'ORIGIN_AGENT', 'DEST_AGENT', 'COURIER', 'PLATFORM_ESCROW');

-- CreateEnum
CREATE TYPE "NotificationEventCode" AS ENUM ('PICKUP_ASSIGNED', 'DROPPED_AT_ORIGIN', 'CONSOLIDATED_AT_HUB', 'IN_TRANSIT', 'ARRIVED_AT_DEST_AGENT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD_ISSUE', 'RETURN_TO_SENDER', 'STORAGE_REMINDER_DAY3', 'STORAGE_REMINDER_DAY5');

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('SENDER', 'RECIPIENT');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "pin_hash" TEXT,
    "preferred_lang" "LanguageCode" NOT NULL DEFAULT 'TET',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "failed_pin_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "actor_roles" TEXT[],
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_code" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "municipalities" (
    "id" UUID NOT NULL,
    "code" VARCHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "main_town" TEXT NOT NULL,
    "corridor" "RouteCorridor" NOT NULL,
    "zone_id" UUID,
    "is_sea_route" BOOLEAN NOT NULL DEFAULT false,
    "tariff_surcharge_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "serving_hub_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "municipalities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubs" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HubType" NOT NULL,
    "corridor" "RouteCorridor" NOT NULL,
    "municipality_id" UUID NOT NULL,
    "address" TEXT,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "municipality_id" UUID NOT NULL,
    "agent_code" TEXT NOT NULL,
    "kiosk_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "opening_hours" TEXT,
    "has_digital_scale" BOOLEAN NOT NULL DEFAULT false,
    "has_secure_storage" BOOLEAN NOT NULL DEFAULT false,
    "adendum_signed_at" TIMESTAMPTZ(3),
    "external_670link_agent_id" TEXT,
    "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING',
    "status_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_partners" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "serve_reg_no" TEXT,
    "mou_number" TEXT,
    "mou_signed_at" DATE,
    "mou_valid_until" DATE,
    "mou_document_url" TEXT,
    "mou_auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "payout_cycle" "PayoutCycle" NOT NULL DEFAULT 'WEEKLY',
    "payout_channel" "FleetPayoutChannel" NOT NULL,
    "bank_account_details" JSONB,
    "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING',
    "status_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "fleet_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "fleet_partner_id" UUID NOT NULL,
    "plate_number" TEXT NOT NULL,
    "vehicle_type" "VehicleType" NOT NULL,
    "route_corridor" "RouteCorridor" NOT NULL,
    "max_parcel_slots" INTEGER NOT NULL DEFAULT 20,
    "dntt_permit_no" TEXT,
    "dntt_permit_expiry" DATE,
    "kir_expiry" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "fleet_partner_id" UUID NOT NULL,
    "license_number" TEXT NOT NULL,
    "license_expiry" DATE,
    "phone" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "couriers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "hub_id" UUID,
    "municipality_id" UUID NOT NULL,
    "vehicle_type" "CourierVehicleType" NOT NULL,
    "plate_number" TEXT,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_zones" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_tet" TEXT NOT NULL,
    "name_pt" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_id" TEXT NOT NULL,
    "doc_rate_usd" DECIMAL(14,4) NOT NULL,
    "small_base_2kg_usd" DECIMAL(14,4) NOT NULL,
    "extra_per_kg_usd" DECIMAL(14,4) NOT NULL,
    "cargo_base_10kg_usd" DECIMAL(14,4) NOT NULL,
    "cargo_extra_per_kg_usd" DECIMAL(14,4) NOT NULL,
    "eta_tet" TEXT NOT NULL,
    "eta_pt" TEXT NOT NULL,
    "eta_en" TEXT NOT NULL,
    "eta_id" TEXT NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pricing_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_tariffs" (
    "id" UUID NOT NULL,
    "service_type" "AddonServiceType" NOT NULL,
    "label_tet" TEXT NOT NULL,
    "label_pt" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "fee_usd" DECIMAL(14,4) NOT NULL,
    "courier_split_pct" DECIMAL(5,2) NOT NULL,
    "platform_split_pct" DECIMAL(5,2) NOT NULL,
    "max_weight_kg" INTEGER,
    "radius_km" INTEGER,
    "wholesale_min_parcels" INTEGER NOT NULL DEFAULT 3,
    "wholesale_free_pickup" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addon_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "waybill_number" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "service_scheme" "ServiceScheme" NOT NULL,
    "transport_canal" "TransportCanal" NOT NULL,
    "intake_channel" "IntakeChannel" NOT NULL,
    "origin_municipality_id" UUID NOT NULL,
    "dest_municipality_id" UUID NOT NULL,
    "origin_agent_id" UUID,
    "dest_agent_id" UUID,
    "origin_hub_id" UUID,
    "pickup_courier_id" UUID,
    "delivery_courier_id" UUID,
    "pickup_booking_id" UUID,
    "created_by_id" UUID NOT NULL,
    "sender_name" TEXT NOT NULL,
    "sender_id_type" "IdType" NOT NULL,
    "sender_id_number" TEXT NOT NULL,
    "sender_phone" TEXT NOT NULL,
    "sender_lang" "LanguageCode" NOT NULL DEFAULT 'TET',
    "sender_address" TEXT,
    "recipient_name" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "recipient_lang" "LanguageCode" NOT NULL DEFAULT 'TET',
    "recipient_address" TEXT,
    "item_description" TEXT NOT NULL,
    "item_category" "ItemCategory" NOT NULL DEFAULT 'GENERAL',
    "is_fragile" BOOLEAN NOT NULL DEFAULT false,
    "is_heavy_bulk" BOOLEAN NOT NULL DEFAULT false,
    "is_short_shelf_life" BOOLEAN NOT NULL DEFAULT false,
    "prohibited_check_passed" BOOLEAN NOT NULL,
    "prohibited_checklist" JSONB NOT NULL,
    "prohibited_check_lang" "LanguageCode" NOT NULL DEFAULT 'TET',
    "prohibited_checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declared_value_usd" DECIMAL(14,4),
    "is_insured" BOOLEAN NOT NULL DEFAULT false,
    "insured_amount_usd" DECIMAL(14,4),
    "insurance_fee_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "actual_weight_kg" DECIMAL(8,3) NOT NULL,
    "length_cm" DECIMAL(7,2) NOT NULL,
    "width_cm" DECIMAL(7,2) NOT NULL,
    "height_cm" DECIMAL(7,2) NOT NULL,
    "volumetric_weight_kg" DECIMAL(8,3) NOT NULL,
    "chargeable_weight_kg" INTEGER NOT NULL,
    "is_document_tier" BOOLEAN NOT NULL DEFAULT false,
    "base_shipping_fee_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "pickup_addon_fee_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "delivery_addon_fee_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "storage_penalty_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "total_fee_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "pricing_snapshot" JSONB NOT NULL,
    "seal_code" TEXT,
    "pickup_otp_hash" TEXT,
    "pickup_otp_expires_at" TIMESTAMPTZ(3),
    "pickup_otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "pickup_otp_locked_until" TIMESTAMPTZ(3),
    "status" "ShipmentStatus" NOT NULL,
    "status_before_hold" "ShipmentStatus",
    "hold_reason" TEXT,
    "arrived_dest_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "collector_name" TEXT,
    "collector_id_type" "IdType",
    "collector_id_number" TEXT,
    "collected_by_representative" BOOLEAN NOT NULL DEFAULT false,
    "storage_reminder_day3_sent_at" TIMESTAMPTZ(3),
    "storage_reminder_day5_sent_at" TIMESTAMPTZ(3),
    "rts_flagged_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_photos" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "photo_type" "PhotoType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "sha256" TEXT,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "from_status" "ShipmentStatus",
    "status" "ShipmentStatus" NOT NULL,
    "location_label" TEXT,
    "notes" TEXT,
    "actor_id" UUID,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_bookings" (
    "id" UUID NOT NULL,
    "batch_code" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "sender_phone" TEXT NOT NULL,
    "sender_info" JSONB NOT NULL,
    "preferred_lang" "LanguageCode" NOT NULL DEFAULT 'TET',
    "service_scheme" "ServiceScheme" NOT NULL DEFAULT 'SCHEME_B',
    "dest_municipality_id" UUID,
    "parcel_count" INTEGER NOT NULL DEFAULT 1,
    "estimated_weight_kg" DECIMAL(8,3),
    "pickup_address" TEXT NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "notes" TEXT,
    "phone_verified_at" TIMESTAMPTZ(3),
    "assigned_courier_id" UUID,
    "assigned_at" TIMESTAMPTZ(3),
    "status" "PickupBookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pickup_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waybill_sequences" (
    "origin_code" VARCHAR(3) NOT NULL,
    "dest_code" VARCHAR(3) NOT NULL,
    "date_key" VARCHAR(6) NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waybill_sequences_pkey" PRIMARY KEY ("origin_code","dest_code","date_key")
);

-- CreateTable
CREATE TABLE "master_bags" (
    "id" UUID NOT NULL,
    "bag_code" TEXT NOT NULL,
    "plastic_seal_number" TEXT,
    "origin_hub_id" UUID NOT NULL,
    "dest_municipality_id" UUID NOT NULL,
    "status" "MasterBagStatus" NOT NULL DEFAULT 'OPEN',
    "created_by" UUID NOT NULL,
    "sealed_at" TIMESTAMPTZ(3),
    "dispatched_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "master_bags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_bag_items" (
    "master_bag_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "added_by" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_bag_items_pkey" PRIMARY KEY ("master_bag_id","shipment_id")
);

-- CreateTable
CREATE TABLE "manifests" (
    "id" UUID NOT NULL,
    "manifest_code" TEXT NOT NULL,
    "origin_hub_id" UUID NOT NULL,
    "dest_municipality_id" UUID NOT NULL,
    "transport_canal" "TransportCanal" NOT NULL,
    "fleet_partner_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "port_manifest_no" TEXT,
    "baggage_photo_url" TEXT,
    "parcel_count" INTEGER NOT NULL DEFAULT 0,
    "master_bag_count" INTEGER NOT NULL DEFAULT 0,
    "scheduled_departure_at" TIMESTAMPTZ(3),
    "dispatched_at" TIMESTAMPTZ(3),
    "arrived_at" TIMESTAMPTZ(3),
    "status" "ManifestStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifest_items" (
    "id" UUID NOT NULL,
    "manifest_id" UUID NOT NULL,
    "master_bag_id" UUID,
    "shipment_id" UUID,
    "inbound_condition" "InboundCondition",
    "inbound_at" TIMESTAMPTZ(3),
    "inbound_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manifest_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_incidents" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "manifest_id" UUID,
    "master_bag_id" UUID,
    "condition" "InboundCondition" NOT NULL,
    "notes" TEXT,
    "reported_by" UUID NOT NULL,
    "driver_id" UUID,
    "driver_confirmed_at" TIMESTAMPTZ(3),
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inbound_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "owner_type" "WalletOwnerType" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "wallet_type" "WalletType" NOT NULL,
    "balance" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "locked_balance" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "reference_type" "LedgerReferenceType" NOT NULL,
    "reference_id" TEXT,
    "idempotency_key" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "reference_type" "LedgerReferenceType" NOT NULL,
    "reference_id" TEXT,
    "amount" DECIMAL(14,4) NOT NULL,
    "balance_before" DECIMAL(14,4) NOT NULL,
    "balance_after" DECIMAL(14,4) NOT NULL,
    "description" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_settlements" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "fleet_partner_id" UUID,
    "base_fee_usd" DECIMAL(14,4) NOT NULL,
    "fleet_share_usd" DECIMAL(14,4) NOT NULL,
    "platform_share_usd" DECIMAL(14,4) NOT NULL,
    "origin_share_usd" DECIMAL(14,4) NOT NULL,
    "dest_share_usd" DECIMAL(14,4) NOT NULL,
    "claim_reserve_usd" DECIMAL(14,4) NOT NULL,
    "insurance_fee_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "origin_mode" "OriginShareMode" NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'HELD',
    "intake_ledger_txn_id" UUID,
    "release_ledger_txn_id" UUID,
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_requests" (
    "id" UUID NOT NULL,
    "agent_id" UUID,
    "courier_id" UUID,
    "amount_usd" DECIMAL(14,4) NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "reference_no" TEXT,
    "proof_url" TEXT,
    "note" TEXT,
    "status" "DepositRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "reject_reason" TEXT,
    "ledger_txn_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deposit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_payouts" (
    "id" UUID NOT NULL,
    "payout_no" TEXT NOT NULL,
    "fleet_partner_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "gross_amount_usd" DECIMAL(14,4) NOT NULL,
    "claim_deduction_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "net_amount_usd" DECIMAL(14,4) NOT NULL,
    "channel" "FleetPayoutChannel" NOT NULL,
    "bank_reference" TEXT,
    "statement_url" TEXT,
    "status" "FleetPayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "ledger_txn_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fleet_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_payout_items" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "kind" "PayoutItemKind" NOT NULL,
    "amount_usd" DECIMAL(14,4) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_payout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "claim_no" TEXT NOT NULL,
    "shipment_id" UUID NOT NULL,
    "filed_by" UUID NOT NULL,
    "claim_type" "ClaimType" NOT NULL,
    "description" TEXT,
    "claimant_name" TEXT,
    "claimant_phone" TEXT,
    "requested_amount_usd" DECIMAL(14,4) NOT NULL,
    "max_eligible_liability_usd" DECIMAL(14,4) NOT NULL,
    "approved_amount_usd" DECIMAL(14,4),
    "liable_party" "LiableParty",
    "evidence_urls" JSONB NOT NULL DEFAULT '[]',
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "finance_approved_by" UUID,
    "finance_approved_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "payout_ledger_txn_id" UUID,
    "paid_at" TIMESTAMPTZ(3),
    "recovered_in_payout_id" UUID,
    "recovered_amount_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "event_code" "NotificationEventCode" NOT NULL,
    "lang" "LanguageCode" NOT NULL,
    "body_template" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "shipment_id" UUID,
    "audience" "NotificationAudience" NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "event_code" "NotificationEventCode" NOT NULL,
    "lang" "LanguageCode" NOT NULL,
    "template_id" UUID,
    "rendered_body" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "delivery_status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "dedupe_key" TEXT,
    "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_is_active_deleted_at_idx" ON "users"("is_active", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "municipalities_code_key" ON "municipalities"("code");

-- CreateIndex
CREATE INDEX "municipalities_corridor_idx" ON "municipalities"("corridor");

-- CreateIndex
CREATE INDEX "municipalities_zone_id_idx" ON "municipalities"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "hubs_code_key" ON "hubs"("code");

-- CreateIndex
CREATE INDEX "hubs_municipality_id_idx" ON "hubs"("municipality_id");

-- CreateIndex
CREATE UNIQUE INDEX "agents_user_id_key" ON "agents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agents_agent_code_key" ON "agents"("agent_code");

-- CreateIndex
CREATE UNIQUE INDEX "agents_external_670link_agent_id_key" ON "agents"("external_670link_agent_id");

-- CreateIndex
CREATE INDEX "agents_municipality_id_status_idx" ON "agents"("municipality_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_partners_mou_number_key" ON "fleet_partners"("mou_number");

-- CreateIndex
CREATE INDEX "fleet_partners_owner_user_id_idx" ON "fleet_partners"("owner_user_id");

-- CreateIndex
CREATE INDEX "fleet_partners_status_mou_valid_until_idx" ON "fleet_partners"("status", "mou_valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_number_key" ON "vehicles"("plate_number");

-- CreateIndex
CREATE INDEX "vehicles_fleet_partner_id_is_active_idx" ON "vehicles"("fleet_partner_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- CreateIndex
CREATE INDEX "drivers_fleet_partner_id_is_active_idx" ON "drivers"("fleet_partner_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "couriers_user_id_key" ON "couriers"("user_id");

-- CreateIndex
CREATE INDEX "couriers_municipality_id_is_available_idx" ON "couriers"("municipality_id", "is_available");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_zones_code_key" ON "pricing_zones"("code");

-- CreateIndex
CREATE UNIQUE INDEX "addon_tariffs_service_type_key" ON "addon_tariffs"("service_type");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_waybill_number_key" ON "shipments"("waybill_number");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_idempotency_key_key" ON "shipments"("idempotency_key");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- CreateIndex
CREATE INDEX "shipments_dest_agent_id_status_idx" ON "shipments"("dest_agent_id", "status");

-- CreateIndex
CREATE INDEX "shipments_origin_agent_id_created_at_idx" ON "shipments"("origin_agent_id", "created_at");

-- CreateIndex
CREATE INDEX "shipments_pickup_courier_id_status_idx" ON "shipments"("pickup_courier_id", "status");

-- CreateIndex
CREATE INDEX "shipments_delivery_courier_id_status_idx" ON "shipments"("delivery_courier_id", "status");

-- CreateIndex
CREATE INDEX "shipments_status_arrived_dest_at_idx" ON "shipments"("status", "arrived_dest_at");

-- CreateIndex
CREATE INDEX "shipments_sender_phone_idx" ON "shipments"("sender_phone");

-- CreateIndex
CREATE INDEX "shipments_recipient_phone_idx" ON "shipments"("recipient_phone");

-- CreateIndex
CREATE INDEX "shipments_origin_municipality_id_dest_municipality_id_creat_idx" ON "shipments"("origin_municipality_id", "dest_municipality_id", "created_at");

-- CreateIndex
CREATE INDEX "shipments_created_at_idx" ON "shipments"("created_at");

-- CreateIndex
CREATE INDEX "shipment_photos_shipment_id_photo_type_idx" ON "shipment_photos"("shipment_id", "photo_type");

-- CreateIndex
CREATE INDEX "shipment_events_shipment_id_created_at_idx" ON "shipment_events"("shipment_id", "created_at");

-- CreateIndex
CREATE INDEX "shipment_events_status_created_at_idx" ON "shipment_events"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_bookings_batch_code_key" ON "pickup_bookings"("batch_code");

-- CreateIndex
CREATE INDEX "pickup_bookings_status_created_at_idx" ON "pickup_bookings"("status", "created_at");

-- CreateIndex
CREATE INDEX "pickup_bookings_assigned_courier_id_status_idx" ON "pickup_bookings"("assigned_courier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "master_bags_bag_code_key" ON "master_bags"("bag_code");

-- CreateIndex
CREATE UNIQUE INDEX "master_bags_plastic_seal_number_key" ON "master_bags"("plastic_seal_number");

-- CreateIndex
CREATE INDEX "master_bags_origin_hub_id_status_idx" ON "master_bags"("origin_hub_id", "status");

-- CreateIndex
CREATE INDEX "master_bags_dest_municipality_id_status_idx" ON "master_bags"("dest_municipality_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "master_bag_items_shipment_id_key" ON "master_bag_items"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "manifests_manifest_code_key" ON "manifests"("manifest_code");

-- CreateIndex
CREATE INDEX "manifests_fleet_partner_id_status_idx" ON "manifests"("fleet_partner_id", "status");

-- CreateIndex
CREATE INDEX "manifests_driver_id_status_idx" ON "manifests"("driver_id", "status");

-- CreateIndex
CREATE INDEX "manifests_origin_hub_id_dest_municipality_id_status_idx" ON "manifests"("origin_hub_id", "dest_municipality_id", "status");

-- CreateIndex
CREATE INDEX "manifest_items_shipment_id_idx" ON "manifest_items"("shipment_id");

-- CreateIndex
CREATE INDEX "manifest_items_master_bag_id_idx" ON "manifest_items"("master_bag_id");

-- CreateIndex
CREATE UNIQUE INDEX "manifest_items_manifest_id_master_bag_id_key" ON "manifest_items"("manifest_id", "master_bag_id");

-- CreateIndex
CREATE UNIQUE INDEX "manifest_items_manifest_id_shipment_id_key" ON "manifest_items"("manifest_id", "shipment_id");

-- CreateIndex
CREATE INDEX "inbound_incidents_shipment_id_idx" ON "inbound_incidents"("shipment_id");

-- CreateIndex
CREATE INDEX "inbound_incidents_status_created_at_idx" ON "inbound_incidents"("status", "created_at");

-- CreateIndex
CREATE INDEX "wallets_wallet_type_idx" ON "wallets"("wallet_type");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_owner_type_owner_id_wallet_type_key" ON "wallets"("owner_type", "owner_id", "wallet_type");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_key" ON "ledger_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_transactions_reference_type_reference_id_idx" ON "ledger_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_created_at_idx" ON "ledger_transactions"("created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_id_created_at_idx" ON "ledger_entries"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_reference_type_reference_id_idx" ON "ledger_entries"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_settlements_shipment_id_key" ON "shipment_settlements"("shipment_id");

-- CreateIndex
CREATE INDEX "shipment_settlements_status_idx" ON "shipment_settlements"("status");

-- CreateIndex
CREATE INDEX "shipment_settlements_fleet_partner_id_status_idx" ON "shipment_settlements"("fleet_partner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_requests_idempotency_key_key" ON "deposit_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "deposit_requests_status_created_at_idx" ON "deposit_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "deposit_requests_agent_id_status_idx" ON "deposit_requests"("agent_id", "status");

-- CreateIndex
CREATE INDEX "deposit_requests_courier_id_status_idx" ON "deposit_requests"("courier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_payouts_payout_no_key" ON "fleet_payouts"("payout_no");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_payouts_idempotency_key_key" ON "fleet_payouts"("idempotency_key");

-- CreateIndex
CREATE INDEX "fleet_payouts_fleet_partner_id_status_idx" ON "fleet_payouts"("fleet_partner_id", "status");

-- CreateIndex
CREATE INDEX "fleet_payouts_status_created_at_idx" ON "fleet_payouts"("status", "created_at");

-- CreateIndex
CREATE INDEX "fleet_payout_items_payout_id_idx" ON "fleet_payout_items"("payout_id");

-- CreateIndex
CREATE INDEX "fleet_payout_items_shipment_id_idx" ON "fleet_payout_items"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "claims_claim_no_key" ON "claims"("claim_no");

-- CreateIndex
CREATE INDEX "claims_shipment_id_idx" ON "claims"("shipment_id");

-- CreateIndex
CREATE INDEX "claims_status_created_at_idx" ON "claims"("status", "created_at");

-- CreateIndex
CREATE INDEX "claims_liable_party_status_idx" ON "claims"("liable_party", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_code_lang_key" ON "notification_templates"("event_code", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_dedupe_key_key" ON "notification_logs"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_logs_shipment_id_event_code_idx" ON "notification_logs"("shipment_id", "event_code");

-- CreateIndex
CREATE INDEX "notification_logs_delivery_status_created_at_idx" ON "notification_logs"("delivery_status", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_recipient_phone_idx" ON "notification_logs"("recipient_phone");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "municipalities" ADD CONSTRAINT "municipalities_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "pricing_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "municipalities" ADD CONSTRAINT "municipalities_serving_hub_id_fkey" FOREIGN KEY ("serving_hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubs" ADD CONSTRAINT "hubs_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "municipalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "municipalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_partners" ADD CONSTRAINT "fleet_partners_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_fleet_partner_id_fkey" FOREIGN KEY ("fleet_partner_id") REFERENCES "fleet_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_fleet_partner_id_fkey" FOREIGN KEY ("fleet_partner_id") REFERENCES "fleet_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "municipalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_municipality_id_fkey" FOREIGN KEY ("origin_municipality_id") REFERENCES "municipalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_dest_municipality_id_fkey" FOREIGN KEY ("dest_municipality_id") REFERENCES "municipalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_agent_id_fkey" FOREIGN KEY ("origin_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_dest_agent_id_fkey" FOREIGN KEY ("dest_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_hub_id_fkey" FOREIGN KEY ("origin_hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_pickup_courier_id_fkey" FOREIGN KEY ("pickup_courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_delivery_courier_id_fkey" FOREIGN KEY ("delivery_courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_pickup_booking_id_fkey" FOREIGN KEY ("pickup_booking_id") REFERENCES "pickup_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_photos" ADD CONSTRAINT "shipment_photos_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_photos" ADD CONSTRAINT "shipment_photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_bookings" ADD CONSTRAINT "pickup_bookings_dest_municipality_id_fkey" FOREIGN KEY ("dest_municipality_id") REFERENCES "municipalities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_bookings" ADD CONSTRAINT "pickup_bookings_assigned_courier_id_fkey" FOREIGN KEY ("assigned_courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_bags" ADD CONSTRAINT "master_bags_origin_hub_id_fkey" FOREIGN KEY ("origin_hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_bags" ADD CONSTRAINT "master_bags_dest_municipality_id_fkey" FOREIGN KEY ("dest_municipality_id") REFERENCES "municipalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_bag_items" ADD CONSTRAINT "master_bag_items_master_bag_id_fkey" FOREIGN KEY ("master_bag_id") REFERENCES "master_bags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_bag_items" ADD CONSTRAINT "master_bag_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_origin_hub_id_fkey" FOREIGN KEY ("origin_hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_dest_municipality_id_fkey" FOREIGN KEY ("dest_municipality_id") REFERENCES "municipalities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_fleet_partner_id_fkey" FOREIGN KEY ("fleet_partner_id") REFERENCES "fleet_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_items" ADD CONSTRAINT "manifest_items_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_items" ADD CONSTRAINT "manifest_items_master_bag_id_fkey" FOREIGN KEY ("master_bag_id") REFERENCES "master_bags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_items" ADD CONSTRAINT "manifest_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_incidents" ADD CONSTRAINT "inbound_incidents_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_incidents" ADD CONSTRAINT "inbound_incidents_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "manifests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_incidents" ADD CONSTRAINT "inbound_incidents_master_bag_id_fkey" FOREIGN KEY ("master_bag_id") REFERENCES "master_bags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_incidents" ADD CONSTRAINT "inbound_incidents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_settlements" ADD CONSTRAINT "shipment_settlements_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_settlements" ADD CONSTRAINT "shipment_settlements_fleet_partner_id_fkey" FOREIGN KEY ("fleet_partner_id") REFERENCES "fleet_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_payouts" ADD CONSTRAINT "fleet_payouts_fleet_partner_id_fkey" FOREIGN KEY ("fleet_partner_id") REFERENCES "fleet_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_payouts" ADD CONSTRAINT "fleet_payouts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_payouts" ADD CONSTRAINT "fleet_payouts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_payout_items" ADD CONSTRAINT "fleet_payout_items_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "fleet_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_payout_items" ADD CONSTRAINT "fleet_payout_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_filed_by_fkey" FOREIGN KEY ("filed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_finance_approved_by_fkey" FOREIGN KEY ("finance_approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_recovered_in_payout_id_fkey" FOREIGN KEY ("recovered_in_payout_id") REFERENCES "fleet_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
