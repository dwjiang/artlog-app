import { ConvexError } from "convex/values";
import { getNetworkStateAsync } from "expo-network";

import { OfflineError } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";
import { openingFixture, researchFixture } from "@/shared/audio/guide-fixtures";

import type { GuideSentence } from "../../../convex/lib/validators";
import {
  ListeningController,
  type AudioHandle,
  type Playback,
  type ListeningDependencies,
} from "./listening-controller";
import { trackKey, type ListeningTrack } from "./narration";

jest.mock("expo-network", () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/ui/toast", () => ({ showErrorToast: jest.fn() }));

const liveAudio = {
  renderId: "live-render",
  uri: "https://example.convex.site/narration-playlist",
  sentences: [{ sentence: "A spoken guide.", factIds: ["f1"], section: "hook" as const }],
  live: true,
};
const track = (id: string): ListeningTrack => ({
  work: {
    artworkId: id as never,
    title: id,
    artist: "Artist",
    facts: researchFixture,
    researchUpdatedAt: 5,
    opening: openingFixture,
  },
});
class Player implements AudioHandle {
  callback?: (value: Playback) => void;
  seekableDuration = 0;
  currentStatus: Playback = {
    currentTime: 0,
    duration: 100,
    playing: false,
    isLoaded: true,
    didJustFinish: false,
    timeControlStatus: "paused",
  };
  play = jest.fn(() => {
    this.currentStatus = { ...this.currentStatus, playing: true, timeControlStatus: "playing" };
  });
  pause = jest.fn(() => {
    this.currentStatus = { ...this.currentStatus, playing: false, timeControlStatus: "paused" };
  });
  remove = jest.fn();
  setPlaybackRate = jest.fn();
  setActiveForLockScreen = jest.fn();
  seekTo = jest.fn<ReturnType<AudioHandle["seekTo"]>, Parameters<AudioHandle["seekTo"]>>(async (seconds) => {
    this.currentStatus = { ...this.currentStatus, currentTime: seconds, didJustFinish: false };
  });
  addListener(_event: "playbackStatusUpdate", callback: (value: Playback) => void) {
    this.callback = callback;
    return { remove: jest.fn() };
  }
  emit(patch: Partial<Playback> = {}) {
    this.currentStatus = {
      currentTime: 0,
      duration: 100,
      playing: false,
      isLoaded: true,
      didJustFinish: false,
      timeControlStatus: patch.playing ? "playing" : "paused",
      ...patch,
    };
    this.callback?.(this.currentStatus);
  }
}
function setup() {
  const players: Player[] = [];
  const deps = {
    render: jest.fn<ReturnType<ListeningDependencies["render"]>, Parameters<ListeningDependencies["render"]>>(
      async () => ({
        uri: "file:///audio.mp3",
        renderId: "stored-render",
        duration: 100,
        sentences: [{ sentence: "A spoken guide.", factIds: ["f1"], section: "hook" }],
      }),
    ),
    cancel: jest.fn(),
    invalidate: jest.fn(),
    configure: jest.fn(async () => {}),
    create: jest.fn(() => {
      const player = new Player();
      player.currentStatus = { ...player.currentStatus, isLoaded: false, duration: 0 };
      players.push(player);
      return player;
    }),
  };
  const controller = new ListeningController(deps);
  async function play(item: ListeningTrack) {
    await controller.play(item);
    const player = players.at(-1)!;
    player.emit();
    await Promise.resolve();
    return player;
  }
  return { controller, deps, players, play };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getNetworkStateAsync).mockResolvedValue({ isConnected: true, isInternetReachable: true });
});
afterEach(() => jest.useRealTimers());

it("preserves position for each artwork, including when another guide is loaded paused", async () => {
  const { controller, play, players } = setup();
  const first = await play(track("a"));
  first.emit({ currentTime: 22, playing: true });
  await controller.play(track("b"), false);
  const paused = players.at(-1)!;
  paused.emit();
  await Promise.resolve();
  expect(paused.play).not.toHaveBeenCalled();
  paused.emit({ currentTime: 8 });
  const resumed = await play(track("a"));
  expect(resumed.seekTo).toHaveBeenCalledWith(22, 0, 0);
  expect(controller.progressFor(track("b"))?.position).toBe(8);
  controller.dispose();
});

it("deduplicates queued versions, reorders and removes without interrupting playback", async () => {
  const { controller, play } = setup();
  const player = await play(track("a"));
  controller.enqueue(track("a"));
  controller.enqueue(track("b"));
  controller.enqueue(track("b"));
  controller.enqueue(track("c"));
  controller.enqueue(track("d"));
  const titles = () => controller.snapshot().queue.map((item) => item.work.title);
  controller.move(2, 0);
  expect(titles()).toEqual(["d", "b", "c"]);
  controller.move(0, 2);
  expect(titles()).toEqual(["b", "c", "d"]);
  controller.move(2, 3);
  expect(titles()).toEqual(["b", "c", "d"]);
  controller.remove(trackKey(track("b")));
  expect(controller.snapshot().current?.work.title).toBe("a");
  expect(player.pause).not.toHaveBeenCalled();
  controller.dispose();
});

it("plays the next artwork as soon as the current one finishes", async () => {
  const { controller, play, players } = setup();
  const first = await play(track("a"));
  controller.enqueue(track("b"));
  first.emit({ currentTime: 100, didJustFinish: true });
  await Promise.resolve();
  await Promise.resolve();
  const second = players.at(-1)!;
  second.emit();
  await Promise.resolve();
  expect(controller.snapshot().current?.work.title).toBe("b");
  expect(controller.snapshot().queue).toEqual([]);
  expect(controller.snapshot().waiting).toBe(false);
  expect(second.play).toHaveBeenCalled();
  controller.dispose();
});

