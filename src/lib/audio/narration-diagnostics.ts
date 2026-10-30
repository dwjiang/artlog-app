import type { Playback } from "./listening-controller";

const NATIVE_DOMAINS = new Set([
  "CoreMediaErrorDomain",
  "AVFoundationErrorDomain",
  "NSURLErrorDomain",
  "NSOSStatusErrorDomain",
]);
const PLAYER_STATES = new Set([
  "readyToPlay",
  "failed",
  "unknown",
  "playing",
  "paused",
  "waitingToPlayAtSpecifiedRate",
  "evaluatingBufferingRate",
  "noItemToPlay",
  "toMinimizeStalls",
]);

function playerState(value: string | undefined): string | null {
  if (!value) return null;
  return PLAYER_STATES.has(value) ? value : "other";
}

// AVPlayer's failure text ends with its NSError as "(Domain error Code)"; only a known domain and the number are kept.
export function playbackDiagnostics(status: Playback | undefined): Record<string, string | number | boolean | null> {
  const match = status?.error ? /\((\w+) error (-?\d{1,9})\.?\)/.exec(status.error) : null;
  return {
    playback_state: playerState(status?.playbackState),
    time_control: playerState(status?.timeControlStatus),
    waiting_reason: playerState(status?.reasonForWaitingToPlay),
    loaded: status?.isLoaded ?? null,
    native_domain: match ? (NATIVE_DOMAINS.has(match[1]) ? match[1] : "other") : status?.error ? "unparsed" : null,
    native_code: match ? Number(match[2]) : null,
    position_s: status ? Math.round(Math.min(Math.max(status.currentTime, 0), 86_400)) : null,
  };
}
