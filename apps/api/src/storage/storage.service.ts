import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Err } from '../common/errors';
import { ENV, type Env } from '../config/env';

/**
 * S3-compatible object storage (Cloudflare R2 in production, MinIO in development).
 * The bucket is PRIVATE: we only ever store `s3://bucket/key` URIs in the database and hand out
 * short-lived signed URLs (default 300 s) to authorised callers.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger('Storage');
  private readonly s3: S3Client;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.s3 = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.env.S3_AUTO_CREATE_BUCKET) return;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.env.S3_BUCKET }));
        this.log.log(`Created bucket ${this.env.S3_BUCKET}`);
      } catch (err) {
        // Do not crash the API on boot if object storage is down; uploads will fail with 502.
        this.log.warn(`Object storage not reachable / bucket unavailable: ${(err as Error).message}`);
      }
    }
  }

  uriFor(key: string): string {
    return `s3://${this.env.S3_BUCKET}/${key}`;
  }

  /** Reject URIs that point at another bucket or contain path tricks. */
  keyFromUri(uri: string): string {
    const prefix = `s3://${this.env.S3_BUCKET}/`;
    if (!uri.startsWith(prefix)) throw Err.notFound();
    const key = uri.slice(prefix.length);
    if (!key || key.includes('..') || key.startsWith('/')) throw Err.notFound();
    return key;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.env.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'private, max-age=0, no-store',
          ServerSideEncryption: undefined, // R2/MinIO encrypt at rest by themselves
        }),
      );
    } catch (err) {
      this.log.error(`put ${key} failed: ${(err as Error).message}`);
      throw Err.uploadFailed();
    }
    return this.uriFor(key);
  }

  async signedUrl(uri: string, ttlSeconds = this.env.S3_SIGNED_URL_TTL_SECONDS): Promise<{ url: string; expiresIn: number }> {
    const key = this.keyFromUri(uri);
    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }), {
      expiresIn: ttlSeconds,
    });
    return { url, expiresIn: ttlSeconds };
  }

  async delete(uri: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: this.keyFromUri(uri) }));
  }
}
