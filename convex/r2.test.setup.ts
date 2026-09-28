import { beforeEach, vi } from "vitest";

vi.mock("./lib/r2", async () => {
  const { createHash } = await import("node:crypto");
  const objects = new Map<string, Blob>();
  return {
    UPLOAD_LIFETIME_SECONDS: 900,
    r2: {
      uploadUrl: vi.fn(async (key: string) => `https://r2.test/upload/${key}`),
      downloadUrl: vi.fn(async (key: string) => `https://r2.test/download/${key}`),
      put: vi.fn(async (key: string, blob: Blob) => {
        objects.set(key, blob);
      }),
      get: vi.fn(async (key: string) => objects.get(key) ?? null),
      head: vi.fn(async (key: string) => {
        const blob = objects.get(key);
        if (!blob) return null;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return {
          size: blob.size,
          contentType: blob.type,
          etag: createHash("md5").update(bytes).digest("hex"),
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      }),
      remove: vi.fn(async (key: string) => {
        objects.delete(key);
      }),
    },
  };
});

beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
});
