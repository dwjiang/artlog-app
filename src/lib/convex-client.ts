import { ConvexReactClient } from "convex/react";

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!url) {
  throw new Error("EXPO_PUBLIC_CONVEX_URL is not set; copy .env.example to .env.local");
}

// Convex stamps Connect with Date.now() + performance.now(), and React Native's performance.now() counts from device
// boot on iOS. The server echoes that stamp as the clock skew Convex uses to schedule the refresh of a reused cached
// token, so an unfixed stamp delays the refresh past the token's expiry by the phone's uptime.
class WallClockWebSocket extends WebSocket {
  private stamped = false;

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
