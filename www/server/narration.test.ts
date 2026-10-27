import assert from "node:assert/strict";
import { test } from "node:test";

import { pageNarration, proxyNarration } from "./narration.ts";

const SITE = "https://backend.convex.site";
const PLAYLIST = `${SITE}/narration-playlist?artworkId=a1&render=r1`;

await test("plays the phone's stream or cached narration from this origin, moved on by the report's age", () => {
  const playing = { source: PLAYLIST, playing: true, position: 10, rate: 1.5, at: 1000 };

  assert.deepEqual(pageNarration(playing, "ios_1", SITE, 3000), {
    src: "narration/playlist?artworkId=a1&render=r1",
    live: true,
    playing: true,
    position: 13,
    rate: 1.5,
  });
  assert.deepEqual(
    pageNarration(
      { source: "Library/Caches/narration/r-2.mp3", playing: false, position: 4, rate: 1, at: 0 },
      "ios_1",
      SITE,
      60_000,
    ),
    { src: "sessions/ios_1/narration/r-2.mp3", live: false, playing: false, position: 4, rate: 1 },
  );
});

await test("plays nothing once the guide stops or from a source outside the narration paths", () => {
  const report = { playing: true, position: 0, rate: 1, at: 0 };

  assert.equal(pageNarration(null, "ios_1", SITE, 0), null);
  assert.equal(pageNarration({ ...report, source: null }, "ios_1", SITE, 0), null);
  assert.equal(
    pageNarration({ ...report, source: "https://elsewhere.example/narration-playlist" }, "ios_1", SITE, 0),
    null,
  );
  assert.equal(pageNarration({ ...report, source: `${SITE}/file?id=f1` }, "ios_1", SITE, 0), null);
  assert.equal(pageNarration({ ...report, source: "Documents/judges-demo/narration.json" }, "ios_1", SITE, 0), null);
});

await test("serves the backend's playlist with its segments routed through this origin", async () => {
  const fetched: string[] = [];
  const fakeFetch = async (url: string | URL | Request) => {
    fetched.push(String(url));
    return new Response(
      [
        "#EXTM3U",
        "#EXTINF:2.000,",
        `${SITE}/file?id=f1&artworkId=a1&render=r1`,
        "#EXTINF:1.500,",
        `${SITE}/file?id=f2&artworkId=a1&render=r1`,
        "",
      ].join("\n"),
    );
  };

  const response = await proxyNarration("playlist", "?artworkId=a1&render=r1", SITE, fakeFetch as typeof fetch);

  assert.deepEqual(fetched, [PLAYLIST]);
  assert.equal(response.headers.get("Content-Type"), "application/vnd.apple.mpegurl");
  assert.deepEqual((await response.text()).split("\n"), [
    "#EXTM3U",
    "#EXTINF:2.000,",
    "file?id=f1&artworkId=a1&render=r1",
    "#EXTINF:1.500,",
    "file?id=f2&artworkId=a1&render=r1",
    "",
  ]);
});

await test("serves segments from the backend and passes on a narration that is gone", async () => {
  const fetched: string[] = [];
  const fakeFetch = async (url: string | URL | Request) => {
    fetched.push(String(url));
    return String(url).includes("missing")
      ? new Response("Narration unavailable", { status: 404 })
      : new Response(new Uint8Array([0xff, 0xfb]), { headers: { "Content-Type": "audio/mpeg" } });
  };

  const segment = await proxyNarration("file", "?id=f1", SITE, fakeFetch as typeof fetch);
  const gone = await proxyNarration("playlist", "?render=missing", SITE, fakeFetch as typeof fetch);

  assert.deepEqual(fetched, [`${SITE}/file?id=f1`, `${SITE}/narration-playlist?render=missing`]);
  assert.deepEqual(new Uint8Array(await segment.arrayBuffer()), new Uint8Array([0xff, 0xfb]));
  assert.equal(segment.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(gone.status, 404);
});
