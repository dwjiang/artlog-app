import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { createDemoSessions, DEMO_LABEL, imageExtension, type DemoConfig, type DemoError } from "./demo-sessions.ts";

type FakeInstance = {
  metadata: { id: string; createdAt: string; labels?: Record<string, string> };
  status: { state: string; apiUrl?: string; token?: string; endpointWebSocketUrl?: string; streamToken?: string };
};

function fakeLimrun(existing: FakeInstance[] = []) {
  const instances = [...existing];
  const calls = {
    created: [] as unknown[],
    deleted: [] as string[],
    simctl: [] as string[][],
    launched: [] as string[],
    pushed: [] as { name: string; bundleId?: string; containerType?: string; bytes?: string }[],
    pulled: [] as { name: string; bundleId?: string; containerType?: string }[],
    disconnects: 0,
  };
  // What the phone's app container holds; an Error is a read that fails.
  const files = new Map<string, string | Error>();
  let failSimctl = false;
  const api = {
    list: ({ state }: { labelSelector?: string; state?: string } = {}) =>
      (async function* () {
        const snapshot = [...instances];
        for (const i of snapshot) {
          if (i.metadata.labels?.managed_by !== DEMO_LABEL) continue;
          if (!state || state.split(",").includes(i.status.state)) yield i;
        }
      })(),
    create: async (params: unknown) => {
      calls.created.push(params);
      const { metadata } = params as { metadata: { labels: Record<string, string> } };
      const instance: FakeInstance = {
        metadata: {
          id: `ios_${instances.length}`,
          createdAt: new Date().toISOString(),
          labels: metadata.labels,
        },
        status: {
          state: "ready",
          apiUrl: "https://device",
          token: "full-token",
          endpointWebSocketUrl: "wss://stream",
          streamToken: "stream-token",
        },
      };
      instances.push(instance);
      return instance;
    },
    get: async (id: string) => {
      const found = instances.find((i) => i.metadata.id === id);
      if (!found) throw new Error("404");
      return found;
    },
    delete: async (id: string) => {
      calls.deleted.push(id);
      const instance = instances.find((i) => i.metadata.id === id);
      if (instance) instance.status.state = "terminated";
    },
  };
  const connect = async () => ({
    pushFile: async (path: string, name: string, opts?: { bundleId: string; containerType?: string }) => {
      calls.pushed.push({ name, ...opts, bytes: await readFile(path, "latin1") });
      return `/remote/${name}`;
    },
    simctl: (args: string[]) => ({
      wait: async () => {
        calls.simctl.push(args);
        return failSimctl ? { code: 1, stdout: "", stderr: "boom" } : { code: 0, stdout: "", stderr: "" };
      },
    }),
    launchApp: async (bundleId: string) => void calls.launched.push(bundleId),
    pullFile: async (name: string, opts?: { bundleId: string; containerType?: string }) => {
      calls.pulled.push({ name, ...opts });
      const content = files.get(name);
      if (content === undefined) throw new Error(`${name} not found`);
      if (content instanceof Error) throw content;
      return Buffer.from(content);
    },
    disconnect: () => void calls.disconnects++,
  });
  return { api, connect, calls, files, instances, failNextPrepare: () => (failSimctl = true) };
}

const live = (id: string, createdAt = new Date().toISOString()): FakeInstance => ({
  metadata: { id, createdAt, labels: { managed_by: DEMO_LABEL } },
  status: { state: "ready" },
});

const phoneDir = await mkdtemp(join(tmpdir(), "demo-phone-"));
await mkdir(join(phoneDir, "photos"));
await writeFile(join(phoneDir, "photos", "roses.jpg"), "");
await writeFile(join(phoneDir, "viewfinder.mp4"), "");
await writeFile(join(phoneDir, "viewfinder.json"), "");
const config: DemoConfig = { appAsset: "artlog/test.app.tar.gz", phoneDir, maxLive: 2, maxPerDay: 3, maxUploads: 2 };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

// The fakes implement only the calls the module makes; the casts stand in for the full SDK types.
const sessionsFor = (fake: ReturnType<typeof fakeLimrun>, overrides: Partial<DemoConfig> = {}) =>
  createDemoSessions({ ...config, ...overrides }, fake.api as never, fake.connect as never);

await test("starts a prepared phone and hands the page only the stream token", async () => {
  const fake = fakeLimrun();
  const session = await sessionsFor(fake).start({ clientIp: "203.0.113.7" });

  assert.deepEqual(session, { id: "ios_0", endpointWebSocketUrl: "wss://stream", streamToken: "stream-token" });
  const [created] = fake.calls.created as { spec: Record<string, unknown> }[];
  assert.deepEqual(created?.spec.initialAssets, [{ kind: "App", source: "AssetName", assetName: config.appAsset }]);
  assert.deepEqual(created?.spec.clues, [{ kind: "ClientIP", clientIp: "203.0.113.7" }]);
  assert.deepEqual(
    fake.calls.pushed
      .filter((push) => push.bundleId === "app.artlog.ios" && push.containerType === "data")
      .map((push) => push.name)
      .sort(),
    [
      "Documents/judges-demo/photos/roses.jpg",
      "Documents/judges-demo/viewfinder.json",
      "Documents/judges-demo/viewfinder.mp4",
    ],
  );
  assert.ok(fake.calls.simctl.some((args) => args.join(" ") === "privacy booted grant photos-add app.artlog.ios"));
  assert.deepEqual(fake.calls.launched, ["app.artlog.ios"]);
});

