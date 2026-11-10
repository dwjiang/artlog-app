import { ConvexReactClient } from "convex/react";

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!url) {
  throw new Error("EXPO_PUBLIC_CONVEX_URL is not set; copy .env.example to .env.local");
}

let latest: { socket: WebSocket; started: number } | undefined;
let lastOpen: number | undefined;
let lastMessage: number | undefined;
let lastError: number | undefined;
let lastClose: number | undefined;
let lastCloseCode: number | null = null;

export function socketDiagnostics(): Record<string, number | null> {
  const age = (at: number | undefined) => (at === undefined ? null : Math.min(3_600_000, Math.max(0, Date.now() - at)));
  return {
    socket_ready_state: latest?.socket.readyState ?? null,
    socket_attempt_ms: age(latest?.started),
    socket_last_open_ms: age(lastOpen),
    socket_last_message_ms: age(lastMessage),
    socket_last_error_ms: age(lastError),
    socket_last_close_ms: age(lastClose),
    socket_last_close_code: lastCloseCode,
  };
}

// Convex stamps Connect with Date.now() + performance.now(), and React Native's performance.now() counts from device
// boot on iOS. The server echoes that stamp as the clock skew Convex uses to schedule the refresh of a reused cached
// token, so an unfixed stamp delays the refresh past the token's expiry by the phone's uptime.
class WallClockWebSocket extends WebSocket {
  private stamped = false;

  constructor(...args: ConstructorParameters<typeof WebSocket>) {
    super(...args);
    latest = { socket: this, started: Date.now() };
    // Observe alongside Convex's handlers. Never retain payloads, native error messages, or close reasons.
    this.addEventListener("open", () => {
      if (latest?.socket === this) lastOpen = Date.now();
    });
    this.addEventListener("message", () => {
      if (latest?.socket === this) lastMessage = Date.now();
    });
    this.addEventListener("error", () => {
      if (latest?.socket === this) lastError = Date.now();
    });
    this.addEventListener("close", (event) => {
      if (latest?.socket !== this) return;
      lastClose = Date.now();
      lastCloseCode = Number.isInteger(event.code) && event.code >= 1000 && event.code <= 4999 ? event.code : null;
    });
  }

  override send(data: Parameters<WebSocket["send"]>[0]): void {
    // Connect is always a socket's first message.
    if (!this.stamped && typeof data === "string") {
      this.stamped = true;
      const message = JSON.parse(data) as { type?: string };
      if (message.type === "Connect") data = JSON.stringify({ ...message, clientTs: Date.now() });
    }
    super.send(data);
  }
}

export const convex = new ConvexReactClient(url, {
  unsavedChangesWarning: false,
  initialAuthTokenReuse: true,
  webSocketConstructor: WallClockWebSocket,
});
