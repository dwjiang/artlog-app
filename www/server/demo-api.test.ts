import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request, type IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";

import { createDemoApi } from "./demo-api.ts";
import { DemoError, type DemoSession, type DemoSessions } from "./demo-sessions.ts";
import { MAX_UPLOAD_BYTES } from "./upload-limit.ts";

const session: DemoSession = { id: "ios_test", endpointWebSocketUrl: "wss://stream", streamToken: "stream-token" };

// Vercel buffers the body, then restores data/end listeners and read() without resetting the request's stream state.
async function restoreVercelBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  await once(req, "end");
  const replay = new PassThrough();
  const originalOn = req.on.bind(req);
  req.read = replay.read.bind(replay);
  req.on = req.addListener = (event: string, listener: (...args: unknown[]) => void) => {
    if (event === "data" || event === "end") replay.on(event, listener);
    else originalOn(event, listener);
    return req;
  };
  replay.end(Buffer.concat(chunks));
}

const SITE = "https://backend.convex.site";
const noNarration: Pick<DemoSessions, "watchNarration" | "narrationFile"> = {
  watchNarration: async () => () => {},
  narrationFile: async () => Buffer.alloc(0),
};

async function serve(
  t: TestContext,
  sessions: Omit<DemoSessions, keyof typeof noNarration> & Partial<DemoSessions>,
  vercelBody = false,
) {
  const api = createDemoApi({ ...noNarration, ...sessions }, SITE);
  let finish!: () => void;
  const handled = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const server = createServer(async (req, res) => {
    if (vercelBody) await restoreVercelBody(req);
    void api(req, res, () => res.end()).finally(finish);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, port: address.port, handled };
}

for (const vercelBody of [false, true]) {
  const transport = vercelBody ? "Vercel's restored body" : "plain HTTP";

  await test(`passes the access code from ${transport} to the session`, async (t) => {
    let receivedCode: string | undefined;
    const { port } = await serve(
      t,
      {
        codeRequired: true,
        start: async ({ code }) => {
          receivedCode = code;
          return session;
        },
        stop: async () => {},
        upload: async () => {},
        walk: async () => {},
      },
      vercelBody,
    );
    const response = await fetch(`http://127.0.0.1:${port}/demo/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "gallery" }),
    });

    assert.equal(response.status, 200);
    assert.equal(receivedCode, "gallery");
  });

  await test(`preserves photo bytes from ${transport}`, async (t) => {
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    let receivedPhoto: Uint8Array | undefined;
    let receivedId: string | undefined;
    const { port } = await serve(
      t,
      {
        codeRequired: false,
        start: async () => session,
        stop: async () => {},
        upload: async (id, bytes) => {
          receivedId = id;
          receivedPhoto = bytes;
        },
        walk: async () => {},
      },
      vercelBody,
    );
    const response = await fetch(`http://127.0.0.1:${port}/demo/api/sessions/${session.id}/photos`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: photo,
    });

    assert.equal(response.status, 204);
    assert.equal(receivedId, session.id);
    assert.deepEqual(receivedPhoto, photo);
  });

  await test(`rejects oversized photos from ${transport}`, { timeout: 3000 }, async (t) => {
    let uploaded = false;
    const { port } = await serve(
      t,
      {
        codeRequired: false,
        start: async () => session,
        stop: async () => {},
        upload: async () => {
          uploaded = true;
        },
        walk: async () => {},
      },
      vercelBody,
    );
    const response = await fetch(`http://127.0.0.1:${port}/demo/api/sessions/${session.id}/photos`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: Buffer.alloc(MAX_UPLOAD_BYTES + 1),
    });

    assert.equal(response.status, 413);
    assert.equal(((await response.json()) as { code: string }).code, "too_large");
    assert.equal(uploaded, false);
  });

  await test(`hands a painting picked via ${transport} to its phone`, async (t) => {
    const walks: [string, number][] = [];
    const { port } = await serve(
      t,
      {
        codeRequired: false,
        start: async () => session,
        stop: async () => {},
        upload: async () => {},
        walk: async (id, painting) => {
          if (!Number.isInteger(painting)) throw new DemoError(400, "unknown_painting", "Pick one of the paintings.");
          walks.push([id, painting]);
        },
      },
      vercelBody,
    );
    const walk = (body: unknown) =>
      fetch(`http://127.0.0.1:${port}/demo/api/sessions/${session.id}/walk`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", Connection: "close" },
      });

    assert.equal((await walk({ painting: 2 })).status, 204);
    const refused = await walk({ painting: "2" });
    assert.equal(refused.status, 400);
    assert.deepEqual(await refused.json(), { code: "unknown_painting", message: "Pick one of the paintings." });
    assert.deepEqual(walks, [[session.id, 2]]);
  });
}

