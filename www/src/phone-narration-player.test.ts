import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { followPhone } from "./phone-narration-player.ts";

const narration = { src: "sessions/phone/narration/render.mp3", live: false, playing: true, position: 12, rate: 1.5 };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const audioResponse = () => new Response(new Uint8Array([0xff, 0xfb]), { headers: { "Content-Type": "audio/mpeg" } });

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const audio = Object.assign(new EventTarget(), {
    HAVE_METADATA: 1,
    readyState: 0,
    src: "",
    currentTime: 0,
    playbackRate: 1,
    paused: true,
    removeAttribute() {
      this.src = "";
    },
    load() {
      this.readyState = 0;
      this.paused = true;
    },
    async play() {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    },
  });
  const phone = followPhone(audio as unknown as HTMLAudioElement, "/demo/api");
  t.after(() => phone.stop());
  return { audio, phone };
}

for (const failure of ["HTTP error", "network rejection", "interrupted response"] as const) {
  await test(`retries a cached narration after ${failure} without another phone report`, async (t) => {
    const { audio, phone } = setup(t);
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => {
      if (++requests > 1) return audioResponse();
      if (failure === "HTTP error") return new Response(null, { status: 503 });
      if (failure === "network rejection") throw new TypeError("Failed to fetch");
      const response = audioResponse();
      t.mock.method(response, "blob", async () => {
        throw new TypeError("Connection closed");
      });
      return response;
    });

    phone.follow(narration);
    await settle();
    assert.equal(requests, 1);
    assert.equal(audio.src, "");

    t.mock.timers.tick(2000);
    await settle();
    assert.equal(requests, 2);
    assert.match(audio.src, /^blob:/);
    audio.readyState = audio.HAVE_METADATA;
    audio.dispatchEvent(new Event("loadedmetadata"));
    assert.equal(audio.paused, false);
    assert.equal(audio.playbackRate, narration.rate);
    assert.ok(audio.currentTime >= narration.position);
  });
}

await test("pause and play can retry immediately without duplicating an active download", async (t) => {
  const { audio, phone } = setup(t);
  let complete!: (response: Response) => void;
  let requests = 0;
  t.mock.method(globalThis, "fetch", () => {
    if (++requests === 1) return Promise.resolve(new Response(null, { status: 500 }));
    return new Promise<Response>((resolve) => {
      complete = resolve;
    });
  });

  phone.follow(narration);
  await settle();
  phone.follow({ ...narration, playing: false });
  phone.follow(narration);
  t.mock.timers.tick(6000);
  assert.equal(requests, 2);
  complete(audioResponse());
  await settle();
  assert.match(audio.src, /^blob:/);
});

await test("a failed obsolete download cannot reset the newer narration", async (t) => {
  const { audio, phone } = setup(t);
  const pending: { resolve: (response: Response) => void; signal: AbortSignal | undefined }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    (_url: string, options?: RequestInit) =>
      new Promise<Response>((resolve) => pending.push({ resolve, signal: options?.signal ?? undefined })),
  );

  phone.follow(narration);
  phone.follow({ ...narration, src: "sessions/phone/narration/new.mp3" });
  assert.equal(pending[0].signal?.aborted, true);
  pending[0].resolve(new Response(null, { status: 500 }));
  await settle();
  t.mock.timers.tick(2000);
  assert.equal(pending.length, 2);
  pending[1].resolve(audioResponse());
  await settle();
  assert.match(audio.src, /^blob:/);
});

await test("stopping cancels the download and prevents late playback or retries", async (t) => {
  const { audio, phone } = setup(t);
  let complete!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  const request = t.mock.method(globalThis, "fetch", (_url: string, options?: RequestInit) => {
    signal = options?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      complete = resolve;
    });
  });

  phone.follow(narration);
  phone.stop();
  assert.equal(signal?.aborted, true);
  complete(audioResponse());
  await settle();
  t.mock.timers.tick(6000);
  assert.equal(request.mock.callCount(), 1);
  assert.equal(audio.src, "");
  assert.equal(audio.paused, true);
});
