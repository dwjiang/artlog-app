import { getNetworkStateAsync } from "expo-network";

import { OfflineError, convexErrorCode, isBackendError, isNetworkError } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

import type { FactChip, GuideSentence } from "../../../convex/lib/validators";
import { researchKey, trackKey, type ListeningTrack } from "./narration";
import type { NarrationPreparationStage } from "./narration-preparation";

async function reportRemotePlaybackFailure(message: string) {
  try {
    const network = await getNetworkStateAsync();
    if (network.isConnected && network.isInternetReachable !== false) {
      reportError(new Error(message), "narration.playback");
    }
  } catch {
    // Diagnostics must not prevent playback recovery when connectivity cannot be checked.
  }
}

function preparationError(error: unknown) {
  if (error instanceof OfflineError) return "Couldn’t prepare narration while offline.";
  if (isNetworkError(error)) return "Couldn’t prepare narration. Check your connection.";
  switch (convexErrorCode(error)) {
    case "narration_busy":
    case "rate_limited":
      return "Narration is busy. Try again shortly.";
    case "spend_cap":
      return "Narration is paused for today.";
    case "device_banned":
      return "Narration isn’t available on this phone.";
  }
  return isBackendError(error) ? "Narration is unavailable right now." : "Couldn’t prepare narration.";
}

// A guide that finishes preparing this long after the tap, such as one requested just before the connection
// dropped, waits for the listener instead of starting on its own.
const LATE_RENDER_MS = 2 * 60_000;

export type Playback = {
  currentTime: number;
  duration: number;
  playing: boolean;
  isLoaded: boolean;
  didJustFinish: boolean;
  playbackState?: string;
  timeControlStatus?: string;
  error?: string | null;
  playbackRate?: number;
};
export type AudioHandle = {
  readonly currentStatus: Playback;
  readonly seekableDuration: number;
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
  sentences?: GuideSentence[];
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
  availableDuration: number;
  rate: number;
  revision: number;
};

export function canSeekTo(state: Pick<ListeningState, "phase" | "duration" | "availableDuration">, position: number) {
  return (
    state.phase === "ready"
    && Number.isFinite(position)
    && position >= 0
    && position < (state.duration || state.availableDuration)
  );
}

