import { researchKey, trackKey, type ListeningTrack } from "./narration";
import { convexErrorCode } from "../network-error";
import type { DocentSentence } from "../../../convex/lib/validators";

function preparationError(error: unknown) {
  switch (convexErrorCode(error)) {
    case "narration_busy":
    case "spend_cap":
    case "rate_limited":
      return "Narration is busy. Try again shortly.";
    case "narration_not_configured":
    case "narration_provider_failed":
    case "model_error":
    case "narration_unavailable":
      return "Narration is unavailable right now. Try again shortly.";
    default:
      return "Narration couldn’t be prepared. Check your connection and tap Retry.";
  }
}

export type Playback = {
  currentTime: number;
  duration: number;
  playing: boolean;
  isLoaded: boolean;
  didJustFinish: boolean;
  playbackState?: string;
};
export type AudioHandle = {
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  remove(): void;
  setPlaybackRate(rate: number): void;
  volume: number;
  setActiveForLockScreen(
    active: boolean,
    metadata?: { title: string; artist: string; artworkUrl?: string },
  ): void;
  addListener(
    event: "playbackStatusUpdate",
    callback: (status: Playback) => void,
  ): { remove(): void };
};
export type ListeningState = {
  sentences?: DocentSentence[];
  current?: ListeningTrack;
  queue: ListeningTrack[];
  phase: "idle" | "loading" | "ready" | "error";
  playing: boolean;
  position: number;
  duration: number;
  error?: string;
  waiting: boolean;
  pauseBetween: boolean;
  rate: number;
  volume: number;
  revision: number;
};
type Progress = Record<string, { position: number; duration: number; text: string }>;
export type ListeningDependencies = {
  render(
    track: ListeningTrack,
  ): Promise<{ uri: string; sentences: DocentSentence[]; duration?: number }>;
  cancel(): void;
  create(uri: string): AudioHandle;
  configure(): Promise<void>;
};

