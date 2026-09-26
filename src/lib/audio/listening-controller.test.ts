import { getNetworkStateAsync } from "expo-network";

import { reportError } from "@/lib/observability";
import { openingFixture, researchFixture } from "@/shared/audio/guide-fixtures";

import { ListeningController, type AudioHandle, type Playback } from "./listening-controller";
import { trackKey, type ListeningTrack } from "./narration";

jest.mock("expo-network", () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

const liveAudio = {
  uri: "https://example.convex.site/narration-playlist",
  sentences: [{ sentence: "A spoken guide.", factIds: ["f1"] }],
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
  seekTo = jest.fn(async () => {});
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
    render: jest.fn(async () => ({
      uri: "file:///audio.mp3",
      duration: 100,
      sentences: [{ sentence: "A spoken guide.", factIds: ["f1"] }],
    })),
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
  controller.move(trackKey(track("c")), -1);
  expect(controller.snapshot().queue.map((item) => item.work.title)).toEqual(["c", "b"]);
  controller.remove(trackKey(track("b")));
  expect(controller.snapshot().current?.work.title).toBe("a");
  expect(player.pause).not.toHaveBeenCalled();
  controller.dispose();
});

it("waits at the next artwork by default and autoplays only when enabled", async () => {
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
  expect(controller.snapshot().waiting).toBe(true);
  expect(second.play).not.toHaveBeenCalled();
  controller.setPauseBetween(false);
  controller.enqueue(track("c"));
  second.emit({ currentTime: 100, didJustFinish: true });
  await Promise.resolve();
  await Promise.resolve();
  const third = players.at(-1)!;
  third.emit();
  await Promise.resolve();
  expect(third.play).toHaveBeenCalled();
  controller.dispose();
});

it("ignores late synthesis after a different track or stop", async () => {
  const { controller, deps } = setup();
  let resolve!: (value: {
    uri: string;
    duration: number;
    sentences: { sentence: string; factIds: string[] }[];
  }) => void;
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
    duration: 3,
    sentences: [{ sentence: "Old script.", factIds: ["f1"] }],
  });
  await old;
  expect(deps.create).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().current?.work.title).toBe("b");
  controller.stop();
  expect(controller.snapshot().current).toBeUndefined();
  expect(deps.cancel).toHaveBeenCalled();
});

it("clamps seeks and restarts completed narration", async () => {
  const { controller, play, players } = setup();
  const first = await play(track("a"));
  await controller.seek(-15);
  expect(first.seekTo).toHaveBeenLastCalledWith(0);
  await controller.seek(150);
  expect(first.seekTo).toHaveBeenLastCalledWith(100);
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

it("shows a retryable error on synthesis failure without dropping the remaining queue", async () => {
  const { controller, deps } = setup();
  controller.enqueue(track("b"));
  deps.render.mockRejectedValueOnce(new Error("No voice"));
  await controller.play(track("a"));
  expect(controller.snapshot().phase).toBe("error");
  expect(controller.snapshot().queue).toHaveLength(1);
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
    sentences: [{ sentence: "A spoken guide.", factIds: ["f1"] }],
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
  expect(controller.snapshot().sentences).toEqual([{ sentence: "A spoken guide.", factIds: ["f1"] }]);
  expect(controller.snapshot().current).toEqual(original);
  controller.restart();
  await Promise.resolve();
  await Promise.resolve();
  expect(deps.render).toHaveBeenLastCalledWith(original);
  controller.stop();
  expect(controller.snapshot().sentences).toBeUndefined();
});

it("plays a live playlist at 1× and holds speed, seeking and restart until its length is known", async () => {
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
    error: expect.stringContaining("Retry"),
  });
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
