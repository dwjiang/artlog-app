import type { RectDetection } from "../../../modules/vision-rect/src";
import type { DeviceMotion } from "./device-motion";
import {
  containsPoint,
  framingGuidance,
  isUsableQuad,
  largestObservation,
  maxCornerDistance,
  MISS_GRACE_MS,
  previewQuad,
  RectTracker,
  showsWhole,
  toQuad,
  type FrameSize,
  type Guidance,
} from "./rectangle";
import type { CaptureInput, Quad } from "./stages";

/** Fraction of the frame diagonal the artwork must move after a failure before it is scanned again. */
export const RETRY_MOVEMENT = 0.1;
/** Continuous absence of any rectangle after a failure that also rearms automatic scanning. */
export const RETRY_ABSENCE_MS = 700;
/**
 * How long the phone must be held upright and still, with nothing captured, before the whole view is captured: the
 * artwork may have no outline Vision finds, such as an unframed canvas or one behind glare.
 */
export const STEADY_CAPTURE_MS = 1500;
/** Rotation in radians per second above which the phone is moving rather than aimed. */
export const MOVING_ROTATION_RATE = 0.3;
export type CapturePhase = "searching" | "capturing" | "processing" | "revealing" | "retry" | "result";
export type CaptureAttempt = {
  id: number;
  source: CaptureInput["source"];
  quad: Quad | null;
  valid: boolean;
  /** Started by holding the phone still; nobody asked for it, so it fails silently. */
  steady: boolean;
};
/** What resumes automatic scanning after a camera failure: moving the failed corners, or the shutter (a shutter attempt has none). */
export type Rearm = "reframe" | "shutter";
export type CaptureState = {
  phase: CapturePhase;
  occupied: boolean;
  source?: CaptureInput["source"];
  message?: string;
  rearm?: Rearm;
};
export type CaptureFeedback = { quad: Quad; progress: number; guidance: Guidance } | null;

export class CaptureController {
  private tracker = new RectTracker();
  private active = true;
  private attempt?: CaptureAttempt;
  private nextId = 0;
  private lastDetectionAt = -Infinity;
  private lastCandidateAt = -Infinity;
  private lastFramedAt = -Infinity;
  private failedQuad: Quad | null = null;
  private absentSince?: number;
  private stillSince?: number;
  /** Within a scan session, steady capture waits for movement after an attempt. */
  private steadyArmed = true;
  private state: CaptureState = { phase: "searching", occupied: false };
  private listeners = new Set<() => void>();
  private feedback: CaptureFeedback = null;
  private feedbackListeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = () => this.state;
  readonly getFeedback = () => this.feedback;
  readonly subscribeFeedback = (listener: () => void) => {
    this.feedbackListeners.add(listener);
    return () => {
      this.feedbackListeners.delete(listener);
    };
  };

  private showFeedback(feedback: CaptureFeedback) {
    if (this.feedback === feedback) return;
    this.feedback = feedback;
    this.feedbackListeners.forEach((listener) => listener());
  }

  readonly resetDetection = () => {
    this.tracker.reset();
    this.lastDetectionAt = -Infinity;
    this.lastCandidateAt = -Infinity;
    this.lastFramedAt = -Infinity;
    this.stillSince = undefined;
    this.showFeedback(null);
  };

  private update(update: Partial<CaptureState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.resetDetection();
    this.absentSince = undefined;
  }

  reset() {
    if (this.attempt) this.attempt.valid = false;
    this.steadyArmed = true;
    this.failedQuad = null;
    this.absentSince = undefined;
    this.resetDetection();
    this.update({
      phase: "searching",
      source: undefined,
      message: undefined,
      rearm: undefined,
    });
  }

  begin(source: CaptureInput["source"], quad: Quad | null = null, steady = false): CaptureAttempt | undefined {
    if (!this.active || this.state.occupied || !["searching", "retry"].includes(this.state.phase)) {
      return;
    }
    if (this.attempt) this.attempt.valid = false;
    const attempt = { id: ++this.nextId, source, quad, valid: true, steady };
    this.attempt = attempt;
    this.steadyArmed = false;
    this.resetDetection();
    this.update({
      phase: "capturing",
      occupied: true,
      source,
      message: undefined,
      rearm: undefined,
    });
    return attempt;
  }

  processing(attempt: CaptureAttempt) {
    if (attempt.valid) this.update({ phase: "processing" });
  }

  revealing(attempt: CaptureAttempt) {
    if (attempt.valid) this.update({ phase: "revealing" });
  }

  fail(attempt: CaptureAttempt, message: string) {
    if (!attempt.valid) return;
    if (attempt.steady) {
      this.resetDetection();
      this.update({ phase: "searching", message: undefined, rearm: undefined });
      return;
    }
    this.failedQuad = attempt.quad;
    this.absentSince = undefined;
    this.resetDetection();
    this.update({
      phase: "retry",
      message,
      rearm: attempt.source === "camera" ? (attempt.quad ? "reframe" : "shutter") : undefined,
    });
  }

