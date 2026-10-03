import { timestampInSeconds } from "@sentry/core";

// iOS pauses React Native's monotonic clock during sleep. Prime Sentry's cached Date.now fallback
// before SDK initialization, then restore Performance so animations retain their native timebase.
const origin = Object.getOwnPropertyDescriptor(performance, "timeOrigin");
Object.defineProperty(performance, "timeOrigin", { configurable: true, value: 0 });
try {
  timestampInSeconds();
} finally {
  if (origin) Object.defineProperty(performance, "timeOrigin", origin);
  else Reflect.deleteProperty(performance, "timeOrigin");
}
