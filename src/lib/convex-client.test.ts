import type { ConvexReactClient } from "convex/react";

const wallClock = 1_791_012_926_000;
// React Native's performance.now() on an iPhone that has been awake for about 24 days since boot.
const bootUptime = 2_111_794_942;
const zeroTimestamp = "AAAAAAAAAAA=";
const originalWebSocket = globalThis.WebSocket;
let convex: ConvexReactClient | undefined;

type Version = { querySet: number; identity: number; ts: string };

// Answers like the Convex sync worker: the clock skew is the Connect stamp minus the server's clock.
class FakeSyncSocket {
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number; reason: string }) => void;
  private version: Version = { querySet: 0, identity: 0, ts: zeroTimestamp };
  private clockSkew?: number;
  private ping?: ReturnType<typeof setInterval>;

  constructor() {
    setTimeout(() => {
      this.onopen?.();
      this.ping = setInterval(() => this.reply({ type: "Ping" }), 30_000);
    }, 0);
  }

  send(data: string) {
    const message = JSON.parse(data) as { type: string; clientTs: number; baseVersion: number; newVersion: number };
    if (message.type === "Connect") this.clockSkew = message.clientTs - Date.now();
    if (message.type === "Authenticate") this.transition({ identity: message.baseVersion + 1 });
    if (message.type === "ModifyQuerySet") this.transition({ querySet: message.newVersion });
  }

  close() {
    clearInterval(this.ping);
    this.onclose?.({ code: 1000, reason: "" });
  }

  private transition(change: Partial<Version>) {
    const startVersion = this.version;
    this.version = { ...startVersion, ...change };
    this.reply({
      type: "Transition",
      startVersion,
      endVersion: this.version,
      modifications: [],
      clientClockSkew: this.clockSkew,
    });
  }

  private reply(message: object) {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(message) }), 0);
  }
}

function jwt(issuedAt: number, lifetimeSeconds: number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode({ iat: issuedAt, exp: issuedAt + lifetimeSeconds })}.signature`;
}

afterEach(async () => {
  await convex?.close();
  convex = undefined;
  globalThis.WebSocket = originalWebSocket;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("keeps a confirmed cached token at launch and refreshes it before it expires on a long-running phone", async () => {
  jest.useFakeTimers({ now: wallClock, doNotFake: ["performance"] });
  jest.spyOn(performance, "now").mockImplementation(() => bootUptime + Date.now() - wallClock);
  globalThis.WebSocket = FakeSyncSocket as unknown as typeof WebSocket;
  jest.isolateModules(() => {
    convex = jest.requireActual<typeof import("./convex-client")>("./convex-client").convex;
  });
  const now = wallClock / 1_000;
  const fetchToken = jest.fn(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
    // A 1 h token cached 30 min ago.
    forceRefreshToken ? jwt(Math.floor(Date.now() / 1_000), 3_600) : jwt(now - 1_800, 3_600),
  );
  const onChange = jest.fn();

  convex!.setAuth(fetchToken, onChange);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(onChange).toHaveBeenLastCalledWith(true);
  expect(fetchToken.mock.calls).toEqual([[{ forceRefreshToken: false }]]);

  await jest.advanceTimersByTimeAsync(29 * 60_000);
  expect(fetchToken).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(58_000);
  expect(fetchToken).toHaveBeenLastCalledWith({ forceRefreshToken: true });
});
