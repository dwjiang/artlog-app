import assert from "node:assert/strict";
import { test } from "node:test";

import { politeClient, previewImage, readableMuseums, USER_AGENT, withImages } from "./images.mts";

/** A PNG header that image-size reads as `width`×`height`. */
function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

type Reply = { status?: number; type?: string; body?: string | Buffer; location?: string };

/** Answers each URL from `site`, records requests, and treats unknown URLs as missing. */
function fakeWeb(site: Record<string, Reply | (() => never)>) {
  const requests: { url: string; userAgent: string | null }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    requests.push({ url, userAgent: new Headers(init.headers).get("User-Agent") });
    const reply = site[url];
    if (typeof reply === "function") reply();
    const { status = 200, type = "text/html", body = "", location } = (reply as Reply | undefined) ?? { status: 404 };
    const headers = new Headers({ "content-type": type, ...(location ? { location } : {}) });
    return new Response(typeof body === "string" ? body : new Uint8Array(body), { status, headers });
  };
  const sleeps: number[] = [];
  let clock = 0;
  const client = politeClient(
    fetchImpl,
    async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    () => clock,
  );
  return { ...client, requests, sleeps };
}

const page = (image: string) => `<html><head><meta property="og:image" content="${image}"></head></html>`;
const HOME = "https://www.museum.example";
const SHOW = "https://www.museum.example/exhibitions/tides";
const IMAGE = "https://cdn.museum.example/tides.jpg";

await test("reads the link-preview image, preferring Open Graph and resolving it against the page", () => {
  const html = `<head>
    <meta name="twitter:image" content="https://cdn.example/twitter.jpg">
    <meta content='/media/hero.jpg?w=1200&amp;h=630' property='og:image' />
  </head>`;
  assert.equal(previewImage(html, SHOW), "https://www.museum.example/media/hero.jpg?w=1200&h=630");
  assert.equal(previewImage(page("http://cdn.example/a.jpg"), SHOW), "https://cdn.example/a.jpg");
  assert.equal(
    previewImage(`<meta name="twitter:image" content="https://cdn.example/t.jpg">`, SHOW),
    "https://cdn.example/t.jpg",
  );
  assert.equal(previewImage(page("data:image/png;base64,AAAA"), SHOW), undefined);
  assert.equal(previewImage("<head><title>No preview</title></head>", SHOW), undefined);
});

await test("keeps a show's preview image once it loads as a large picture, asking as artlog-bot", async () => {
  const web = fakeWeb({
    "https://www.museum.example/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private/" },
    [SHOW]: { body: page(IMAGE) },
    "https://cdn.museum.example/robots.txt": { status: 404 },
    [IMAGE]: { type: "image/png", body: png(1200, 630) },
  });
  assert.deepEqual(await web.findImage(SHOW, HOME), { imageUrl: IMAGE });
  assert.ok(web.requests.every((request) => request.userAgent === USER_AGENT));
});

await test("rejects images that are small, vector, missing or not images", async () => {
  const cases: [Reply, string][] = [
    [{ type: "image/png", body: png(120, 120) }, "image_too_small"],
    [{ type: "image/svg+xml", body: "<svg/>" }, "image_not_raster"],
    [{ status: 404 }, "image_http_404"],
    [{ type: "text/html", body: "<html>Not found</html>" }, "image_not_raster"],
  ];
  for (const [reply, reason] of cases) {
    const web = fakeWeb({ [SHOW]: { body: page(IMAGE) }, [IMAGE]: reply });
    assert.deepEqual(await web.findImage(SHOW, HOME), { reason });
  }
});