it("keeps works that stop playing in history, most recent last, until cleared", async () => {
  const { controller, play, players } = setup();
  const first = await play(track("a"));
  controller.enqueue(track("b"));
  first.emit({ currentTime: 100, didJustFinish: true });
  await Promise.resolve();
  await Promise.resolve();
  players.at(-1)!.emit();
  await play(track("c"));
  const titles = () => controller.snapshot().history.map((item) => item.work.title);
  expect(titles()).toEqual(["a", "b"]);
  await play(track("a"));
  expect(titles()).toEqual(["b", "c"]);
  controller.restart();
  expect(titles()).toEqual(["b", "c"]);
  controller.stop();
  expect(titles()).toEqual(["b", "c", "a"]);
  controller.clearHistory();
  expect(titles()).toEqual([]);
  controller.dispose();
});

it("ignores late synthesis after a different track or stop", async () => {
  const { controller, deps } = setup();
  let resolve!: (value: { uri: string; renderId: string; duration: number; sentences: GuideSentence[] }) => void;
  deps.render.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const old = controller.play(track("a"));
  await Promise.resolve();
  await controller.play(track("b"));
  resolve({
    uri: "old",
    renderId: "old-render",
    duration: 3,
    sentences: [{ sentence: "Old script.", factIds: ["f1"], section: "hook" }],
  });
  await old;
  expect(deps.create).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().current?.work.title).toBe("b");
  controller.stop();
  expect(controller.snapshot().current).toBeUndefined();
  expect(controller.snapshot().renderId).toBeUndefined();
  expect(deps.cancel).toHaveBeenCalled();
});

it("clamps seeks and restarts completed narration", async () => {
  const { controller, play, players } = setup();
  const first = await play(track("a"));
  await controller.seek(-15);
  expect(first.seekTo).toHaveBeenLastCalledWith(0, 0, 0);
  await controller.seek(150);
  expect(first.seekTo).toHaveBeenLastCalledWith(100, 0, 0);
  first.emit({ currentTime: 100, didJustFinish: true });
  controller.toggle();
  await Promise.resolve();
  await Promise.resolve();
  const second = players.at(-1)!;
  second.emit();
  await Promise.resolve();
  expect(second.seekTo).toHaveBeenCalledWith(0, 0, 0);
  controller.dispose();
});

it("plays a paused guide from a sentence without toggling playback", async () => {
  const { controller, players } = setup();
  await controller.play(track("a"), false, true);
  const player = players.at(-1)!;
  player.emit();
  await Promise.resolve();
  await controller.seek(30, { play: true, clamp: false });
  expect(player.seekTo).toHaveBeenLastCalledWith(30, 0, 0);
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(controller.snapshot()).toMatchObject({ position: 30, waiting: false });
  player.emit({ currentTime: 30, playing: true });
  await controller.seek(60, { play: true, clamp: false });
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(player.pause).not.toHaveBeenCalled();
  controller.dispose();
});

it.each([
  { target: "sentence", play: true },
  { target: "section", play: false },
])("lands on the requested $target inside a live audio segment", async ({ play }) => {
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio);
  await controller.play(track("a"), false);
  const player = players.at(-1)!;
  player.seekableDuration = 24;
  player.emit({ duration: 0 });
  await Promise.resolve();
  try {
    // AVPlayer landed at 10.08 s for an 11.3 s HLS seek unless both tolerances were zero.
    player.seekTo.mockImplementationOnce(async (seconds, before, after) => {
      player.currentStatus = { ...player.currentStatus, currentTime: before === 0 && after === 0 ? seconds : 10.08 };
    });
    await controller.seek(11.3, { play, clamp: false });
    expect(controller.snapshot().position).toBe(11.3);
    expect(player.play).toHaveBeenCalledTimes(play ? 1 : 0);
  } finally {
    controller.dispose();
  }
});

it.each(["switch", "stop"])("ignores pending sentence playback after a %s", async (action) => {
  const { controller, play, players } = setup();
  await controller.play(track("a"), false);
  const first = players.at(-1)!;
  first.emit();
  await Promise.resolve();
  let finish!: () => void;
  first.seekTo.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
  const pending = controller.seek(30, { play: true, clamp: false });
  if (action === "switch") {
    const second = await play(track("b"));
    second.emit({ playing: true });
  } else {
    controller.stop();
  }
  finish();
  await pending;
  expect(first.play).not.toHaveBeenCalled();
  expect(players.at(-1)!.play).toHaveBeenCalledTimes(action === "switch" ? 1 : 0);
  expect(players.at(-1)!.pause).toHaveBeenCalledTimes(action === "switch" ? 0 : 1);
  expect(controller.snapshot()).toMatchObject({
    current: action === "switch" ? track("b") : undefined,
    phase: action === "switch" ? "ready" : "idle",
    playing: action === "switch",
  });
  controller.dispose();
});

it("does not start playback when a sentence seek fails", async () => {
  const { controller, players, deps } = setup();
  await controller.play(track("a"), false);
  const player = players.at(-1)!;
  player.emit();
  await Promise.resolve();
  const error = new Error("Seek failed");
  player.seekTo.mockRejectedValueOnce(error);
  await controller.seek(30, { play: true, clamp: false });
  expect(controller.snapshot().phase).toBe("error");
  expect(player.play).not.toHaveBeenCalled();
  expect(deps.render).toHaveBeenCalledTimes(1);
  expect(reportError).toHaveBeenCalledWith(error, "narration.seek");
  controller.dispose();
});

it("respects a pause requested while a sentence seek is pending", async () => {
  const { controller, play } = setup();
  const player = await play(track("a"));
  player.emit({ playing: true });
  let finish!: () => void;
  player.seekTo.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
  const pending = controller.seek(30, { play: true, clamp: false });
  controller.toggle();
  player.emit({ playing: false });
  finish();
  await pending;
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().playing).toBe(false);
  controller.dispose();
});

