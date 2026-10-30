import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../_generated/server";

export const UPLOAD_LIFETIME_SECONDS = 15 * 60;

// Error messages never reach Sentry, so the status rides on an allowlisted code and reason instead.
function storageError(message: string, reason: string): Error {
  return Object.assign(new Error(message), { code: "storage_failed", reason });
}

function client() {
  const { R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_BUCKET || !R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw storageError("R2 storage is not configured", "unconfigured");
  }
  return {
    bucket: R2_BUCKET,
    s3: new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      requestChecksumCalculation: "WHEN_REQUIRED",
    }),
  };
}

export const r2 = {
  async uploadUrl(
    key: string,
    contentType: string,
    size: number,
    checksum?: { md5: string; sha256: string },
  ): Promise<string> {
    const { s3, bucket } = client();
    return getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
        IfNoneMatch: "*",
        ...(checksum ? { ContentMD5: checksum.md5, Metadata: { sha256: checksum.sha256 } } : {}),
      }),
      {
        expiresIn: UPLOAD_LIFETIME_SECONDS,
        signableHeaders: new Set(["content-type", "content-length", "if-none-match", "content-md5"]),
        // R2 stores custom metadata only when it arrives as a header, not a signed query parameter.
        unhoistableHeaders: new Set(["x-amz-meta-sha256"]),
      },
    );
  },
  async head(key: string) {
    const { s3, bucket } = client();
    const url = await getSignedUrl(s3, new HeadObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 });
    const response = await fetch(url, { method: "HEAD" });
    if (response.status === 404) return null;
    if (!response.ok) throw storageError(`R2 metadata read failed (${response.status})`, `http_${response.status}`);
    return {
      size: Number(response.headers.get("content-length") ?? NaN),
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag")?.replaceAll('"', ""),
      sha256: response.headers.get("x-amz-meta-sha256"),
    };
  },
  async downloadUrl(key: string): Promise<string> {
    const { s3, bucket } = client();
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
  },
  async put(key: string, blob: Blob): Promise<void> {
    const response = await fetch(await r2.uploadUrl(key, blob.type, blob.size), {
      method: "PUT",
      headers: { "Content-Type": blob.type, "Content-Length": String(blob.size), "If-None-Match": "*" },
      body: blob,
    });
    if (!response.ok) throw storageError(`R2 upload failed (${response.status})`, `http_${response.status}`);
  },
  async get(key: string): Promise<Blob | null> {
    const response = await fetch(await r2.downloadUrl(key));
    if (response.status === 404) return null;
    if (!response.ok) throw storageError(`R2 download failed (${response.status})`, `http_${response.status}`);
    return response.blob();
  },
  async remove(key: string): Promise<void> {
    const { s3, bucket } = client();
    const url = await getSignedUrl(s3, new DeleteObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 });
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw storageError(`R2 deletion failed (${response.status})`, `http_${response.status}`);
    }
  },
};
