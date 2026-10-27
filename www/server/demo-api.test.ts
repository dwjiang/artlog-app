import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { test, type TestContext } from "node:test";

import { createDemoApi } from "./demo-api.ts";
import type { DemoSession, DemoSessions } from "./demo-sessions.ts";

const session: DemoSession = { id: "ios_test", endpointWebSocketUrl: "wss://stream", streamToken: "stream-token" };

async function serve(t: TestContext, sessions: DemoSessions) {
  const api = createDemoApi(sessions);
  let finish!: () => void;
  const handled = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const server = createServer((req, res) => {
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
  });
  const closed = new Promise<void>((resolve) => {
    server.once("connection", (socket) => socket.once("close", () => resolve()));
  });
  const req = request({ host: "127.0.0.1", port, path: "/api/sessions", method: "POST", agent: false });
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
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
    method: "POST",
    body: "{}",
    headers: { Connection: "close" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), session);
  await handled;
  assert.deepEqual(stopped, []);
});
