import { afterEach, expect, it, vi } from "vitest";

import { r2 } from "./r2";

vi.unmock("./r2");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configure() {
  vi.stubEnv("R2_BUCKET", "artlog-test");
  vi.stubEnv("R2_ENDPOINT", "https://account.r2.cloudflarestorage.com");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-key");
}

it("signs immutable uploads with an exact size, MIME type, and a fifteen-minute lifetime", async () => {
  configure();
  const url = new URL(await r2.uploadUrl("file-id", "image/jpeg", 123));
  expect(url.hostname).toBe("artlog-test.account.r2.cloudflarestorage.com");
  expect(url.pathname).toBe("/file-id");
  expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
  const signed = url.searchParams.get("X-Amz-SignedHeaders")?.split(";");
  expect(signed).toEqual(expect.arrayContaining(["content-type", "content-length", "if-none-match"]));
  expect(url.href).not.toContain("test-secret-key");
});

it("reports failed transfers without putting signed URLs or credentials in the error", async () => {
  configure();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(r2.put("file-id", new Blob(["photo"], { type: "image/jpeg" }))).rejects.toThrow(
    "R2 upload failed (503)",
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "PUT",
    headers: { "If-None-Match": "*", "Content-Length": "5" },
  });
  await expect(r2.get("file-id")).rejects.toThrow("R2 download failed (503)");
  await expect(r2.remove("file-id")).rejects.toThrow("R2 deletion failed (503)");
  fetcher.mockResolvedValue(new Response(null, { status: 404 }));
  expect(await r2.get("missing")).toBeNull();
  await expect(r2.remove("missing")).resolves.toBeUndefined();
});

it("binds direct corpus uploads to their checksum and archive hash", async () => {
  configure();
  const sha256 = "a".repeat(64);
  const url = new URL(
    await r2.uploadUrl("file-id", "application/octet-stream", 48, {
      md5: "AAAAAAAAAAAAAAAAAAAAAA==",
      sha256,
    }),
  );
  expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
    expect.arrayContaining(["content-md5", "x-amz-meta-sha256"]),
  );
  expect(url.searchParams.has("x-amz-meta-sha256")).toBe(false);
});

it("verifies uploaded metadata with HEAD without fetching the file body", async () => {
  configure();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(null, {
      headers: {
        "content-length": "48",
        "content-type": "application/octet-stream",
        etag: '"abc"',
        "x-amz-meta-sha256": "hash",
      },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await r2.head("file-id")).toEqual({
    size: 48,
    contentType: "application/octet-stream",
    etag: "abc",
    sha256: "hash",
  });
  expect(fetcher.mock.calls[0][1]).toEqual({ method: "HEAD" });
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(r2.head("file-id")).rejects.toThrow("R2 metadata read failed (503)");
});