it("shows a retryable error on synthesis failure without dropping the remaining queue", async () => {
  const { controller, deps } = setup();
  controller.enqueue(track("b"));
  deps.render.mockRejectedValueOnce(new Error("No voice"));
  await controller.play(track("a"));
  expect(controller.snapshot().phase).toBe("error");
  expect(controller.snapshot().queue).toHaveLength(1);
  controller.dispose();
});

it.each([
  ["narration_not_configured", "Narration is unavailable right now."],
  ["model_unconfigured", "Narration is unavailable right now."],
  ["narration_provider_failed", "Narration is unavailable right now."],
  ["narration_busy", "Narration is busy. Try again shortly."],
  ["rate_limited", "Narration is busy. Try again shortly."],
  ["spend_cap", "Narration is paused for today."],
  ["device_banned", "Narration isn’t available on this phone."],
])("explains a %s failure from the backend without reporting it again", async (code, message) => {
  const { controller, deps } = setup();
  deps.render.mockRejectedValueOnce(new ConvexError({ code }));
  await controller.play(track("a"));
  expect(showErrorToast).toHaveBeenCalledWith(message, expect.any(Function), { quiet: true });
  expect(reportError).not.toHaveBeenCalled();
  controller.dispose();
});

it.each([
  [
    "an unexpected server error",
    new Error("[CONVEX A(narration:render)] [Request ID: 1] Server Error\n  Called by client"),
  ],
  [
    "an action timeout",
    new Error("[CONVEX A(narration:render)] [Request ID: 2] Your request timed out\n  Called by client"),
  ],
])("does not blame the connection for %s, which the backend reports", async (_name, error) => {
  const { controller, deps } = setup();
  deps.render.mockRejectedValueOnce(error);
  await controller.play(track("a"));
  expect(showErrorToast).toHaveBeenCalledWith("Narration is unavailable right now.", expect.any(Function), {
    quiet: true,
  });
  expect(reportError).not.toHaveBeenCalled();
  controller.dispose();
});

it.each([
  ["a lost action connection", new Error("[CONVEX A(narration:render)] Connection lost while action was in flight")],
  ["a download timeout", new Error("fetch failed: The request timed out.")],
])("asks the listener to check the connection after %s, without reporting it", async (_name, error) => {
  const { controller, deps } = setup();
  deps.render.mockRejectedValueOnce(error);
  await controller.play(track("a"));
  expect(showErrorToast).toHaveBeenCalledWith(
    "Couldn’t prepare narration. Check your connection.",
    expect.any(Function),
    { quiet: true },
  );
  expect(reportError).not.toHaveBeenCalled();
  controller.dispose();
});

it("says a guide needs a connection when the phone is offline", async () => {
  const { controller, deps } = setup();
  deps.render.mockRejectedValueOnce(new OfflineError());
  await controller.play(track("a"));
  expect(controller.snapshot().phase).toBe("error");
  expect(showErrorToast).toHaveBeenCalledWith("Couldn’t prepare narration while offline.", expect.any(Function), {
    quiet: true,
  });
  expect(reportError).not.toHaveBeenCalled();
  controller.dispose();
});

it("reports an unavailable narration in a toast whose Retry replays the failed track", async () => {
  const { controller, deps } = setup();
  deps.render.mockRejectedValueOnce(new ConvexError({ code: "narration_not_configured" }));
  await controller.play(track("a"));
  expect(showErrorToast).toHaveBeenCalledWith("Narration is unavailable right now.", expect.any(Function), {
    quiet: true,
  });
  const retry = jest.mocked(showErrorToast).mock.calls[0][1]!;
  retry();
  await Promise.resolve();
  expect(deps.render).toHaveBeenCalledTimes(2);
  expect(controller.snapshot()).toMatchObject({ phase: "loading", current: track("a") });
  controller.dispose();
});

it("reports a narration that failed on the phone with its artwork, leaving backend failures to the backend", async () => {
  const { controller, deps } = setup();
  const invalid = new Error("Narration transcript is invalid.");
  deps.render.mockRejectedValueOnce(invalid);
  await controller.play(track("a"));
  expect(reportError).toHaveBeenCalledWith(invalid, "narration.prepare", { data: { artworkId: "a" } });
  expect(showErrorToast).toHaveBeenCalledWith("Couldn’t prepare narration.", expect.any(Function), { quiet: true });
  jest.mocked(reportError).mockClear();
  deps.render.mockRejectedValueOnce(new ConvexError({ code: "narration_provider_failed" }));
  await controller.play(track("b"));
  expect(controller.snapshot().phase).toBe("error");
  expect(reportError).not.toHaveBeenCalled();
  controller.dispose();
});

it("plays a work before it has research and keeps the research its first play wrote", async () => {
  const { controller, deps, play } = setup();
  const facts = [{ id: "f1", sourceUrl: "https://museum.example/work", sourceLabel: "Museum" }];
  deps.render.mockResolvedValueOnce({
    uri: "file:///audio.mp3",
    renderId: "first-render",
    duration: 100,
    sentences: [{ sentence: "A spoken guide.", factIds: ["f1"], section: "hook" }],
    facts,
    researchUpdatedAt: 7,
  });
  await play({ work: { ...track("a").work, facts: [], researchUpdatedAt: undefined } });
  expect(deps.render).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().current?.work).toMatchObject({ artworkId: "a", facts, researchUpdatedAt: 7 });
  controller.dispose();
});

it("ignores a stale toast Retry once another track has started", async () => {
  const { controller, deps } = setup();
  deps.render.mockRejectedValueOnce(new Error("No voice"));
  await controller.play(track("a"));
  const retry = jest.mocked(showErrorToast).mock.calls[0][1]!;
  await controller.play(track("b"));
  retry();
  expect(deps.render).toHaveBeenCalledTimes(2);
  expect(controller.snapshot().current).toMatchObject(track("b"));
  controller.dispose();
});

