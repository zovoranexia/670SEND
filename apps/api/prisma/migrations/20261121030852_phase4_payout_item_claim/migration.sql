-- AlterTable
ALTER TABLE "fleet_payout_items" ADD COLUMN     "claim_id" UUID;

-- CreateIndex
CREATE INDEX "fleet_payout_items_claim_id_idx" ON "fleet_payout_items"("claim_id");