await test("deletes a phone that finishes starting after the browser disconnects", { timeout: 3000 }, async (t) => {
  let markStarting!: () => void;
  const starting = new Promise<void>((resolve) => {
    markStarting = resolve;
  });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stopped: string[] = [];
  const { server, port, handled } = await serve(t, {
    codeRequired: false,
    start: async () => {
      markStarting();
      await blocked;
      return session;
    },
    stop: async (id) => {
      stopped.push(id);
    },
    upload: async () => {},
    walk: async () => {},
  });
  const closed = new Promise<void>((resolve) => {
    server.once("connection", (socket) => socket.once("close", () => resolve()));
  });
  const req = request({ host: "127.0.0.1", port, path: "/demo/api/sessions", method: "POST", agent: false });
  req.on("error", () => {});
  req.end("{}");
  try {
    await starting;
    req.destroy();
    await closed;
  } finally {
    release();
  }
  await handled;
  assert.deepEqual(stopped, [session.id]);
});

await test("keeps a phone running after delivering its session to the browser", async (t) => {
  const stopped: string[] = [];
  const { port, handled } = await serve(t, {
    codeRequired: false,
    start: async () => session,
    stop: async (id) => {
      stopped.push(id);
    },
    upload: async () => {},
    walk: async () => {},
  });
  const response = await fetch(`http://127.0.0.1:${port}/demo/api/sessions`, {
    method: "POST",
    body: "{}",
    headers: { Connection: "close" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), session);
  await handled;
  assert.deepEqual(stopped, []);
});

await test("leaves requests outside the API to the next handler", async (t) => {
  let started = false;
  const { port } = await serve(t, {
    codeRequired: false,
    start: async () => {
      started = true;
      return session;
    },
    stop: async () => {},
    upload: async () => {},
    walk: async () => {},
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/sessions`, { method: "POST", body: "{}" });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(started, false);
});

await test("streams the phone's narration to the page and stops watching when the page leaves", async (t) => {
  let stopped!: () => void;
  const stoppedWatching = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const { port } = await serve(t, {
    codeRequired: false,
    start: async () => session,
    stop: async () => {},
    upload: async () => {},
    walk: async () => {},
    watchNarration: async (id, onChange) => {
      assert.equal(id, session.id);
      setTimeout(() => {
        onChange(null);
        onChange({ source: `${SITE}/narration-playlist?render=r1`, playing: false, position: 3, rate: 1, at: 0 });
      });
      return stopped;
    },
  });
  const page = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/demo/api/sessions/${session.id}/narration`, {
    signal: page.signal,
  });
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  while (text.split("\n\n").length < 3) text += (await reader.read()).value;

  assert.deepEqual(
    text
      .split("\n\n")
      .filter(Boolean)
      .map((event) => JSON.parse(event.replace(/^data: /, ""))),
    [null, { src: "narration/playlist?render=r1", live: true, playing: false, position: 3, rate: 1 }],
  );
  page.abort();
  await stoppedWatching;
});