await test("requires the access code when one is set", async () => {
  const fake = fakeLimrun();
  const sessions = sessionsFor(fake, { accessCode: "gallery" });

  await assert.rejects(sessions.start({ code: "wrong" }), (error: DemoError) => error.code === "access_code");
  assert.equal(fake.calls.created.length, 0);
  await sessions.start({ code: " gallery " });
  assert.equal(fake.calls.created.length, 1);
});

await test("refuses a phone when the live or daily cap is reached", async () => {
  const busy = fakeLimrun([live("a"), live("b")]);
  await assert.rejects(sessionsFor(busy).start({}), (error: DemoError) => error.code === "busy");

  const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const spent = fakeLimrun([
    { ...live("a"), status: { state: "terminated" } },
    { ...live("b"), status: { state: "terminated" } },
    { ...live("c"), status: { state: "terminated" } },
    { ...live("old", yesterday), status: { state: "terminated" } },
  ]);
  await assert.rejects(sessionsFor(spent).start({}), (error: DemoError) => error.code === "daily_cap");
  assert.equal(spent.calls.created.length, 0);
});

await test("allows only the remaining daily slot when judges start together", async () => {
  const fake = fakeLimrun(
    Array.from({ length: 29 }, (_, i) => ({ ...live(`old-${i}`), status: { state: "terminated" } })),
  );
  const sessions = sessionsFor(fake, { maxLive: 5, maxPerDay: 30 });

  const results = await Promise.allSettled(Array.from({ length: 3 }, () => sessions.start({})));

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results) {
    if (result.status === "rejected") assert.equal((result.reason as DemoError).code, "daily_cap");
  }
  assert.equal(fake.calls.created.length, 1);
});

await test("allows only the remaining live slot when judges start together", async () => {
  const fake = fakeLimrun([live("existing")]);
  const sessions = sessionsFor(fake, { maxLive: 2, maxPerDay: 30 });

  const results = await Promise.allSettled(Array.from({ length: 3 }, () => sessions.start({})));

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results) {
    if (result.status === "rejected") assert.equal((result.reason as DemoError).code, "busy");
  }
  assert.equal(fake.calls.created.length, 1);
});

for (const visibleWhileStarting of [false, true]) {
  await test(
    `starts phones in parallel within the cap when a pending phone is ${visibleWhileStarting ? "listed" : "unlisted"}`,
    { timeout: 3000 },
    async () => {
      const fake = fakeLimrun();
      let markStarting!: () => void;
      const starting = new Promise<void>((resolve) => {
        markStarting = resolve;
      });
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { create } = fake.api;
      let first = true;
      fake.api.create = async (params) => {
        if (!first) return create(params);
        first = false;
        const instance = visibleWhileStarting ? await create(params) : undefined;
        markStarting();
        await blocked;
        return instance ?? create(params);
      };
      const sessions = sessionsFor(fake, { maxLive: 2, maxPerDay: 2 });
      const pending = sessions.start({});
      try {
        await starting;
        const second = await sessions.start({});
        assert.ok(second.id);
        await assert.rejects(sessions.start({}), (error: DemoError) => error.code === "busy");
      } finally {
        release();
        await pending;
      }
      assert.equal(fake.calls.created.length, 2);
    },
  );
}

await test("releases a reservation when instance creation fails", async () => {
  const fake = fakeLimrun();
  const { create } = fake.api;
  fake.api.create = async () => {
    fake.api.create = create;
    throw new Error("Creation failed");
  };
  const sessions = sessionsFor(fake, { maxLive: 1, maxPerDay: 1 });

  await assert.rejects(sessions.start({}), /Creation failed/);
  await sessions.start({});
  assert.equal(fake.calls.created.length, 1);
});

await test("stops a phone whose preparation fails", async () => {
  const fake = fakeLimrun();
  fake.failNextPrepare();

  await assert.rejects(sessionsFor(fake).start({}), /simctl location exited 1/);
  assert.deepEqual(fake.calls.deleted, ["ios_0"]);
});

await test("stops only demo phones", async () => {
  const other: FakeInstance = { metadata: { id: "other", createdAt: "", labels: {} }, status: { state: "ready" } };
  const fake = fakeLimrun([live("mine"), other]);
  const sessions = sessionsFor(fake);

  await sessions.stop("mine");
  await assert.rejects(sessions.stop("other"), (error: DemoError) => error.status === 404);
  await assert.rejects(sessions.stop("missing"), (error: DemoError) => error.status === 404);
  assert.deepEqual(fake.calls.deleted, ["mine"]);
});

