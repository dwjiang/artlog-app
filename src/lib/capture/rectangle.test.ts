import type { RectObservation, RectPoint } from '../../../modules/vision-rect/src';
import { MISS_GRACE_MS, RectTracker, RectTrackerStore, STABLE_WINDOW_MS, quadArea, selectCaptureQuad, toQuad } from './rectangle';
import type { Quad } from './stages';

const frame = { width: 768, height: 1024 };
const box = (left: number, top: number, right: number, bottom: number): RectPoint[] => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];
const observe = (corners: RectPoint[], confidence = 1): RectObservation[] => [{ confidence, corners }];
const framed = box(0.15, 0.25, 0.85, 0.75);
const shifted = (corners: RectPoint[], dx: number): RectPoint[] => corners.map(({ x, y }) => ({ x: x + dx, y }));

function holdSteady(tracker: RectTracker, corners: RectPoint[], from: number, until: number) {
  let result = tracker.push(observe(corners), frame, from);
  for (let now = from + 100; now <= until; now += 100) result = tracker.push(observe(corners), frame, now);
  return result;
}

describe('RectTracker guidance', () => {
  it('searches while nothing is detected', () => {
    expect(new RectTracker().push([], frame, 0)).toEqual({ quad: null, stable: false, guidance: 'searching' });
  });

  it('asks to move closer when the quad covers less than a quarter of the frame', () => {
    const result = new RectTracker().push(observe(box(0.3, 0.3, 0.7, 0.6)), frame, 0);
    expect(result.guidance).toBe('move-closer');
    expect(result.quad).toEqual(toQuad(box(0.3, 0.3, 0.7, 0.6)));
  });

  it('asks to fit the whole painting when a corner touches the frame edge', () => {
    expect(new RectTracker().push(observe(box(0.01, 0.2, 0.8, 0.8)), frame, 0).guidance).toBe('fit-whole-painting');
  });

  it('asks to straighten when opposite edges differ by more than 1.3×', () => {
    const skewed: RectPoint[] = [{ x: 0.15, y: 0.25 }, { x: 0.85, y: 0.25 }, { x: 0.85, y: 0.75 }, { x: 0.15, y: 0.5 }];
    expect(quadArea(toQuad(skewed))).toBeGreaterThan(0.25);
    expect(new RectTracker().push(observe(skewed), frame, 0).guidance).toBe('straighten');
  });

  it('holds still until the window fills, then reports ready', () => {
    const tracker = new RectTracker();
    expect(holdSteady(tracker, framed, 0, STABLE_WINDOW_MS - 100)).toMatchObject({ stable: false, guidance: 'hold-still' });
    expect(holdSteady(tracker, framed, STABLE_WINDOW_MS, STABLE_WINDOW_MS)).toMatchObject({ stable: true, guidance: 'ready' });
  });

  it('tolerates sub-threshold jitter and drops back to hold-still on a jump', () => {
    const tracker = new RectTracker();
    holdSteady(tracker, framed, 0, STABLE_WINDOW_MS);
    expect(tracker.push(observe(shifted(framed, 0.01)), frame, 500).guidance).toBe('ready');
    expect(tracker.push(observe(shifted(framed, 0.05)), frame, 600)).toMatchObject({ stable: false, guidance: 'hold-still' });
  });

  it('keeps the last result through a short detection gap and resets after the grace period', () => {
    const tracker = new RectTracker();
    const ready = holdSteady(tracker, framed, 0, STABLE_WINDOW_MS);
    expect(tracker.push([], frame, STABLE_WINDOW_MS + MISS_GRACE_MS)).toBe(ready);
    expect(tracker.push([], frame, STABLE_WINDOW_MS + MISS_GRACE_MS + 1).guidance).toBe('searching');
    expect(holdSteady(tracker, framed, 1000, 1000).guidance).toBe('hold-still');
  });

  it('tracks the largest observation', () => {
    const observations = [...observe(box(0.4, 0.4, 0.6, 0.6), 1), ...observe(framed, 0.7)];
    expect(new RectTracker().push(observations, frame, 0).quad).toEqual(toQuad(framed));
  });
});

describe('selectCaptureQuad', () => {
  const previewQuad = toQuad(framed);

  it('refines the preview quad with the still candidate closest to it', () => {
    const still = { width: 3024, height: 4032, observations: [...observe(shifted(framed, 0.02)), ...observe(box(0.2, 0.05, 0.9, 0.2))] };
    expect(selectCaptureQuad(previewQuad, still)).toEqual(toQuad(shifted(framed, 0.02)));
  });

  it('keeps the preview quad when no still candidate is within tolerance', () => {
    const still = { width: 3024, height: 4032, observations: observe(shifted(framed, 0.1)) };
    expect(selectCaptureQuad(previewQuad, still)).toBe(previewQuad);
  });

  it('takes the outer candidate for library imports and never the nested one', () => {
    // Vision on the Orsay photograph from decision 006 (Jean-François Gornet, CC BY-SA 2.0, 1280×853):
    // the second candidate is the painting's sky, not the canvas.
    const outer: Quad = [[0.29, 0.1123], [0.8552, 0.0845], [0.8415, 0.6115], [0.2919, 0.3365]];
    const sky: Quad = [[0.3348, 0.174], [0.8075, 0.1571], [0.8056, 0.3771], [0.3334, 0.3803]];
    const observations = [sky, outer].map((quad) => ({ confidence: 1, corners: quad.map(([x, y]) => ({ x, y })) }));
    expect(selectCaptureQuad(null, { width: 1280, height: 853, observations })).toEqual(outer);
    expect(selectCaptureQuad(null, { width: 1280, height: 853, observations: [] })).toBeNull();
  });
});

describe('RectTrackerStore', () => {
  it('notifies subscribers only when the guidance changes and on reset', () => {
    const store = new RectTrackerStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    const detection = (corners: RectPoint[]) => ({ ...frame, observations: observe(corners) });
    store.push(detection(framed), 0);
    expect(store.getGuidance()).toBe('hold-still');
    expect(store.quad).toEqual(toQuad(framed));
    store.push(detection(framed), 100);
    expect(listener).toHaveBeenCalledTimes(1);
    store.push(detection(box(0.3, 0.3, 0.7, 0.6)), 200);
    expect(store.getGuidance()).toBe('move-closer');
    expect(listener).toHaveBeenCalledTimes(2);
    store.reset();
    expect(store.getGuidance()).toBe('searching');
    expect(store.quad).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    store.push(detection(framed), 300);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