it("resets progress when the research changes", async () => {
  const { controller, play } = setup();
  const original = track("a");
  const player = await play(original);
  player.emit({ currentTime: 22 });
  expect(controller.progressFor(original)?.position).toBe(22);
  expect(
    controller.progressFor({
      work: { ...original.work, researchUpdatedAt: 6 },
    }),
  ).toBeUndefined();
  controller.dispose();
});

it("learns the duration from downloaded audio and uses it when resuming and finishing", async () => {
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue({
    uri: "file:///shimmer.mp3",
    sentences: [{ sentence: "A spoken guide.", factIds: ["f1"], section: "hook" }],
  } as never);
  await controller.play(track("a"));
  const first = players.at(-1)!;
  first.emit({ duration: 27 });
  await Promise.resolve();
  first.emit({ currentTime: 12, duration: 27, playing: true });
  await controller.play(track("b"));
  await controller.play(track("a"));
  const resumed = players.at(-1)!;
  resumed.emit({ duration: 27 });
  await Promise.resolve();
  expect(resumed.seekTo).toHaveBeenCalledWith(12, 0, 0);
  resumed.emit({ currentTime: 27, duration: 27, didJustFinish: true });
  expect(controller.snapshot()).toMatchObject({
    duration: 27,
    position: 27,
    playing: false,
  });
  controller.dispose();
});

it("shows the spoken transcript while retaining the original evidence for replay", async () => {
  const { controller, play, deps } = setup();
  const original = track("a");
  await play(original);
  expect(controller.snapshot().sentences).toEqual([{ sentence: "A spoken guide.", factIds: ["f1"], section: "hook" }]);
  const replay = { work: { ...original.work, renderId: "stored-render" } };
  expect(controller.snapshot().current).toEqual(replay);
  controller.restart();
  await Promise.resolve();
  await Promise.resolve();
  expect(deps.render).toHaveBeenLastCalledWith(replay, expect.any(Function));
  controller.stop();
  expect(controller.snapshot().sentences).toBeUndefined();
});

it("plays a live playlist at 1× and holds speed until its length is known", async () => {
  const { controller, deps, players } = setup();
  controller.setRate(1.5);
  deps.render.mockResolvedValue(liveAudio as never);
  await controller.play(track("a"));
  const player = players.at(-1)!;
  expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1);
  player.emit({ duration: 0 });
  await Promise.resolve();
  expect(player.seekTo).toHaveBeenCalledWith(0, 0, 0);
  expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(1);
  player.emit({ duration: 0, currentTime: 3, playing: true });
  controller.setRate(2);
  await controller.seek(30);
  expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1);
  expect(player.seekTo).toHaveBeenCalledTimes(1);
  controller.toggle();
  player.emit({ duration: 0, currentTime: 3, playing: false });
  controller.toggle();
  expect(player.play).toHaveBeenCalledTimes(2);
  expect(deps.render).toHaveBeenCalledTimes(1);
  player.emit({ duration: 61, currentTime: 4, playing: true });
  expect(player.setPlaybackRate).toHaveBeenLastCalledWith(2);
  expect(player.setActiveForLockScreen.mock.calls.slice(1)).toEqual([
    [false],
    [true, { title: "a", artist: "Artist", artworkUrl: undefined }],
  ]);
  expect(controller.snapshot()).toMatchObject({ duration: 61, rate: 2 });
  controller.dispose();
});

it("seeks within the native range before the total duration is known, then uses the full duration", async () => {
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio);
  await controller.play(track("a"));
  const player = players.at(-1)!;
  player.seekableDuration = 24;
  await controller.seek(12);
  expect(player.seekTo).not.toHaveBeenCalled();
  player.emit({ duration: 0 });
  await Promise.resolve();
  player.emit({ duration: 0, currentTime: 8, playing: true });
  expect(controller.snapshot()).toMatchObject({ duration: 0, availableDuration: 24 });
  await controller.seek(12);
  expect(player.seekTo).toHaveBeenLastCalledWith(12, 0, 0);
  await controller.seek(40);
  expect(player.seekTo).toHaveBeenLastCalledWith(24, 0, 0);
  await controller.seek(-15);
  expect(player.seekTo).toHaveBeenLastCalledWith(0, 0, 0);
  player.seekableDuration = 48;
  await controller.seek(40);
  expect(player.seekTo).toHaveBeenLastCalledWith(40, 0, 0);
  player.emit({ duration: 61, currentTime: 40, playing: true });
  await controller.seek(90);
  expect(player.seekTo).toHaveBeenLastCalledWith(61, 0, 0);
  controller.dispose();
});

it("clears the native range and ignores late playback events after changing tracks or stopping", async () => {
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio);
  await controller.play(track("a"));
  const first = players.at(-1)!;
  first.seekableDuration = 24;
  first.emit({ duration: 0 });
  await Promise.resolve();
  await controller.play(track("b"));
  first.seekableDuration = 48;
  first.emit({ duration: 0 });
  expect(controller.snapshot().availableDuration).toBe(0);
  const second = players.at(-1)!;
  second.seekableDuration = 12;
  second.emit({ duration: 0 });
  await Promise.resolve();
  expect(controller.snapshot().availableDuration).toBe(12);
  controller.stop();
  second.emit({ duration: 0 });
  expect(controller.snapshot().availableDuration).toBe(0);
});