await test("adds a judge's photo to the demo's uploads on their phone", async () => {
  const fake = fakeLimrun();
  const sessions = sessionsFor(fake);
  const { id } = await sessions.start({});
  fake.calls.pushed.length = 0;

  await sessions.upload(id, JPEG);
  const [pushed] = fake.calls.pushed;
  assert.match(pushed?.name ?? "", /^Documents\/judges-demo\/uploads\/\d+-1\.jpg$/);
  assert.equal(pushed?.containerType, "data");
  assert.equal(pushed?.bytes, JPEG.toString("latin1"));
});

await test("refuses uploads that are not photos, past the session's cap, or for other phones", async () => {
  const other: FakeInstance = { metadata: { id: "other", createdAt: "", labels: {} }, status: { state: "ready" } };
  const fake = fakeLimrun([other]);
  const sessions = sessionsFor(fake);
  const { id } = await sessions.start({});

  await assert.rejects(sessions.upload(id, Buffer.from("<svg/>")), (error: DemoError) => error.status === 415);
  await assert.rejects(sessions.upload("other", JPEG), (error: DemoError) => error.status === 404);
  await sessions.upload(id, JPEG);
  await sessions.upload(id, JPEG);
  await assert.rejects(sessions.upload(id, JPEG), (error: DemoError) => error.code === "upload_cap");
});

await test("points a phone's viewfinder at a picked painting", async () => {
  const other: FakeInstance = { metadata: { id: "other", createdAt: "", labels: {} }, status: { state: "ready" } };
  const fake = fakeLimrun([other]);
  const sessions = sessionsFor(fake);
  const { id } = await sessions.start({});
  fake.calls.pushed.length = 0;

  await sessions.walk(id, 3);
  assert.deepEqual(fake.calls.pushed, [
    {
      name: "Documents/judges-demo/walk.json",
      bundleId: "app.artlog.ios",
      containerType: "data",
      bytes: JSON.stringify({ painting: 3 }),
    },
  ]);
  for (const painting of [-1, 1.5, Number.NaN]) {
    await assert.rejects(sessions.walk(id, painting), (error: DemoError) => error.status === 400);
  }
  await assert.rejects(sessions.walk("other", 0), (error: DemoError) => error.status === 404);
  await sessions.stop(id);
  await assert.rejects(sessions.walk(id, 0), (error: DemoError) => error.code === "not_ready");
  assert.equal(fake.calls.pushed.length, 1);
});

await test("recognizes the photo formats the app imports from their leading bytes", () => {
  assert.equal(imageExtension(JPEG), "jpg");
  assert.equal(imageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "png");
  assert.equal(imageExtension(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "latin1")), "heic");
  assert.equal(imageExtension(Buffer.from("GIF89a")), undefined);
});

const NARRATION = "Documents/judges-demo/narration.json";
const report = (position: number) => JSON.stringify({ source: "x", playing: true, position, rate: 1, at: 0 });

async function advance(t: TestContext, ms: number) {
  t.mock.timers.tick(ms);
  await new Promise((resolve) => setImmediate(resolve));
}

await test("passes on each change to the app's narration report until stopped", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fake = fakeLimrun();
  const sessions = sessionsFor(fake);
  const { id } = await sessions.start({});
  fake.calls.disconnects = 0;
  const seen: unknown[] = [];

  const stop = await sessions.watchNarration(id, (state) => seen.push(state));
  await advance(t, 0);
  fake.files.set(NARRATION, report(1));
  await advance(t, 500);
  await advance(t, 500);
  fake.files.set(NARRATION, new Error("connection lost"));
  await advance(t, 500);
  fake.files.set(NARRATION, '{"source": "x", "play');
  await advance(t, 500);
  fake.files.set(NARRATION, report(2));
  await advance(t, 500);
  stop();
  fake.files.set(NARRATION, report(3));
  await advance(t, 500);

  assert.deepEqual(seen, [null, JSON.parse(report(1)), JSON.parse(report(2))]);
  assert.ok(fake.calls.pulled.every((pull) => pull.bundleId === "app.artlog.ios" && pull.containerType === "data"));
  assert.equal(fake.calls.disconnects, 1);
});

await test("reads a cached narration from the app's container, only on live demo phones", async () => {
  const other: FakeInstance = { metadata: { id: "other", createdAt: "", labels: {} }, status: { state: "ready" } };
  const fake = fakeLimrun([other]);
  const sessions = sessionsFor(fake);
  const { id } = await sessions.start({});
  fake.files.set("Library/Caches/narration/render-1.mp3", "mp3");

  assert.equal((await sessions.narrationFile(id, "render-1")).toString(), "mp3");
  assert.deepEqual(fake.calls.pulled, [
    { name: "Library/Caches/narration/render-1.mp3", bundleId: "app.artlog.ios", containerType: "data" },
  ]);
  await assert.rejects(sessions.narrationFile("other", "render-1"), (error: DemoError) => error.status === 404);
  await sessions.stop(id);
  await assert.rejects(
    sessions.watchNarration(id, () => {}),
    (error: DemoError) => error.status === 409,
  );
});