  result(attempt: CaptureAttempt): boolean {
    if (!this.active || !attempt.valid || this.state.phase === "result") {
      return false;
    }
    this.update({ phase: "result" });
    return true;
  }

  finish(attempt: CaptureAttempt) {
    if (this.attempt !== attempt) return;
    this.update({ occupied: false });
  }

  /**
   * Feeds a live detection and starts a camera capture once a well-framed rectangle has held steady, or once the phone
   * has been held upright and still for `STEADY_CAPTURE_MS` without one. After a failure the same framing is not
   * scanned again: the artwork has to move by `RETRY_MOVEMENT` (a shutter failure has no corners, so it has to leave
   * the frame) or be absent for `RETRY_ABSENCE_MS`, then hold steady for a fresh window. `motion` is undefined without
   * motion sensors, which turns steady capture off.
   */
  observe(
    detection: RectDetection,
    preview: FrameSize,
    now: number,
    motion?: DeviceMotion,
  ): CaptureAttempt | undefined {
    if (
      !this.active
      || this.state.occupied
      || !["searching", "retry"].includes(this.state.phase)
      || this.state.source === "library"
      || preview.width <= 0
      || preview.height <= 0
      || detection.width <= 0
      || detection.height <= 0
    ) {
      return;
    }
    if (now - this.lastDetectionAt > MISS_GRACE_MS) {
      this.tracker.reset();
      this.stillSince = undefined;
    }
    this.lastDetectionAt = now;
    const moving = motion !== undefined && motion.rotationRate > MOVING_ROTATION_RATE;
    if (moving) this.steadyArmed = true;
    if (!motion?.upright || moving) this.stillSince = undefined;
    else this.stillSince ??= now;
    const observations = detection.observations.filter(
      (o) => o.corners.length === 4 && isUsableQuad(toQuad(o.corners)),
    );
    if (this.state.phase === "retry") {
      const diagonal = Math.hypot(detection.width, detection.height);
      if (observations.length === 0) {
        this.absentSince ??= now;
        if (now - this.absentSince < RETRY_ABSENCE_MS) return;
      } else {
        this.absentSince = undefined;
        if (
          !this.failedQuad
          || observations.some(
            (o) => maxCornerDistance(toQuad(o.corners), this.failedQuad!, detection) < RETRY_MOVEMENT * diagonal,
          )
        ) {
          return;
        }
      }
      this.failedQuad = null;
      this.tracker.reset();
      this.update({ phase: "searching", message: undefined, rearm: undefined });
    }
    const attempt = this.track(observations, detection, preview, now);
    if (attempt) return attempt;
    if (this.steadyArmed && this.stillSince !== undefined && now - this.stillSince >= STEADY_CAPTURE_MS) {
      return this.begin("camera", null, true);
    }
  }

  private track(
    observations: RectDetection["observations"],
    detection: RectDetection,
    preview: FrameSize,
    now: number,
  ): CaptureAttempt | undefined {
    const centered = observations.filter((o) => containsPoint(toQuad(o.corners), [0.5, 0.5]));
    const candidates = centered.filter((o) => framingGuidance(toQuad(o.corners), detection, preview) === null);
    if (candidates.length === 0) {
      // Vision drops or misplaces a rectangle on single frames. A miss within the grace period keeps the
      // hold or the framing hint; a longer one restarts the hold, so sustained invalid framing never counts
      // toward a stable window.
      if (now - this.lastCandidateAt <= MISS_GRACE_MS) return;
      this.tracker.reset();
      // A painting inside a mat, screen or wall panel that runs off screen gets its own hint: fitting that whole
      // boundary in view would only shrink the painting.
      const framed =
        largestObservation(centered.filter((o) => showsWhole(toQuad(o.corners), detection, preview)))
        ?? largestObservation(centered);
      if (framed) {
        this.lastFramedAt = now;
        this.showFeedback({
          quad: previewQuad(toQuad(framed.corners), detection, preview),
          progress: 0,
          guidance: framingGuidance(toQuad(framed.corners), detection, preview) ?? "hold-still",
        });
      } else if (now - this.lastFramedAt > MISS_GRACE_MS) {
        this.showFeedback(null);
      }
      return;
    }
    this.lastCandidateAt = now;
    const tracked = this.tracker.push(candidates, detection, now);
    this.showFeedback(
      tracked.quad
        ? {
            quad: previewQuad(tracked.quad, detection, preview),
            progress: tracked.progress,
            guidance: tracked.guidance,
          }
        : null,
    );
    if (!tracked.captureQuad || tracked.guidance !== "ready") return;
    const quad = tracked.captureQuad;
    if (!candidates.some((o) => maxCornerDistance(toQuad(o.corners), quad, detection) < 0.001)) {
      return;
    }
    return this.begin("camera", quad);
  }
}
