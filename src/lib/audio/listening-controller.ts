import { getNetworkStateAsync } from "expo-network";

import { convexErrorCode } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

import type { DocentSentence } from "../../../convex/lib/validators";
import { researchKey, trackKey, type ListeningTrack } from "./narration";
import type { NarrationPreparationStage } from "./narration-preparation";

async function reportStalledPlayback() {
  try {
    const network = await getNetworkStateAsync();
    if (network.isConnected && network.isInternetReachable !== false) {
      reportError(new Error("Narration playback stalled"), "narration.playback");
    }
  } catch {
    // Diagnostics must not prevent playback recovery when connectivity cannot be checked.
  }
}

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
      return "Narration is unavailable right now.";
    default:
      return "Couldn’t prepare narration. Check your connection.";
  }
}

export type Playback = {
  currentTime: number;
  duration: number;
  playing: boolean;
  isLoaded: boolean;
  didJustFinish: boolean;
  playbackState?: string;
  timeControlStatus?: string;
};
export type AudioHandle = {
  readonly currentStatus: Playback;
  play(): void;
  pause(): void;
  seekTo(seconds: number, toleranceMillisBefore?: number, toleranceMillisAfter?: number): Promise<void>;
  remove(): void;
  setPlaybackRate(rate: number): void;
  setActiveForLockScreen(active: boolean, metadata?: { title: string; artist: string; artworkUrl?: string }): void;
  addListener(event: "playbackStatusUpdate", callback: (status: Playback) => void): { remove(): void };
};
export type ListeningState = {
  renderId?: string;
  sentences?: DocentSentence[];
  current?: ListeningTrack;
  queue: ListeningTrack[];
  // Works that stopped being current, oldest first.
  history: ListeningTrack[];
  phase: "idle" | "loading" | "ready" | "error";
  preparationStage?: NarrationPreparationStage;
  playing: boolean;
  position: number;
  duration: number;
  waiting: boolean;
  rate: number;
  revision: number;
};
type Progress = Record<string, { position: number; duration: number; text: string }>;
export type ListeningDependencies = {
  render(
    track: ListeningTrack,
    onStage?: (stage: NarrationPreparationStage) => void,
  ): Promise<{ uri: string; sentences: DocentSentence[]; renderId: string; duration?: number; live?: boolean }>;
  cancel(): void;
  create(uri: string): AudioHandle;
  configure(): Promise<void>;
};