await test("follows robots.txt the RFC 9309 way", async () => {
  const blocked = fakeWeb({
    "https://www.museum.example/robots.txt": {
      type: "text/plain",
      body: "User-agent: artlog-bot\nDisallow: /exhibitions/",
    },
    [SHOW]: { body: page(IMAGE) },
  });
  assert.deepEqual(await blocked.findImage(SHOW, HOME), { reason: "robots" });
  assert.ok(!blocked.requests.some((request) => request.url === SHOW));

  const unreadable = fakeWeb({
    "https://www.museum.example/robots.txt": { status: 503 },
    [SHOW]: { body: page(IMAGE) },
  });
  assert.deepEqual(await unreadable.findImage(SHOW, HOME), { reason: "robots" });

  const htmlRobots = fakeWeb({
    "https://www.museum.example/robots.txt": { type: "text/html", body: "<html>Disallow: /</html>" },
    [SHOW]: { body: page(IMAGE) },
    [IMAGE]: { type: "image/jpeg", body: png(1200, 630) },
  });
  assert.deepEqual(await htmlRobots.findImage(SHOW, HOME), { imageUrl: IMAGE });

  const slow = fakeWeb({
    "https://www.museum.example/robots.txt": { type: "text/plain", body: "User-agent: *\nCrawl-delay: 600" },
    [SHOW]: { body: page(IMAGE) },
  });
  assert.deepEqual(await slow.findImage(SHOW, HOME), { reason: "robots" });
});

await test("spaces requests to one host by at least a second, or the crawl delay it asks for", async () => {
  const web = fakeWeb({
    "https://www.museum.example/robots.txt": { type: "text/plain", body: "User-agent: *\nCrawl-delay: 5" },
    [SHOW]: { body: page("/tides.png") },
    "https://www.museum.example/tides.png": { type: "image/png", body: png(1200, 630) },
  });
  await web.findImage(SHOW, HOME);
  // robots.txt, then the show page, the home page and the image, all on one host.
  assert.deepEqual(web.sleeps, [1000, 5000, 5000]);
});

await test("skips a show page that offers the museum's site-wide preview image", async () => {
  const logo = "https://cdn.museum.example/logo.png";
  const web = fakeWeb({
    [SHOW]: { body: page(logo) },
    "https://www.museum.example/": { body: page(logo) },
    [logo]: { type: "image/png", body: png(1500, 648) },
  });
  assert.deepEqual(await web.findImage(SHOW, HOME), { reason: "site_default" });
  assert.ok(!web.requests.some((request) => request.url === logo));
});

