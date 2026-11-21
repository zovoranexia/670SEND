-- CreateTable
CREATE TABLE "staged_uploads" (
    "id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "photo_type" "PhotoType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "consumed_at" TIMESTAMPTZ(3),
    "consumed_by_shipment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staged_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staged_uploads_uploaded_by_created_at_idx" ON "staged_uploads"("uploaded_by", "created_at");

-- CreateIndex
CREATE INDEX "staged_uploads_consumed_at_created_at_idx" ON "staged_uploads"("consumed_at", "created_at");

-- AddForeignKey
ALTER TABLE "staged_uploads" ADD CONSTRAINT "staged_uploads_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
