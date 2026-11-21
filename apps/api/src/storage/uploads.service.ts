import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PhotoType, type ShipmentPhoto, type StagedUpload } from '@prisma/client';
import { hasPermission, INTAKE_REQUIRED_PHOTOS, type PermissionKey } from '@670send/types';
import { AppException, Err } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { sniffImage } from './image-sniff';
import { StorageService } from './storage.service';

/** Who may upload which kind of evidence photo (any one of the listed permissions). */
const UPLOAD_PERMISSIONS: Record<PhotoType, PermissionKey[]> = {
  OPEN_BOX_CONTENT: ['shipments:create'],
  SEALED_PARCEL: ['shipments:create'],
  BAGGAGE_PLACEMENT: ['manifests:handover'],
  INBOUND_INCIDENT: ['inbound:report_incident'],
  PROOF_OF_DELIVERY: ['pod:verify'],
  DEPOSIT_PROOF: ['deposits:request'],
  CLAIM_EVIDENCE: ['claims:file'],
};

export interface UploadedFile {
  buffer: Buffer;
  size: number;
}

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Stage one photo. Photos are uploaded BEFORE the shipment exists (the waybill is only issued once
   * the mandatory open-box + sealed photos are present), so they wait here until intake consumes them.
   */
  async stage(
    actor: Actor,
    file: UploadedFile | undefined,
    input: { photoType: PhotoType; lat?: number; lng?: number },
  ): Promise<Pick<StagedUpload, 'id' | 'photoType' | 'sizeBytes' | 'sha256' | 'createdAt'>> {
    if (!UPLOAD_PERMISSIONS[input.photoType].some((p) => hasPermission(actor.permissions, p))) throw Err.forbidden();
    if (!file || file.size === 0) throw Err.validation([{ path: 'file', message: 'errors.validation_failed' }]);
    if (file.size > this.env.UPLOAD_MAX_BYTES) throw Err.fileTooLarge(Math.floor(this.env.UPLOAD_MAX_BYTES / 1024));

    const image = sniffImage(file.buffer);
    if (!image) throw Err.fileTypeNotAllowed();

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const now = new Date();
    const key = `photos/${actor.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${image.ext}`;
    const fileUrl = await this.storage.put(key, file.buffer, image.mime);

    return this.prisma.stagedUpload.create({
      data: {
        uploadedBy: actor.id,
        photoType: input.photoType,
        fileUrl,
        mimeType: image.mime,
        sizeBytes: file.size,
        sha256,
        lat: input.lat,
        lng: input.lng,
      },
      select: { id: true, photoType: true, sizeBytes: true, sha256: true, createdAt: true },
    });
  }

  /** The uploader (only) can preview what they staged. Evidence review for staff comes in Phase 4. */
  async signedUrlForOwner(actor: Actor, uploadId: string) {
    const row = await this.prisma.stagedUpload.findFirst({ where: { id: uploadId, uploadedBy: actor.id } });
    if (!row) throw Err.uploadNotFound();
    return this.storage.signedUrl(row.fileUrl);
  }

  /**
   * Attach staged photos to a shipment inside the intake transaction (Phase 3).
   * Enforces: every upload belongs to the acting user and is unused, and all `required` photo types
   * are present — otherwise no waybill can be generated.
   */
  async consumeForShipment(
    tx: Prisma.TransactionClient,
    args: {
      uploadIds: string[];
      shipmentId: string;
      actorId: string;
      required?: readonly PhotoType[];
    },
  ): Promise<ShipmentPhoto[]> {
    const ids = [...new Set(args.uploadIds)];
    const uploads = await tx.stagedUpload.findMany({
      where: { id: { in: ids }, uploadedBy: args.actorId, consumedAt: null },
    });
    if (uploads.length !== ids.length) throw Err.uploadNotFound();

    const present = new Set(uploads.map((u) => u.photoType));
    const missing = (args.required ?? INTAKE_REQUIRED_PHOTOS).filter((t) => !present.has(t));
    if (missing.length > 0) throw new AppException('photos_required', 422, undefined, { missing });

    // Claim atomically: a second concurrent intake cannot reuse the same photo.
    const claimed = await tx.stagedUpload.updateMany({
      where: { id: { in: ids }, consumedAt: null },
      data: { consumedAt: new Date(), consumedByShipmentId: args.shipmentId },
    });
    if (claimed.count !== ids.length) throw Err.uploadNotFound();

    return tx.shipmentPhoto.createManyAndReturn({
      data: uploads.map((u) => ({
        shipmentId: args.shipmentId,
        photoType: u.photoType,
        fileUrl: u.fileUrl,
        mimeType: u.mimeType,
        sizeBytes: u.sizeBytes,
        sha256: u.sha256,
        lat: u.lat,
        lng: u.lng,
        uploadedBy: u.uploadedBy,
      })),
    });
  }
}