await test("stays on the museum's site when the show page redirects", async () => {
  const web = fakeWeb({
    [SHOW]: { status: 301, location: "https://tickets.example/tides" },
  });
  assert.deepEqual(await web.findImage(SHOW, HOME), { reason: "redirect_elsewhere" });
  const network = fakeWeb({
    [SHOW]: () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.deepEqual(await network.findImage(SHOW, HOME), { reason: "fetch_failed" });
});

await test("resolves chained relative robots redirects before reading a disallowed page", async () => {
  const web = fakeWeb({
    [`${HOME}/robots.txt`]: { status: 301, location: "/policy/robots.txt" },
    [`${HOME}/policy/robots.txt`]: { status: 302, location: "final.txt" },
    [`${HOME}/policy/final.txt`]: { type: "text/plain", body: "User-agent: *\nDisallow: /" },
    [SHOW]: { body: page(IMAGE) },
  });
  assert.deepEqual(await web.findImage(SHOW, HOME), { reason: "robots" });
  assert.ok(web.requests.some((request) => request.url === `${HOME}/policy/final.txt`));
  assert.ok(!web.requests.some((request) => request.url === SHOW));
});

await test("versions image changes separately from the captured exhibition evidence", () => {
  const checkedAt = Date.parse("2026-10-09T10:00:00Z");
  const imageCheckedAt = checkedAt + 1000;
  const input = { exhibitions: [{ title: "Tides", sourceUrl: SHOW, checkedAt, sourceSha256: "a".repeat(64) }] };
  const result = withImages(input, [{ imageUrl: IMAGE }], imageCheckedAt);
  assert.deepEqual(result.exhibitions[0], { ...input.exhibitions[0], imageUrl: IMAGE, imageCheckedAt });
  const cleared = withImages(result, [{ reason: "no_preview_image" }], imageCheckedAt + 1000);
  assert.deepEqual(cleared.exhibitions[0], { ...input.exhibitions[0], imageCheckedAt: imageCheckedAt + 1000 });
});

await test("preserves the prior image revision when the page, image or robots check is unavailable", async () => {
  const unavailable = () => {
    throw new Error("Request timed out");
  };
  const failures: Record<string, Reply | (() => never)>[] = [
    { [SHOW]: { status: 503 } },
    { [SHOW]: { status: 429 } },
    { [SHOW]: unavailable },
    { [IMAGE]: { status: 503 } },
    { [IMAGE]: { status: 429 } },
    { [IMAGE]: unavailable },
    { [`${HOME}/robots.txt`]: { status: 503 } },
    { "https://cdn.museum.example/robots.txt": unavailable },
  ];
  const bare = { title: "Tides", sourceUrl: SHOW, checkedAt: 1000 };
  for (const failure of failures) {
    const web = fakeWeb({
      [SHOW]: { body: page(IMAGE) },
      [IMAGE]: { type: "image/png", body: png(1200, 630) },
      ...failure,
    });
    const outcome = await web.findImage(SHOW, HOME);
    assert.ok("reason" in outcome);
    for (const show of [bare, { ...bare, imageUrl: IMAGE, imageCheckedAt: 2000 }]) {
      const result = withImages({ exhibitions: [show] }, [outcome], 3000);
      assert.deepEqual(result.exhibitions, [show]);
      assert.deepEqual(result.imageReport, [{ title: show.title, sourceUrl: SHOW, ...outcome }]);
    }
  }
});

await test("clears a prior image only after a definitive missing or unusable result", () => {
  const show = { title: "Tides", sourceUrl: SHOW, imageUrl: IMAGE, imageCheckedAt: 1000 };
  for (const reason of [
    "no_preview_image",
    "site_default",
    "image_http_404",
    "image_http_410",
    "image_too_small",
    "museum_opted_out",
  ]) {
    const result = withImages({ exhibitions: [show] }, [{ reason }], 2000);
    assert.deepEqual(result.exhibitions, [{ title: show.title, sourceUrl: SHOW, imageCheckedAt: 2000 }]);
  }
});

await test("reads only museums the directory lists as not opted out", () => {
  const readable = readableMuseums([
    { _id: "open", optOut: false, website: HOME },
    { _id: "opted-out", optOut: true, website: HOME },
    { _id: "unknown", website: HOME },
  ]);
  assert.deepEqual([...readable], [["open", HOME]]);
  assert.throws(() => readableMuseums({}), /must be an array/);
});

await test("drops an image several shows share as the site's default and reports every outcome", () => {
  const input = {
    asOfDate: "2026-10-09",
    exhibitions: [
      { title: "Tides", sourceUrl: SHOW, imageUrl: "https://stale.example/old.jpg" },
      { title: "Fog", sourceUrl: `${SHOW}/fog` },
      { title: "Signal", sourceUrl: `${SHOW}/signal` },
      { title: "Orchard", sourceUrl: `${SHOW}/orchard` },
    ],
  };
  const result = withImages(input, [
    { imageUrl: IMAGE },
    { imageUrl: "https://cdn.museum.example/default.jpg" },
    { imageUrl: "https://cdn.museum.example/default.jpg" },
    { reason: "no_preview_image" },
  ]);
  assert.equal(result.asOfDate, "2026-10-09");
  assert.deepEqual(
    result.exhibitions.map((show) => ("imageUrl" in show ? show.imageUrl : null)),
    [IMAGE, null, null, null],
  );
  assert.deepEqual(
    result.imageReport.map((row) => ("reason" in row ? row.reason : "image")),
    ["image", "shared_by_shows", "shared_by_shows", "no_preview_image"],
  );
});