type Progress = Record<string, { position: number; duration: number; text: string; script: string; renderId?: string }>;
export type ListeningDependencies = {
  render(
    track: ListeningTrack,
    onStage?: (stage: NarrationPreparationStage) => void,
  ): Promise<{
    uri: string;
    sentences: GuideSentence[];
    renderId: string;
    duration?: number;
    live?: boolean;
    /** The research the guide was written from, which a work played before it had any learns here. */
    facts?: FactChip[];
    researchUpdatedAt?: number;
  }>;
  cancel(): void;
  invalidate?(renderId: string): void;
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
    availableDuration: 0,
    waiting: false,
    rate: 1,
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private player?: AudioHandle;
  private subscription?: { remove(): void };
  private playbackStatus?: (status: Playback) => void;
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
    if (this.state.current && this.state.sentences) {
      this.progress[trackKey(this.state.current)] = {
        position: this.state.position,
        duration: this.state.duration,
        text: researchKey(this.state.current),
        script: JSON.stringify(this.state.sentences),
        renderId: this.state.current.work.renderId,
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
    if (saved?.text !== researchKey(track)) return undefined;
    if (track.work.renderId && saved.renderId !== track.work.renderId) {
      const completed = saved.duration > 0 && saved.position >= saved.duration - 0.5;
      return { ...saved, position: completed ? 0 : saved.position, duration: 0 };
    }
    return saved;
  }
  private release() {
    clearTimeout(this.loadTimeout);
    clearInterval(this.progressWatch);
    this.awaitingLength = false;
    this.subscription?.remove();
    this.subscription = undefined;
    this.playbackStatus = undefined;
    if (this.player) {
      this.player.setActiveForLockScreen(false);
      this.player.pause();
      this.player.remove();
      this.player = undefined;
    }
  }
  private refreshAvailability(player: AudioHandle) {
    if (!this.awaitingLength) return;
    let availableDuration = 0;
    try {
      const duration = player.seekableDuration;
      if (Number.isFinite(duration)) availableDuration = Math.max(0, duration);
    } catch (error) {
      reportError(error, "narration.seekableRange");
    }
    if (availableDuration !== this.state.availableDuration) this.update({ availableDuration });
  }
  private watchProgress(player: AudioHandle, onStatus: (status: Playback) => void, live: boolean) {
    let position = player.currentStatus.currentTime;
    let progressedAt = Date.now();
    this.progressWatch = setInterval(() => {
      // AVPlayer can stop sending events while an HLS playlist returns 404. Read native state
      // so a lock-screen pause or background playback with delayed JS events is not a failure.
      const status = player.currentStatus;
      onStatus(status);
      if (this.player !== player || !live) return;
      if (status.timeControlStatus === "paused" || status.didJustFinish || status.currentTime !== position) {
        position = status.currentTime;
        progressedAt = Date.now();
      } else if (Date.now() - progressedAt >= 15_000) {
        this.update({ position: status.currentTime, duration: status.duration || this.state.duration });
        this.remember();
        this.fail("Audio stopped responding.");
        void reportRemotePlaybackFailure("Narration playback stalled");
      }
    }, 1000);
  }
  async play(track: ListeningTrack, autoplay = true, waiting = false) {
    this.remember();
    this.release();
    const generation = ++this.generation;
    this.dependencies.cancel();
    this.desiredPlaying = autoplay;
    const saved = this.progressFor(track);
    let position = saved && (saved.duration === 0 || saved.position < saved.duration - 0.5) ? saved.position : 0;
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
      availableDuration: 0,
      waiting,
    });
    const requestedAt = Date.now();
    try {
      await this.dependencies.configure();
      if (generation !== this.generation) return;
      const rendered = await this.dependencies.render(track, (stage) => {
        if (generation === this.generation) this.update({ preparationStage: stage });
      });
      if (generation !== this.generation) return;
      if (Date.now() - requestedAt > LATE_RENDER_MS && this.desiredPlaying) {
        this.desiredPlaying = false;
        this.update({ waiting: true });
      }
      const local = rendered.uri.startsWith("file:");
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
          if (local) reportError(new Error("Narration load timed out"), "narration.playback");
          else void reportRemotePlaybackFailure("Narration load timed out");
          this.fail("Couldn’t load audio.");
        }
      }, 15000);
      const { facts = track.work.facts, researchUpdatedAt = track.work.researchUpdatedAt } = rendered;
      // A script opens with its uncited label line, written from the work's record when it was scripted; a track
      // queued before that record changed carries the old line.
      const [first] = rendered.sentences;
      const opening = first?.section === "hook" && first.factIds.length === 0 ? first.sentence : track.work.opening;
      const current = {
        ...track,
        work: { ...track.work, facts, researchUpdatedAt, opening, renderId: rendered.renderId },
      };
      const resume =
        saved?.text === researchKey(current) && saved.script === JSON.stringify(rendered.sentences) ? saved : undefined;
      position = resume && (resume.duration === 0 || resume.position < resume.duration - 0.5) ? resume.position : 0;
      this.update({
        current,
        preparationStage: "buffering",
        position,
        duration: rendered.duration ?? (resume?.renderId === rendered.renderId ? resume?.duration : undefined) ?? 0,
        sentences: rendered.sentences,
        renderId: rendered.renderId,
      });
      const onStatus = (status: Playback) => {
        if (generation !== this.generation) return;
        if (status.playbackState === "failed" || status.playbackState === "error" || status.error) {
          if (local) {
            try {
              this.dependencies.invalidate?.(rendered.renderId);
            } catch (error) {
              reportError(error, "narration.cache");
            }
          }
          if (local) reportError(new Error("Narration player failed"), "narration.playback");
          else void reportRemotePlaybackFailure("Narration player failed");
          this.fail("Couldn’t play audio.");
          return;
        }
        if (!status.isLoaded) return;
        this.refreshAvailability(player);
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
              this.watchProgress(player, onStatus, rendered.live === true);
              if (this.desiredPlaying) player.play();
              onStatus(player.currentStatus);
            })
            .catch((error) => {
              if (generation === this.generation) {
                reportError(error, "narration.start");
                this.fail("Couldn’t start audio.");
              }
            });
        }
        if (!started) return;
        const lengthBecameKnown = this.awaitingLength && status.duration > 0;
        if (lengthBecameKnown) {
          this.awaitingLength = false;
          player.setPlaybackRate(this.state.rate);
          // Expo retains the live-stream metadata flag until now-playing info is cleared.
          player.setActiveForLockScreen(false);
          player.setActiveForLockScreen(true, nowPlaying);
        }
        const expectedRate = this.awaitingLength ? 1 : this.state.rate;
        if (
          !lengthBecameKnown
          && status.playing
          && status.playbackRate !== undefined
          && Number.isFinite(status.playbackRate)
          && status.playbackRate > 0
          && status.playbackRate !== expectedRate
        ) {
          // Expo resumes interruptions with AVPlayer.play(), which resets the native rate to 1×.
          player.setPlaybackRate(expectedRate);
        }
        const duration = status.duration || this.state.duration;
        if (
          status.currentTime !== this.state.position
          || duration !== this.state.duration
          || status.playing !== this.state.playing
        ) {
          this.update({ position: status.currentTime, duration, playing: status.playing });
        }
        this.remember();
        if (finished && !status.didJustFinish && status.currentTime < duration - 0.2) {
          finished = false;
          this.watchProgress(player, onStatus, rendered.live === true);
        }
        if (status.didJustFinish && !finished) {
          finished = true;
          clearInterval(this.progressWatch);
          // A live playlist can end before AVPlayer reports its length, and a finished player cannot play
          // again; where it ended is the length, so the guide counts as finished and Play renders it anew.
          if (!(this.state.duration > 0)) {
            this.update({ duration: Math.max(status.currentTime, this.state.position) });
            this.remember();
          }
          const next = this.state.queue[0];
          if (next) {
            void this.play(next);
          } else {
            this.desiredPlaying = false;
            this.update({ playing: false, position: this.state.duration });
          }
        }
      };
      this.playbackStatus = onStatus;
      this.subscription = player.addListener("playbackStatusUpdate", onStatus);
      onStatus(player.currentStatus);
    } catch (error) {
      if (generation !== this.generation) return;
      // The backend reports its own failures; this covers the download, the transcript check and the player.
      if (!isBackendError(error) && !isNetworkError(error)) {
        reportError(error, "narration.prepare", { data: { artworkId: track.work.artworkId } });
      }
      this.fail(preparationError(error));
    }
  }
  private fail(message: string) {
    const generation = ++this.generation;
    this.release();
    this.update({ phase: "error", preparationStage: undefined, playing: false });
    // Narration fails long after a tap, during queue advances or playback stalls, so it never buzzes.
    showErrorToast(
      message,
      () => {
        if (generation === this.generation && this.state.current) void this.play(this.state.current);
      },
      { quiet: true },
    );
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
    const { player } = this;
    if (!player) return;
    const status = player.currentStatus;
    if (status.playing || status.timeControlStatus === "waitingToPlayAtSpecifiedRate") {
      this.desiredPlaying = false;
      player.pause();
    } else if (this.state.duration > 0 && this.state.position >= this.state.duration - 0.2) {
      void this.play(this.state.current);
    } else {
      this.desiredPlaying = true;
      this.update({ waiting: false });
      player.play();
    }
    if (this.player === player) this.playbackStatus?.(player.currentStatus);
  };
  seek = async (position: number, { play = false, clamp = true }: { play?: boolean; clamp?: boolean } = {}) => {
    const { player } = this;
    if (this.state.phase !== "ready" || !player || !Number.isFinite(position)) return;
    this.refreshAvailability(player);
    if (!clamp && !canSeekTo(this.state, position)) return;
    const limit = this.state.duration || this.state.availableDuration;
    if (!limit) return;
    const { generation } = this;
    const next = Math.max(0, Math.min(limit, position));
    if (play) this.desiredPlaying = true;
    try {
      // Unbounded iOS tolerances snap HLS seeks to segment boundaries, before the selected sentence.
      await player.seekTo(next, 0, 0);
      if (generation === this.generation) {
        this.playbackStatus?.(player.currentStatus);
        if (generation !== this.generation) return;
        if (play && this.desiredPlaying) {
          this.update({ waiting: false });
          if (!this.state.playing) player.play();
          this.playbackStatus?.(player.currentStatus);
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        reportError(error, "narration.seek");
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
      availableDuration: 0,
      waiting: false,
    });
  };
  dispose = () => {
    this.stop();
    this.listeners.clear();
  };
}
