import type { CaptureInput } from './stages';

export type CapturePhase = 'searching' | 'capturing' | 'processing' | 'revealing' | 'retry' | 'result';
export type CaptureAttempt = { id: number; source: CaptureInput['source']; valid: boolean };
export type CaptureState = { phase: CapturePhase; occupied: boolean; source?: CaptureInput['source']; message?: string };

export class CaptureController {
  private active = true;
  private attempt?: CaptureAttempt;
  private nextId = 0;
  private state: CaptureState = { phase: 'searching', occupied: false };
  private listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getSnapshot = () => this.state;

  private update(update: Partial<CaptureState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }

  setActive(active: boolean) {
    this.active = active;
  }

  reset() {
    if (this.attempt) this.attempt.valid = false;
    this.update({ phase: 'searching', source: undefined, message: undefined });
  }

  begin(source: CaptureInput['source']): CaptureAttempt | undefined {
    if (!this.active || this.state.occupied || !['searching', 'retry'].includes(this.state.phase)) return;
    if (this.attempt) this.attempt.valid = false;
    const attempt = { id: ++this.nextId, source, valid: true };
    this.attempt = attempt;
    this.update({ phase: 'capturing', occupied: true, source, message: undefined });
    return attempt;
  }

  processing(attempt: CaptureAttempt) {
    if (attempt.valid) this.update({ phase: 'processing' });
  }

  revealing(attempt: CaptureAttempt) {
    if (attempt.valid) this.update({ phase: 'revealing' });
  }

  fail(attempt: CaptureAttempt, message: string) {
    if (!attempt.valid) return;
    this.update({ phase: 'retry', message });
  }

  result(attempt: CaptureAttempt): boolean {
    if (!this.active || !attempt.valid || this.state.phase === 'result') return false;
    this.update({ phase: 'result' });
    return true;
  }

  finish(attempt: CaptureAttempt) {
    if (this.attempt !== attempt) return;
    this.update({ occupied: false });
  }
}