export class ListeningController {
  private state: ListeningState = {
    queue: [],
    phase: "idle",
    playing: false,
    position: 0,
    duration: 0,
    waiting: false,
    pauseBetween: true,
    rate: 1,
    volume: 1,
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private player?: AudioHandle;
  private subscription?: { remove(): void };
  private generation = 0;
  private progress: Progress = {};
  private desiredPlaying = false;
  private loadTimeout?: ReturnType<typeof setTimeout>;
  constructor(private dependencies: ListeningDependencies) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<ListeningState>) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    this.listeners.forEach((listener) => listener());
  }
  private remember() {
    if (this.state.current)
      this.progress[trackKey(this.state.current)] = {
        position: this.state.position,
        duration: this.state.duration,
        text: researchKey(this.state.current),
      };
  }
  isPlaybackRequested = () =>
    this.state.phase === "loading" ? this.desiredPlaying : this.state.playing;
  progressFor(track: ListeningTrack) {
    const saved = this.progress[trackKey(track)];
    return saved?.text === researchKey(track) ? saved : undefined;
  }
  private release() {
    clearTimeout(this.loadTimeout);
    this.subscription?.remove();
    this.subscription = undefined;
    if (this.player) {
      this.player.setActiveForLockScreen(false);
      this.player.pause();
      this.player.remove();
      this.player = undefined;
    }
  }
  async play(track: ListeningTrack, autoplay = true, waiting = false) {
    if (!track.work.facts.length) return;
    this.remember();
    this.release();
    const generation = ++this.generation;
    this.dependencies.cancel();
    this.desiredPlaying = autoplay;
    const saved = this.progressFor(track);
    const position = saved && saved.position < saved.duration - 0.5 ? saved.position : 0;
    this.update({
      current: track,
      sentences: undefined,
      queue: this.state.queue.filter((item) => item.work.artworkId !== track.work.artworkId),
      phase: "loading",
      playing: false,
      position,
      duration: saved?.duration ?? 0,
      error: undefined,
      waiting,
    });
    try {
      await this.dependencies.configure();
      if (generation !== this.generation) return;
      const rendered = await this.dependencies.render(track);
      if (generation !== this.generation) return;
      const player = this.dependencies.create(rendered.uri);
      this.player = player;
      player.volume = this.state.volume;
      player.setPlaybackRate(this.state.rate);
      let starting = false,
        started = false,
        finished = false;
      this.loadTimeout = setTimeout(() => {
        if (generation === this.generation && !started)
          this.fail("Audio couldn’t load. Tap Retry.");
      }, 15000);
      this.update({
        duration: rendered.duration ?? saved?.duration ?? 0,
        sentences: rendered.sentences,
      });
      this.subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (generation !== this.generation) return;
        if (status.playbackState === "error") {
          this.fail("Audio couldn’t play. Tap Retry.");
          return;
        }
        if (!status.isLoaded) return;
        if (!starting) {
          starting = true;
          const duration = status.duration || rendered.duration || 0;
          this.update({ duration });
          void player
            .seekTo(Math.min(position, duration))
            .then(() => {
              if (generation !== this.generation) return;
              started = true;
              clearTimeout(this.loadTimeout);
              player.setActiveForLockScreen(true, {
                title: track.work.title,
                artist: track.work.artist,
                artworkUrl: track.work.imageUri,
              });
              this.update({ phase: "ready" });
              if (this.desiredPlaying) player.play();
            })
            .catch(() => {
              if (generation === this.generation) this.fail("Audio couldn’t start. Tap Retry.");
            });
        }
        if (!started) return;
        this.update({
          position: status.currentTime,
          duration: status.duration || this.state.duration,
          playing: status.playing,
        });
        this.remember();
        if (status.didJustFinish && !finished) {
          finished = true;
          const next = this.state.queue[0];
          if (next) void this.play(next, !this.state.pauseBetween, this.state.pauseBetween);
          else {
            this.desiredPlaying = false;
            this.update({ playing: false, position: this.state.duration });
          }
        }
      });
    } catch (error) {
      if (generation === this.generation) this.fail(preparationError(error));
    }
  }
  private fail(error: string) {
    this.generation++;
    this.release();
    this.update({ phase: "error", playing: false, error });
  }
  toggle = () => {
    if (!this.state.current) return;
    if (this.state.phase === "error") {
      void this.play(this.state.current);
      return;
    }
    if (this.state.phase === "loading") {
      this.desiredPlaying = !this.desiredPlaying;
      return;
    }
    if (this.state.playing) {
      this.desiredPlaying = false;
      this.player?.pause();
    } else if (this.state.position >= this.state.duration - 0.2) void this.play(this.state.current);
    else {
      this.desiredPlaying = true;
      this.update({ waiting: false });
      this.player?.play();
    }
  };
  seek = async (position: number) => {
    if (this.state.phase !== "ready" || !Number.isFinite(position)) return;
    const generation = this.generation;
    const next = Math.max(0, Math.min(this.state.duration, position));
    try {
      await this.player?.seekTo(next);
      if (generation === this.generation) {
        this.update({ position: next });
        this.remember();
      }
    } catch {
      if (generation === this.generation) this.fail("Couldn’t change position. Tap Retry.");
    }
  };
  restart = () => {
    if (this.state.current) {
      delete this.progress[trackKey(this.state.current)];
      this.update({ position: 0 });
      void this.play(this.state.current);
    }
  };
  enqueue = (track: ListeningTrack) => {
    if (this.state.current?.work.artworkId === track.work.artworkId) return;
    if (this.state.queue.some((item) => item.work.artworkId === track.work.artworkId)) return;
    this.update({ queue: [...this.state.queue, track] });
  };
  remove = (key: string) =>
    this.update({ queue: this.state.queue.filter((track) => trackKey(track) !== key) });
  move = (key: string, offset: number) => {
    const queue = [...this.state.queue],
      from = queue.findIndex((track) => trackKey(track) === key),
      to = from + offset;
    if (from < 0 || to < 0 || to >= queue.length) return;
    [queue[from], queue[to]] = [queue[to], queue[from]];
    this.update({ queue });
  };
  setPauseBetween = (pauseBetween: boolean) => this.update({ pauseBetween });
  setRate = (rate: number) => {
    this.player?.setPlaybackRate(rate);
    this.update({ rate });
  };
  setVolume = (volume: number) => {
    if (this.player) this.player.volume = volume;
    this.update({ volume });
  };
  stop = () => {
    this.remember();
    this.generation++;
    this.dependencies.cancel();
    this.release();
    this.update({
      current: undefined,
      sentences: undefined,
      queue: [],
      phase: "idle",
      playing: false,
      position: 0,
      duration: 0,
      error: undefined,
      waiting: false,
    });
  };
  dispose = () => {
    this.stop();
    this.listeners.clear();
  };
}
