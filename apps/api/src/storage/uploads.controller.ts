import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { PHOTO_TYPES } from '@670send/types';
import { CurrentActor, RequireAnyPermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../rbac/actor';
import { UploadsService } from './uploads.service';

const photoBodySchema = z.object({
  photoType: z.enum(PHOTO_TYPES),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * multipart/form-data: `file` (JPEG/PNG/WebP, client-compressed < 200 KB) + `photoType` (+ optional lat/lng).
   * The precise size cap (UPLOAD_MAX_BYTES) is enforced in the service so the error is localized;
   * the multer limit below is only a hard ceiling matching the Nginx 10 MB cap.
   */
  @RequireAnyPermission('shipments:create', 'inbound:report_incident', 'pod:verify', 'manifests:handover', 'deposits:request', 'claims:file')
  @Post('photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 } }))
  stage(
    @CurrentActor() actor: Actor,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Body(new ZodValidationPipe(photoBodySchema)) body: z.infer<typeof photoBodySchema>,
  ) {
    return this.uploads.stage(actor, file && { buffer: file.buffer, size: file.size }, body);
  }

  @RequireAnyPermission('shipments:create', 'inbound:report_incident', 'pod:verify', 'manifests:handover', 'deposits:request', 'claims:file')
  @Get('photos/:id/url')
  url(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.uploads.signedUrlForOwner(actor, id);
  }
}
