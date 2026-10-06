import { ConvexError } from "convex/values";
import { getNetworkStateAsync } from "expo-network";

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
    this.currentStatus = { ...this.currentStatus, currentTime: seconds };
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
    configure: jest.fn(async () => {}),
    create: jest.fn(() => {
      const player = new Player();
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

it("reports an unavailable narration in a toast whose Retry replays the failed track", async () => {
  const { controller, deps } = setup();
  deps.render.mockRejectedValueOnce(new ConvexError({ code: "narration_not_configured" }));
  await controller.play(track("a"));
  expect(showErrorToast).toHaveBeenCalledWith("Narration is unavailable right now.", expect.any(Function));
  const retry = jest.mocked(showErrorToast).mock.calls[0][1]!;
  retry();
  await Promise.resolve();
  expect(deps.render).toHaveBeenCalledTimes(2);
  expect(controller.snapshot()).toMatchObject({ phase: "loading", current: track("a") });
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
  expect(controller.snapshot().current).toEqual(track("b"));
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
  expect(controller.snapshot().current).toEqual(original);
  controller.restart();
  await Promise.resolve();
  await Promise.resolve();
  expect(deps.render).toHaveBeenLastCalledWith(original, expect.any(Function));
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
  expect(showErrorToast).toHaveBeenCalledWith("Audio stopped responding.", expect.any(Function));
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
