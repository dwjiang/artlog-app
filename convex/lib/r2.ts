import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../_generated/server";

export const UPLOAD_LIFETIME_SECONDS = 15 * 60;

function client() {
  const { R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_BUCKET || !R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 storage is not configured");
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
  async uploadUrl(key: string, contentType: string, size: number): Promise<string> {
    const { s3, bucket } = client();
    return getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
        IfNoneMatch: "*",
      }),
      {
        expiresIn: UPLOAD_LIFETIME_SECONDS,
        signableHeaders: new Set(["content-type", "content-length", "if-none-match"]),
      },
    );
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
    if (!response.ok) throw new Error(`R2 upload failed (${response.status})`);
  },
  async get(key: string): Promise<Blob | null> {
    const response = await fetch(await r2.downloadUrl(key));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 download failed (${response.status})`);
    return response.blob();
  },
  async remove(key: string): Promise<void> {
    const { s3, bucket } = client();
    const url = await getSignedUrl(s3, new DeleteObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 });
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error(`R2 deletion failed (${response.status})`);
  },
};