export class ListeningController {
  private state: ListeningState = {
    queue: [],
    history: [],
    phase: "idle",
    playing: false,
    position: 0,
    duration: 0,
    waiting: false,
    rate: 1,
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private player?: AudioHandle;
  private subscription?: { remove(): void };
  private generation = 0;
  private progress: Progress = {};
  private desiredPlaying = false;
  private loadTimeout?: ReturnType<typeof setTimeout>;
  private progressWatch?: ReturnType<typeof setInterval>;
  // A live playlist has no length yet, and AVPlayer pauses it at any rate above 1× until it has one.
  private awaitingLength = false;
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
    if (this.state.current) {
      this.progress[trackKey(this.state.current)] = {
        position: this.state.position,
        duration: this.state.duration,
        text: researchKey(this.state.current),
      };
    }
  }
  private historyAfter(next?: ListeningTrack) {
    const { current, history } = this.state;
    const leaving = current && current.work.artworkId !== next?.work.artworkId ? current : undefined;
    const kept = history.filter(
      (item) => item.work.artworkId !== next?.work.artworkId && item.work.artworkId !== leaving?.work.artworkId,
    );
    return leaving ? [...kept, leaving] : kept;
  }
  isPlaybackRequested = () => (this.state.phase === "loading" ? this.desiredPlaying : this.state.playing);
  progressFor(track: ListeningTrack) {
    const saved = this.progress[trackKey(track)];
    return saved?.text === researchKey(track) ? saved : undefined;
  }
  private release() {
    clearTimeout(this.loadTimeout);
    clearInterval(this.progressWatch);
    this.awaitingLength = false;
    this.subscription?.remove();
    this.subscription = undefined;
    if (this.player) {
      this.player.setActiveForLockScreen(false);
      this.player.pause();
      this.player.remove();
      this.player = undefined;
    }
  }
  private watchProgress(player: AudioHandle) {
    let position = player.currentStatus.currentTime;
    let progressedAt = Date.now();
    this.progressWatch = setInterval(() => {
      // AVPlayer can stop sending events while an HLS playlist returns 404. Read native state
      // so a lock-screen pause or background playback with delayed JS events is not a failure.
      const status = player.currentStatus;
      if (status.timeControlStatus === "paused" || status.didJustFinish || status.currentTime !== position) {
        position = status.currentTime;
        progressedAt = Date.now();
      } else if (Date.now() - progressedAt >= 15_000) {
        this.update({ position: status.currentTime, duration: status.duration || this.state.duration });
        this.remember();
        this.fail("Audio stopped responding.");
        void reportStalledPlayback();
      }
    }, 1000);
  }
  async play(track: ListeningTrack, autoplay = true, waiting = false) {
    if (track.work.facts.length === 0) return;
    this.remember();
    this.release();
    const generation = ++this.generation;
    this.dependencies.cancel();
    this.desiredPlaying = autoplay;
    const saved = this.progressFor(track);
    const position = saved && (saved.duration === 0 || saved.position < saved.duration - 0.5) ? saved.position : 0;
    this.update({
      current: track,
      sentences: undefined,
      renderId: undefined,
      queue: this.state.queue.filter((item) => item.work.artworkId !== track.work.artworkId),
      history: this.historyAfter(track),
      phase: "loading",
      preparationStage: "preparing",
      playing: false,
      position,
      duration: saved?.duration ?? 0,
      waiting,
    });
    try {
      await this.dependencies.configure();
      if (generation !== this.generation) return;
      const rendered = await this.dependencies.render(track, (stage) => {
        if (generation === this.generation) this.update({ preparationStage: stage });
      });
      if (generation !== this.generation) return;
      const player = this.dependencies.create(rendered.uri);
      this.player = player;
      this.awaitingLength = rendered.live === true;
      player.setPlaybackRate(this.awaitingLength ? 1 : this.state.rate);
      const nowPlaying = {
        title: track.work.title,
        artist: track.work.artist,
        artworkUrl: track.work.imageUri,
      };
      let starting = false;
      let started = false;
      let finished = false;
      this.loadTimeout = setTimeout(() => {
        if (generation === this.generation && !started) {
          this.fail("Couldn’t load audio.");
        }
      }, 15000);
      this.update({
        preparationStage: "buffering",
        duration: rendered.duration ?? saved?.duration ?? 0,
        sentences: rendered.sentences,
        renderId: rendered.renderId,
      });
      this.subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (generation !== this.generation) return;
        if (status.playbackState === "error") {
          this.fail("Couldn’t play audio.");
          return;
        }
        if (!status.isLoaded) return;
        if (!starting) {
          starting = true;
          const duration = status.duration || rendered.duration || 0;
          this.update({ duration });
          void player
            .seekTo(duration > 0 ? Math.min(position, duration) : position, 0, 0)
            .then(() => {
              if (generation !== this.generation) return;
              started = true;
              clearTimeout(this.loadTimeout);
              player.setActiveForLockScreen(true, nowPlaying);
              this.update({ phase: "ready", preparationStage: undefined });
              if (rendered.live) this.watchProgress(player);
              if (this.desiredPlaying) player.play();
            })
            .catch(() => {
              if (generation === this.generation) {
                this.fail("Couldn’t start audio.");
              }
            });
        }
        if (!started) return;
        if (this.awaitingLength && status.duration > 0) {
          this.awaitingLength = false;
          player.setPlaybackRate(this.state.rate);
          // Expo retains the live-stream metadata flag until now-playing info is cleared.
          player.setActiveForLockScreen(false);
          player.setActiveForLockScreen(true, nowPlaying);
        }
        this.update({
          position: status.currentTime,
          duration: status.duration || this.state.duration,
          playing: status.playing,
        });
        this.remember();
        if (status.didJustFinish && !finished) {
          finished = true;
          clearInterval(this.progressWatch);
          const next = this.state.queue[0];
          if (next) {
            void this.play(next);
          } else {
            this.desiredPlaying = false;
            this.update({ playing: false, position: this.state.duration });
          }
        }
      });
    } catch (error) {
      if (generation === this.generation) this.fail(preparationError(error));
    }
  }
  private fail(message: string) {
    const generation = ++this.generation;
    this.release();
    this.update({ phase: "error", preparationStage: undefined, playing: false });
    showErrorToast(message, () => {
      if (generation === this.generation && this.state.current) void this.play(this.state.current);
    });
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
    } else if (this.state.duration > 0 && this.state.position >= this.state.duration - 0.2) {
      void this.play(this.state.current);
    } else {
      this.desiredPlaying = true;
      this.update({ waiting: false });
      this.player?.play();
    }
  };
  seek = async (position: number) => {
    if (this.state.phase !== "ready" || !this.state.duration || !Number.isFinite(position)) return;
    const { generation } = this;
    const next = Math.max(0, Math.min(this.state.duration, position));
    try {
      await this.player?.seekTo(next);
      if (generation === this.generation) {
        this.update({ position: next });
        this.remember();
      }
    } catch {
      if (generation === this.generation) {
        this.fail("Couldn’t change position.");
      }
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
    if (this.state.queue.some((item) => item.work.artworkId === track.work.artworkId)) {
      return;
    }
    this.update({ queue: [...this.state.queue, track] });
  };
  remove = (key: string) =>
    this.update({
      queue: this.state.queue.filter((track) => trackKey(track) !== key),
    });
  move = (from: number, to: number) => {
    if (from === to || !this.state.queue[from] || to < 0 || to >= this.state.queue.length) return;
    const queue = [...this.state.queue];
    queue.splice(to, 0, ...queue.splice(from, 1));
    this.update({ queue });
  };
  clearHistory = () => this.update({ history: [] });
  setRate = (rate: number) => {
    if (!this.awaitingLength) this.player?.setPlaybackRate(rate);
    this.update({ rate });
  };
  stop = () => {
    this.remember();
    this.generation++;
    this.dependencies.cancel();
    this.release();
    this.update({
      current: undefined,
      sentences: undefined,
      renderId: undefined,
      queue: [],
      history: this.historyAfter(),
      phase: "idle",
      preparationStage: undefined,
      playing: false,
      position: 0,
      duration: 0,
      waiting: false,
    });
  };
  dispose = () => {
    this.stop();
    this.listeners.clear();
  };
}
