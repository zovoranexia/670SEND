-- AlterTable
ALTER TABLE "shipment_settlements" ADD COLUMN     "addon_platform_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "courier_share_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "fleet_release_ledger_txn_id" UUID,
ADD COLUMN     "fleet_released_at" TIMESTAMPTZ(3),
ADD COLUMN     "pickup_courier_retained_usd" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "delivery_attempts" INTEGER NOT NULL DEFAULT 0;