it("clamps live seeks to the native range, including changes since the last status event", async () => {
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio);
  await controller.play(track("a"));
  const player = players.at(-1)!;
  player.seekableDuration = 42.383;
  player.emit({ duration: 0 });
  await Promise.resolve();
  try {
    expect(controller.snapshot().availableDuration).toBe(42.383);
    await controller.seek(48.384);
    expect(player.seekTo).toHaveBeenLastCalledWith(42.383, 0, 0);
    expect(controller.snapshot().position).toBe(42.383);
    player.seekableDuration = 50;
    await controller.seek(60);
    expect(player.seekTo).toHaveBeenLastCalledWith(50, 0, 0);
    player.seekableDuration = 0;
    const calls = player.seekTo.mock.calls.length;
    await controller.seek(15);
    expect(player.seekTo).toHaveBeenCalledTimes(calls);
  } finally {
    controller.dispose();
  }
});

it("refuses an unavailable sentence jump instead of clamping it to earlier audio", async () => {
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio);
  await controller.play(track("a"), false);
  const player = players.at(-1)!;
  player.seekableDuration = 4;
  player.emit({ duration: 0 });
  await Promise.resolve();
  try {
    player.seekTo.mockClear();
    await controller.seek(30, { play: true, clamp: false });
    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
    player.seekableDuration = 40;
    await controller.seek(30, { play: true, clamp: false });
    expect(player.seekTo).toHaveBeenCalledWith(30, 0, 0);
    expect(player.play).toHaveBeenCalledTimes(1);
  } finally {
    controller.dispose();
  }
});

it("refreshes the native seek range while paused without playback events", async () => {
  jest.useFakeTimers();
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio);
  await controller.play(track("a"), false);
  const player = players.at(-1)!;
  player.emit({ duration: 0 });
  await Promise.resolve();
  try {
    player.seekableDuration = 18.191;
    await jest.advanceTimersByTimeAsync(1000);
    expect(controller.snapshot().availableDuration).toBe(18.191);
    player.seekableDuration = 0;
    await jest.advanceTimersByTimeAsync(1000);
    expect(controller.snapshot().availableDuration).toBe(0);
  } finally {
    controller.dispose();
  }
});

it("keeps actual native position when a seek resolves without reaching its target", async () => {
  const { controller, play } = setup();
  const player = await play(track("a"));
  player.emit({ currentTime: 12, playing: true });
  player.seekTo.mockImplementationOnce(async () => {});
  await controller.seek(40);
  expect(controller.snapshot().position).toBe(12);
  expect(controller.progressFor(track("a"))?.position).toBe(12);
  player.seekTo.mockImplementationOnce(async () => {
    player.currentStatus = { ...player.currentStatus, currentTime: 39.9 };
  });
  await controller.seek(40);
  expect(controller.snapshot().position).toBe(39.9);
  controller.dispose();
});

it("disables seeking and reports a range read failure without interrupting live playback", async () => {
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio);
  await controller.play(track("a"));
  const player = players.at(-1)!;
  player.seekableDuration = 18;
  player.emit({ duration: 0 });
  await Promise.resolve();
  const error = new Error("Native range unavailable");
  Object.defineProperty(player, "seekableDuration", {
    get: () => {
      throw error;
    },
  });
  player.emit({ duration: 0, currentTime: 12, playing: true });
  expect(controller.snapshot()).toMatchObject({ phase: "ready", playing: true, availableDuration: 0 });
  expect(reportError).toHaveBeenCalledWith(error, "narration.seekableRange");
  const calls = player.seekTo.mock.calls.length;
  await controller.seek(15);
  expect(player.seekTo).toHaveBeenCalledTimes(calls);
  controller.dispose();
});

it.each([0, 60])("resumes progress saved without a duration when the next duration is %s", async (duration) => {
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio as never);
  await controller.play(track("a"));
  const first = players.at(-1)!;
  first.emit({ duration: 0 });
  await Promise.resolve();
  first.emit({ duration: 0, currentTime: 5, playing: true });
  controller.stop();
  deps.render.mockResolvedValue({ ...liveAudio, live: duration === 0 } as never);
  await controller.play(track("a"));
  const resumed = players.at(-1)!;
  resumed.emit({ duration });
  await Promise.resolve();
  expect(resumed.seekTo).toHaveBeenCalledWith(5, 0, 0);
  controller.dispose();
});

it("offers Retry for a stalled playlist even when the native player stops emitting events", async () => {
  jest.useFakeTimers();
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio as never);
  await controller.play(track("a"));
  const player = players.at(-1)!;
  player.emit({ duration: 0 });
  await Promise.resolve();
  controller.enqueue(track("b"));
  player.emit({ duration: 0, currentTime: 4, playing: true });
  await jest.advanceTimersByTimeAsync(1000);
  player.currentStatus = { ...player.currentStatus, playing: false, timeControlStatus: "waitingToPlayAtSpecifiedRate" };
  await jest.advanceTimersByTimeAsync(14999);
  expect(controller.snapshot().phase).toBe("ready");
  await jest.advanceTimersByTimeAsync(1);
  expect(controller.snapshot()).toMatchObject({
    phase: "error",
    playing: false,
    renderId: "live-render",
  });
  expect(showErrorToast).toHaveBeenCalledWith("Audio stopped responding.", expect.any(Function), { quiet: true });
  expect(controller.snapshot().queue).toEqual([track("b")]);
  expect(player.remove).toHaveBeenCalledTimes(1);
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "narration.playback");
  controller.toggle();
  await Promise.resolve();
  await Promise.resolve();
  expect(deps.render).toHaveBeenCalledTimes(2);
  const retried = players.at(-1)!;
  retried.emit({ duration: 60 });
  await Promise.resolve();
  expect(retried.seekTo).toHaveBeenCalledWith(4, 0, 0);
  expect(controller.snapshot().phase).toBe("ready");
  controller.dispose();
  expect(jest.getTimerCount()).toBe(0);
});

