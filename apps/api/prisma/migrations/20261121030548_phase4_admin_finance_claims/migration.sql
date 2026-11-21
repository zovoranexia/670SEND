-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PhotoType" ADD VALUE 'DEPOSIT_PROOF';
ALTER TYPE "PhotoType" ADD VALUE 'CLAIM_EVIDENCE';

-- AlterTable
ALTER TABLE "claims" ADD COLUMN     "late_filing_reason" TEXT,
ADD COLUMN     "paid_from_escrow_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "paid_from_insurance_usd" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "payout_reference" TEXT,
ADD COLUMN     "resolution_notes" TEXT;

-- AlterTable
ALTER TABLE "fleet_payouts" ADD COLUMN     "auto_generated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "paid_by" UUID,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "shipment_settlements" ADD COLUMN     "addon_refund_txn_id" UUID,
ADD COLUMN     "addon_refunded_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "rts_collector_id_number" TEXT,
ADD COLUMN     "rts_collector_name" TEXT,
ADD COLUMN     "rts_handed_back_at" TIMESTAMPTZ(3),
ADD COLUMN     "rts_received_at" TIMESTAMPTZ(3);
