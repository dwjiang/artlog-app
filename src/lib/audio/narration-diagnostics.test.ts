import { playbackDiagnostics } from "./narration-diagnostics";

const status = {
  currentTime: 12.6,
  duration: 90,
  playing: false,
  isLoaded: true,
  didJustFinish: false,
  playbackState: "failed",
  timeControlStatus: "paused",
  reasonForWaitingToPlay: "unknown",
};

it("keeps a known native error domain and code from the player's failure text, never the text", () => {
  const diagnostics = playbackDiagnostics({
    ...status,
    error: "The operation couldn’t be completed. (CoreMediaErrorDomain error -12938.)",
  });
  expect(diagnostics).toEqual({
    playback_state: "failed",
    time_control: "paused",
    waiting_reason: "unknown",
    loaded: true,
    native_domain: "CoreMediaErrorDomain",
    native_code: -12938,
    position_s: 13,
  });
});

it("masks unknown domains, free-form errors and unexpected player states", () => {
  expect(playbackDiagnostics({ ...status, error: "(PrivateDomain error 7)" })).toMatchObject({
    native_domain: "other",
    native_code: 7,
  });
  const freeForm = playbackDiagnostics({
    ...status,
    playbackState: "custom state",
    error: "Cannot open /private/path",
  });
  expect(freeForm).toMatchObject({ native_domain: "unparsed", native_code: null, playback_state: "other" });
  expect(JSON.stringify(freeForm)).not.toContain("private");
  expect(playbackDiagnostics(undefined)).toMatchObject({ playback_state: null, position_s: null });
});