it("does not time out a stream paused in the app, by native controls, or between queued works", async () => {
  jest.useFakeTimers();
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio as never);
  await controller.play(track("a"), false, true);
  const player = players.at(-1)!;
  player.emit({ duration: 0 });
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(30000);
  expect(controller.snapshot()).toMatchObject({ phase: "ready", waiting: true });
  controller.toggle();
  player.emit({ duration: 0, currentTime: 1, playing: true });
  controller.toggle();
  await jest.advanceTimersByTimeAsync(30000);
  expect(controller.snapshot().phase).toBe("ready");
  player.play();
  player.pause();
  await jest.advanceTimersByTimeAsync(30000);
  expect(controller.snapshot().phase).toBe("ready");
  expect(reportError).not.toHaveBeenCalled();
  controller.dispose();
});

it("uses native progress when status events are delayed and clears the watchdog on a different track", async () => {
  jest.useFakeTimers();
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValueOnce(liveAudio as never);
  await controller.play(track("a"));
  const player = players.at(-1)!;
  player.emit({ duration: 0 });
  await Promise.resolve();
  for (let currentTime = 5; currentTime <= 30; currentTime += 5) {
    player.currentStatus = { ...player.currentStatus, currentTime };
    await jest.advanceTimersByTimeAsync(5000);
  }
  expect(controller.snapshot().phase).toBe("ready");
  await controller.play(track("b"));
  players.at(-1)!.emit();
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(30000);
  expect(controller.snapshot()).toMatchObject({ phase: "ready", current: track("b") });
  expect(reportError).not.toHaveBeenCalled();
  controller.dispose();
});

it("still offers Retry offline without reporting the network interruption", async () => {
  jest.useFakeTimers();
  jest.mocked(getNetworkStateAsync).mockResolvedValue({ isConnected: false, isInternetReachable: false });
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio as never);
  await controller.play(track("a"));
  players.at(-1)!.emit({ duration: 0 });
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(15000);
  expect(controller.snapshot().phase).toBe("error");
  expect(reportError).not.toHaveBeenCalled();
  controller.dispose();
});

it("stops monitoring once streamed narration finishes", async () => {
  jest.useFakeTimers();
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio as never);
  await controller.play(track("a"));
  const player = players.at(-1)!;
  player.emit({ duration: 0 });
  await Promise.resolve();
  player.emit({ duration: 60, currentTime: 60, didJustFinish: true });
  expect(jest.getTimerCount()).toBe(0);
  await jest.advanceTimersByTimeAsync(30000);
  expect(controller.snapshot()).toMatchObject({ phase: "ready", playing: false, position: 60 });
  expect(reportError).not.toHaveBeenCalled();
  controller.dispose();
});

it("takes a live guide's length from where it ended when the player never reported one, so Play starts it again", async () => {
  jest.useFakeTimers();
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue(liveAudio as never);
  await controller.play(track("a"));
  const player = players.at(-1)!;
  player.emit({ duration: 0 });
  await Promise.resolve();
  player.emit({ duration: 0, currentTime: 58, didJustFinish: true });
  expect(controller.snapshot()).toMatchObject({ playing: false, position: 58, duration: 58 });
  // A finished guide is not resumable at its end; the next play starts it from the beginning.
  expect(controller.progressFor(track("a"))).toMatchObject({ position: 58, duration: 58 });
  deps.render.mockClear();
  controller.toggle();
  await Promise.resolve();
  expect(deps.render).toHaveBeenCalledTimes(1);
  controller.dispose();
});

it("tracks real preparation stages and clears them when playback is ready", async () => {
  const { controller, deps, players } = setup();
  deps.render.mockImplementationOnce(async (_track, onStage) => {
    onStage?.("generating");
    expect(controller.snapshot().preparationStage).toEqual("generating");
    onStage?.("downloading");
    expect(controller.snapshot().preparationStage).toEqual("downloading");
    return liveAudio;
  });
  const pending = controller.play(track("a"));
  expect(controller.snapshot().preparationStage).toEqual("preparing");
  await pending;
  expect(controller.snapshot().preparationStage).toEqual("buffering");
  players[0].emit();
  await Promise.resolve();
  expect(controller.snapshot().phase).toBe("ready");
  expect(controller.snapshot().preparationStage).toBeUndefined();
  controller.dispose();
});

it("ignores old preparation updates after switching tracks or stopping", async () => {
  const { controller, deps } = setup();
  let oldStage: Parameters<ListeningDependencies["render"]>[1];
  deps.render.mockImplementationOnce(async (_track, onStage) => {
    oldStage = onStage;
    return liveAudio;
  });
  await controller.play(track("a"));
  await controller.play(track("b"));
  const current = controller.snapshot().preparationStage;
  oldStage?.("downloading");
  expect(controller.snapshot().preparationStage).toBe(current);
  controller.stop();
  oldStage?.("generating");
  expect(controller.snapshot().preparationStage).toBeUndefined();
});

it("clears preparation on failure and reports the new attempt on retry", async () => {
  const { controller, deps } = setup();
  deps.render.mockRejectedValueOnce(new Error("No audio"));
  await controller.play(track("a"));
  expect(controller.snapshot().phase).toBe("error");
  expect(controller.snapshot().preparationStage).toBeUndefined();
  const retry = controller.play(track("a"));
  expect(controller.snapshot().preparationStage).toBe("preparing");
  await retry;
  expect(controller.snapshot().preparationStage).toBe("buffering");
  controller.dispose();
});

it("keeps the learned render identity for cached replay and retries", async () => {
  const { controller, deps, play } = setup();
  await play(track("a"));
  controller.restart();
  await Promise.resolve();
  expect(deps.render).toHaveBeenLastCalledWith(
    { work: { ...track("a").work, renderId: "stored-render" } },
    expect.any(Function),
  );
  controller.dispose();
});

