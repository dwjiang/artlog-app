// @vitest-environment node
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import { DEMO_BOT_ISSUER } from "./lib/demoBot";
import { fileStorage } from "./lib/fileStorage";
import { harness } from "./test.helpers";

const BOT = { issuer: DEMO_BOT_ISSUER, subject: "artlog-bot" };

beforeEach(() => vi.stubEnv("FLAG_DEMO_ACTIVITY", "on"));
afterEach(() => vi.unstubAllEnvs());

const bytes = (buffer: Buffer) => new Uint8Array(buffer).buffer;
const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#a03020" } });

it("stores an upload upright, within 2048 pixels and without metadata, for one post to claim", async () => {
  const t = harness();
  const original = await image(3000, 1000)
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD0: { Artist: "PRIVATE CAMERA OWNER" } } })
    .toBuffer();

  const photo = await t.withIdentity(BOT).action(api.demoActivityPhotos.uploadPhoto, { jpeg: bytes(original) });

  expect(photo).toMatchObject({ width: 683, height: 2048 });
  const stored = await t.run(async (ctx) => ({
    bytes: await (await fileStorage.get(ctx, photo.photoId))!.arrayBuffer(),
    file: await ctx.db.get("files", photo.photoId),
    pending: await ctx.db.query("demoPhotos").collect(),
  }));
  const metadata = await sharp(Buffer.from(stored.bytes)).metadata();
  expect(metadata).toMatchObject({ format: "jpeg", width: 683, height: 2048 });
  expect(metadata.exif).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
  expect(stored.file).toMatchObject({ contentType: "image/jpeg", refCount: 0, expiresAt: expect.any(Number) });
  expect(stored.pending).toEqual([expect.objectContaining({ fileId: photo.photoId, width: 683, height: 2048 })]);
});

it("keeps small photos at their size", async () => {
  const t = harness();
  const photo = await t
    .withIdentity(BOT)
    .action(api.demoActivityPhotos.uploadPhoto, { jpeg: bytes(await image(800, 600).jpeg().toBuffer()) });
  expect(photo).toMatchObject({ width: 800, height: 600 });
});

it("rejects other formats, oversized uploads and callers other than the bot", async () => {
  const t = harness();
  const bot = t.withIdentity(BOT);
  for (const [code, jpeg] of [
    ["invalid_photo", bytes(await image(10, 10).png().toBuffer())],
    ["invalid_photo", new TextEncoder().encode("not an image").buffer],
    ["photo_too_large", new Uint8Array(4 * 1024 * 1024 + 1).buffer],
    ["photo_too_large", bytes(await image(7000, 6000).jpeg({ quality: 1 }).toBuffer())],
  ] as const) {
    await expect(bot.action(api.demoActivityPhotos.uploadPhoto, { jpeg })).rejects.toMatchObject({ data: { code } });
  }
  const jpeg = bytes(await image(10, 10).jpeg().toBuffer());
  await expect(t.action(api.demoActivityPhotos.uploadPhoto, { jpeg })).rejects.toMatchObject({
    data: { code: "unauthenticated" },
  });
  vi.stubEnv("FLAG_DEMO_ACTIVITY", undefined);
  await expect(bot.action(api.demoActivityPhotos.uploadPhoto, { jpeg })).rejects.toMatchObject({
    data: { code: "feature_off" },
  });
  expect(await t.run((ctx) => ctx.db.query("files").collect())).toEqual([]);
});