it.each(["research", "script"])("discards saved position and duration when the returned %s changes", async (change) => {
  const { controller, deps, play, players } = setup();
  const original = { work: { ...track("a").work, renderId: "stored-render" } };
  const first = await play(original);
  first.emit({ currentTime: 70, duration: 100, playing: true });
  controller.stop();
  deps.render.mockResolvedValueOnce({
    ...liveAudio,
    renderId: change === "script" ? "replacement-render" : "stored-render",
    sentences:
      change === "script" ? [{ ...liveAudio.sentences[0], sentence: "A replacement guide." }] : liveAudio.sentences,
    researchUpdatedAt: change === "research" ? 6 : 5,
  });
  await controller.play(original);
  expect(controller.snapshot()).toMatchObject({ position: 0, duration: 0 });
  const replacement = players.at(-1)!;
  replacement.emit({ duration: 0 });
  await Promise.resolve();
  expect(replacement.seekTo).toHaveBeenCalledWith(0, 0, 0);
  controller.dispose();
});

it("preserves progress in an unchanged script when speech retry creates a new recording", async () => {
  const { controller, deps, play, players } = setup();
  const original = { work: { ...track("a").work, renderId: "stored-render" } };
  const first = await play(original);
  first.emit({ currentTime: 30, duration: 100, playing: true });
  controller.stop();
  deps.render.mockResolvedValueOnce({ ...liveAudio, renderId: "replacement-render" });
  await controller.play(original);
  expect(controller.snapshot()).toMatchObject({ position: 30, duration: 0 });
  const replacement = players.at(-1)!;
  replacement.emit({ duration: 0 });
  await Promise.resolve();
  expect(replacement.seekTo).toHaveBeenCalledWith(30, 0, 0);
  controller.dispose();
});

it("restarts a completed script when the next play already knows its replacement recording", async () => {
  const { controller, deps, play, players } = setup();
  const first = await play(track("a"));
  first.emit({ currentTime: 100, duration: 100, didJustFinish: true });
  controller.stop();
  deps.render.mockResolvedValueOnce({ ...liveAudio, renderId: "replacement-render" });
  await controller.play({ work: { ...track("a").work, renderId: "replacement-render" } });
  const replacement = players.at(-1)!;
  replacement.emit({ duration: 0 });
  await Promise.resolve();
  expect(replacement.seekTo).toHaveBeenCalledWith(0, 0, 0);
  controller.dispose();
});

it("starts a player already loaded before its event subscription", async () => {
  const { controller, deps } = setup();
  const player = new Player();
  deps.create.mockReturnValueOnce(player);
  await controller.play(track("a"));
  await Promise.resolve();
  expect(player.seekTo).toHaveBeenCalledWith(0, 0, 0);
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(controller.snapshot()).toMatchObject({ phase: "ready", playing: true });
  controller.dispose();
});

it("applies rapid play and pause requests using native state before events arrive", async () => {
  const { controller, players } = setup();
  await controller.play(track("a"), false);
  const player = players.at(-1)!;
  player.emit();
  await Promise.resolve();
  controller.toggle();
  expect(controller.snapshot().playing).toBe(true);
  controller.toggle();
  expect(player.pause).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().playing).toBe(false);
  controller.toggle();
  expect(player.play).toHaveBeenCalledTimes(2);
  expect(controller.snapshot().playing).toBe(true);
  controller.dispose();
});

it.each([true, false])("synchronizes native pause and progress when events are delayed (live=%s)", async (live) => {
  jest.useFakeTimers();
  const { controller, deps, play } = setup();
  if (live) deps.render.mockResolvedValueOnce(liveAudio);
  const player = await play(track("a"));
  player.emit({ currentTime: 4, playing: true });
  player.currentStatus = { ...player.currentStatus, currentTime: 12, playing: false, timeControlStatus: "paused" };
  await jest.advanceTimersByTimeAsync(1000);
  expect(controller.snapshot()).toMatchObject({ phase: "ready", position: 12, playing: false });
  expect(controller.progressFor(controller.snapshot().current!)?.position).toBe(12);
  controller.dispose();
});

it("advances the queue when a finished guide is replayed from a sentence", async () => {
  const { controller, play, deps } = setup();
  const player = await play(track("a"));
  player.emit({ currentTime: 100, didJustFinish: true });
  await controller.seek(20, { play: true, clamp: false });
  controller.enqueue(track("b"));
  player.emit({ currentTime: 100, didJustFinish: true });
  player.emit({ currentTime: 100, didJustFinish: true });
  await Promise.resolve();
  expect(controller.snapshot().current?.work.artworkId).toBe("b");
  expect(deps.render).toHaveBeenCalledTimes(2);
  controller.dispose();
});

it.each([false, true])("invalidates only local audio on native playback failure (live=%s)", async (live) => {
  const { controller, deps, play } = setup();
  if (live) deps.render.mockResolvedValueOnce(liveAudio);
  const player = await play(track("a"));
  player.emit({ playbackState: "failed" });
  player.emit({ playbackState: "failed" });
  await Promise.resolve();
  expect(deps.invalidate.mock.calls).toEqual(live ? [] : [["stored-render"]]);
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "narration.playback");
  expect(controller.snapshot().phase).toBe("error");
  controller.dispose();
});

it("offers retry without reporting an expected offline stream failure", async () => {
  const { controller, deps, play } = setup();
  deps.render.mockResolvedValueOnce(liveAudio);
  jest.mocked(getNetworkStateAsync).mockResolvedValue({ isConnected: false, isInternetReachable: false });
  const player = await play(track("a"));
  player.emit({ playbackState: "failed" });
  await Promise.resolve();
  expect(controller.snapshot().phase).toBe("error");
  expect(showErrorToast).toHaveBeenCalledWith("Couldn’t play audio.", expect.any(Function), { quiet: true });
  expect(deps.invalidate).not.toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
  controller.dispose();
});

it("handles native item failure even when the player status has not failed", async () => {
  const { controller, deps, players } = setup();
  await controller.play(track("a"));
  players[0].emit({ isLoaded: false, playbackState: "unknown", error: "Cannot decode file" });
  expect(deps.invalidate).toHaveBeenCalledWith("stored-render");
  expect(controller.snapshot().phase).toBe("error");
  controller.dispose();
});

it("retains valid cached audio when seeking fails", async () => {
  const { controller, deps, play } = setup();
  const player = await play(track("a"));
  player.seekTo.mockRejectedValueOnce(new Error("Seek failed"));
  await controller.seek(20);
  expect(deps.invalidate).not.toHaveBeenCalled();
  expect(controller.snapshot().phase).toBe("error");
  controller.dispose();
});

it("still offers playback recovery if invalidating a corrupt cache fails", async () => {
  const { controller, deps, play } = setup();
  const player = await play(track("a"));
  const error = new Error("Cache could not be removed");
  deps.invalidate.mockImplementationOnce(() => {
    throw error;
  });
  player.emit({ playbackState: "failed" });
  expect(reportError).toHaveBeenCalledWith(error, "narration.cache");
  expect(controller.snapshot().phase).toBe("error");
  controller.dispose();
});

it("restores the selected speed after a native interruption resumes at 1×", async () => {
  const { controller, play } = setup();
  controller.setRate(1.5);
  const player = await play(track("a"));
  player.setPlaybackRate.mockClear();
  player.setPlaybackRate.mockImplementation((rate: number) => {
    player.currentStatus = { ...player.currentStatus, playbackRate: rate };
  });
  player.emit({ playing: false, playbackRate: 0 });
  expect(player.setPlaybackRate).not.toHaveBeenCalled();
  player.emit({ playing: true, playbackRate: 1 });
  expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);
  player.callback?.(player.currentStatus);
  expect(player.setPlaybackRate).toHaveBeenCalledTimes(1);
  expect(controller.snapshot()).toMatchObject({ playing: true, rate: 1.5 });
  controller.dispose();
});

it("keeps native speed at 1× while live speech is unfinished before restoring the selected speed", async () => {
  const { controller, deps, players } = setup();
  controller.setRate(1.5);
  deps.render.mockResolvedValueOnce(liveAudio);
  await controller.play(track("a"));
  const player = players.at(-1)!;
  player.emit({ duration: 0 });
  await Promise.resolve();
  player.setPlaybackRate.mockClear();
  player.emit({ duration: 0, playing: true, playbackRate: 1 });
  expect(player.setPlaybackRate).not.toHaveBeenCalled();
  player.emit({ duration: 60, playing: true, playbackRate: 1 });
  expect(player.setPlaybackRate).toHaveBeenCalledTimes(1);
  expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);
  controller.dispose();
});

it("follows the opening its script was spoken with when the work was corrected after being queued", async () => {
  const { controller, deps, play } = setup();
  const queued = track("a");
  const opening = "Artist. a. Circa 1916.";
  deps.render.mockResolvedValueOnce({
    uri: "file:///audio.mp3",
    renderId: "corrected",
    duration: 100,
    sentences: [
      { sentence: opening, factIds: [], section: "hook" },
      { sentence: "A spoken guide.", factIds: ["f1"], section: "hook" },
    ],
  });
  const player = await play(queued);
  player.emit({ currentTime: 30 });
  expect(controller.snapshot().current?.work).toMatchObject({ opening, renderId: "corrected" });
  // The work's page now builds its track from the corrected record.
  const corrected = { work: { ...queued.work, opening, renderId: "corrected" } };
  expect(controller.progressFor(corrected)?.position).toBe(30);
  controller.dispose();
});

it("keeps the track's opening when the script does not start with one", async () => {
  const { controller, play } = setup();
  await play(track("a"));
  expect(controller.snapshot().current?.work.opening).toBe(openingFixture);
  controller.dispose();
});

it("leaves a guide paused and ready when it finishes preparing long after the tap", async () => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });
  const { controller, deps, players } = setup();
  let finish!: () => void;
  deps.render.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(liveAudio);
      }),
  );
  const pending = controller.play(track("a"));
  await jest.advanceTimersByTimeAsync(121_000);
  finish();
  await pending;
  const player = players.at(-1)!;
  player.emit({ duration: 0 });
  await Promise.resolve();
  expect(controller.snapshot()).toMatchObject({ phase: "ready", playing: false, waiting: true });
  expect(player.play).not.toHaveBeenCalled();
  controller.toggle();
  expect(player.play).toHaveBeenCalledTimes(1);
  controller.dispose();
});

it("still plays a guide that takes a while to prepare", async () => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });
  const { controller, deps, players } = setup();
  let finish!: () => void;
  deps.render.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(liveAudio);
      }),
  );
  const pending = controller.play(track("a"));
  await jest.advanceTimersByTimeAsync(90_000);
  finish();
  await pending;
  players.at(-1)!.emit({ duration: 0 });
  await Promise.resolve();
  expect(players.at(-1)!.play).toHaveBeenCalledTimes(1);
  controller.dispose();
});

describe("audio that never finishes loading", () => {
  beforeEach(() => jest.useFakeTimers());

  it("reports a cached file once, without the work or its text", async () => {
    const { controller, deps } = setup();
    await controller.play(track("a"));
    await jest.advanceTimersByTimeAsync(15_000);
    expect(controller.snapshot().phase).toBe("error");
    expect(showErrorToast).toHaveBeenCalledWith("Couldn’t load audio.", expect.any(Function), { quiet: true });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(new Error("Narration load timed out"), "narration.playback");
    await jest.advanceTimersByTimeAsync(60_000);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(deps.render).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("reports a stream that never loads while the phone is online", async () => {
    const { controller, deps } = setup();
    deps.render.mockResolvedValueOnce(liveAudio);
    await controller.play(track("a"));
    await jest.advanceTimersByTimeAsync(15_000);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(new Error("Narration load timed out"), "narration.playback");
    controller.dispose();
  });
});
