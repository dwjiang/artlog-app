import type { RectObservation, RectPoint } from '../../../modules/vision-rect/src';
import { MISS_GRACE_MS, NESTED_AREA_RATIO, RectTracker, RectTrackerStore, SMOOTHING, STABLE_WINDOW_MS, quadArea, selectCaptureQuad, toQuad } from './rectangle';
import type { Quad } from './stages';

const frame = { width: 768, height: 1024 };
const box = (left: number, top: number, right: number, bottom: number): RectPoint[] => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];
const observe = (corners: RectPoint[], confidence = 1): RectObservation[] => [{ confidence, corners }];
const framed = box(0.15, 0.25, 0.85, 0.75);
const shifted = (corners: RectPoint[], dx: number, dy = 0): RectPoint[] => corners.map(({ x, y }) => ({ x: x + dx, y: y + dy }));

function holdSteady(tracker: RectTracker, corners: RectPoint[], from: number, until: number) {
  let result = tracker.push(observe(corners), frame, from);
  for (let now = from + 100; now <= until; now += 100) result = tracker.push(observe(corners), frame, now);
  return result;
}

describe('RectTracker guidance', () => {
  it('searches while nothing is detected', () => {
    expect(new RectTracker().push([], frame, 0)).toEqual({ quad: null, captureQuad: null, stable: false, guidance: 'searching', jitter: 0 });
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

  it('tolerates hand-held jitter and drops back to hold-still on a jump', () => {
    const tracker = new RectTracker();
    holdSteady(tracker, framed, 0, STABLE_WINDOW_MS);
    expect(tracker.push(observe(shifted(framed, 0.03)), frame, 500).guidance).toBe('ready');
    expect(tracker.push(observe(shifted(framed, -0.03)), frame, 600).guidance).toBe('ready');
    expect(tracker.push(observe(shifted(framed, 0.12, 0.12)), frame, 700)).toMatchObject({ stable: false, guidance: 'hold-still' });
  });

  it('smooths the tracked corners toward each new detection', () => {
    const tracker = new RectTracker();
    tracker.push(observe(framed), frame, 0);
    const moved = tracker.push(observe(shifted(framed, 0.1)), frame, 100);
    expect(moved.quad?.[0][0]).toBeCloseTo(0.15 + 0.1 * SMOOTHING);
    expect(moved.jitter).toBeCloseTo((0.1 * SMOOTHING * frame.width) / Math.hypot(frame.width, frame.height));
  });

  it('keeps following the tracked box when a nested candidate appears or the only candidate is far away', () => {
    const tracker = new RectTracker();
    const ready = holdSteady(tracker, framed, 0, STABLE_WINDOW_MS);
    const canvas = box(0.2, 0.3, 0.8, 0.7);
    expect(tracker.push([...observe(canvas, 1), ...observe(framed, 0.6)], frame, 500)).toMatchObject({ stable: true, guidance: 'ready' });
    expect(tracker.push(observe(framed), frame, 600).quad).toEqual(toQuad(framed));
    expect(tracker.push(observe(box(0.05, 0.05, 0.4, 0.3)), frame, 700)).toBe(tracker.push([], frame, 700));
    expect(tracker.push(observe(box(0.05, 0.05, 0.4, 0.3)), frame, 600 + MISS_GRACE_MS + 1).guidance).toBe('searching');
    expect(ready.guidance).toBe('ready');
  });

  it('ignores a nested inner candidate while the outer was seen recently, then accepts it after the grace period', () => {
    const tracker = new RectTracker();
    const ready = holdSteady(tracker, framed, 0, STABLE_WINDOW_MS);
    const canvas = box(0.2, 0.28, 0.8, 0.72);
    expect(quadArea(toQuad(canvas))).toBeLessThan(NESTED_AREA_RATIO * quadArea(toQuad(framed)));
    expect(tracker.push(observe(canvas), frame, STABLE_WINDOW_MS + 100)).toBe(ready);
    const accepted = tracker.push(observe(canvas), frame, STABLE_WINDOW_MS + MISS_GRACE_MS + 1);
    expect(accepted.quad).toEqual(toQuad(canvas));
    expect(accepted.guidance).toBe('hold-still');
  });

  it('upgrades to a larger candidate that encloses the tracked box and restarts the window', () => {
    const tracker = new RectTracker();
    const canvas = box(0.35, 0.4, 0.65, 0.6);
    expect(holdSteady(tracker, canvas, 0, STABLE_WINDOW_MS).guidance).toBe('move-closer');
    const upgraded = tracker.push([...observe(canvas), ...observe(framed)], frame, 500);
    expect(upgraded.quad).toEqual(toQuad(framed));
    expect(upgraded).toMatchObject({ stable: false, guidance: 'hold-still' });
    expect(holdSteady(tracker, framed, 600, 500 + STABLE_WINDOW_MS).guidance).toBe('ready');
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
  type Subject = { quad: Quad; quadFill: number; area?: number };
  const still = (rectangles: Quad[] = [], subjects: Subject[] = []) => ({
    width: 1280,
    height: 853,
    rectangles: rectangles.map((quad) => ({ confidence: 1, corners: quad.map(([x, y]) => ({ x, y })) })),
    subjects: subjects.map((subject) => ({ area: subject.area ?? quadArea(subject.quad), quadFill: subject.quadFill, quad: subject.quad.map(([x, y]) => ({ x, y })) })),
  });
  // Numbers below come from the Mac harness (`mac-harness.swift analyze`) on Wikimedia Commons gallery photographs.
  const petitPalaisPainting: Quad = [[0.1795, 0.2414], [0.7914, 0.2171], [0.7862, 0.8535], [0.1953, 0.7576]];
  const petitPalaisRectangle: Quad = [[0.173, 0.2418], [0.7883, 0.2167], [0.7921, 0.8371], [0.1717, 0.8069]];
  const orsayOuter: Quad = [[0.29, 0.1123], [0.8552, 0.0845], [0.8415, 0.6115], [0.2919, 0.3365]];
  const orsaySky: Quad = [[0.3348, 0.174], [0.8075, 0.1571], [0.8056, 0.3771], [0.3334, 0.3803]];
  const orsayVisitors: Quad = [[0.1431, 0.3468], [0.2729, 0.3365], [0.3101, 0.9263], [0.1663, 0.8814]];

  it('crops to the lifted subject shaped like a quadrilateral, frame included, over the rectangles', () => {
    const detection = still([petitPalaisRectangle], [{ quad: petitPalaisPainting, quadFill: 1.001 }, { quad: orsayVisitors, quadFill: 1.101 }]);
    expect(selectCaptureQuad(null, detection)).toEqual(petitPalaisPainting);
    expect(selectCaptureQuad(previewQuad, detection)).toEqual(petitPalaisPainting);
  });

  it('ignores lifted subjects that are not quadrilaterals: visitors, figures inside a canvas, visitors merged with a painting', () => {
    // Orsay (Jean-François Gornet, CC BY-SA 2.0): the visitors are lifted, not the painting; the sky rectangle is inside the painting.
    expect(selectCaptureQuad(null, still([orsaySky, orsayOuter], [{ quad: orsayVisitors, quadFill: 1.164 }]))).toEqual(orsayOuter);
    // Georges de La Tour photographed edge to edge: the figure is lifted; nothing else means the whole image.
    expect(selectCaptureQuad(null, still([], [{ quad: [[0.2115, 0.0532], [0.516, 0.0884], [0.5665, 0.9858], [0.03, 0.9918]], quadFill: 1.187 }]))).toBeNull();
    expect(selectCaptureQuad(null, still([], [{ quad: petitPalaisPainting, quadFill: 0.962 }]))).toBeNull();
    expect(selectCaptureQuad(null, still([], [{ quad: petitPalaisPainting, quadFill: 1.03 }]))).toBeNull();
  });

  it('prefers the subject under the preview quad and drops subjects cut off by the image edge', () => {
    // Alte Pinakothek Room XIII (Mattes, CC BY-SA 3.0), cropped around the left wall: two framed paintings lifted.
    const left: Quad = [[0.2076, 0.1839], [0.5967, 0.2334], [0.5801, 0.8001], [0.1835, 0.8538]];
    const middle: Quad = [[0.6995, 0.2952], [0.9439, 0.3167], [0.9295, 0.7217], [0.6834, 0.7508]];
    const both = still([], [{ quad: middle, quadFill: 1.012 }, { quad: left, quadFill: 1.004 }]);
    expect(selectCaptureQuad(null, both)).toEqual(left);
    expect(selectCaptureQuad([[0.65, 0.25], [0.98, 0.25], [0.98, 0.8], [0.65, 0.8]], both)).toEqual(middle);
    // National Museum in Kielce (SOULinPIX, CC BY 4.0), cropped: the larger lifted quadrilateral is a door at the right edge.
    const door: Quad = [[0.7082, 0.1692], [0.998, 0.2411], [0.998, 0.9985], [0.7087, 0.9985]];
    const painting: Quad = [[0.2348, 0.2239], [0.6638, 0.2903], [0.6518, 0.7293], [0.2262, 0.8094]];
    expect(selectCaptureQuad(null, still([painting], [{ quad: door, quadFill: 1.016 }, { quad: painting, quadFill: 1.016 }]))).toEqual(painting);
    // Paul Klee photographed edge to edge: the mask misses a corner and its quad tilts across the image; the whole photo is the crop.
    const tilted: Quad = [[0, 0], [0.9428, 0.1038], [0.9963, 0.8607], [0.103, 1]];
    expect(selectCaptureQuad(null, still([], [{ quad: tilted, quadFill: 1.013 }]))).toBeNull();
  });

  it('refines the preview quad with the still rectangle closest to it when nothing was lifted', () => {
    const detection = still([toQuad(shifted(framed, 0.02)), toQuad(box(0.2, 0.05, 0.9, 0.2))]);
    expect(selectCaptureQuad(previewQuad, detection)).toEqual(toQuad(shifted(framed, 0.02)));
  });

  it('keeps the preview quad when no still rectangle is within tolerance', () => {
    expect(selectCaptureQuad(previewQuad, still([toQuad(shifted(framed, 0.1))]))).toBe(previewQuad);
  });

  it.each([true, false])('uses the latest detected corners for a moving capture (still rectangle present: %s)', (hasStillRectangle) => {
    const store = new RectTrackerStore();
    const initial = box(0.1, 0.2, 0.7, 0.8);
    for (let now = 0; now <= STABLE_WINDOW_MS; now += 100) {
      store.push({ ...frame, observations: observe(initial) }, now);
    }
    const moved = box(0.24, 0.2, 0.84, 0.8);
    const preview = store.push({ ...frame, observations: observe(moved) }, STABLE_WINDOW_MS + 100);
    expect(preview.quad).not.toEqual(toQuad(moved));
    const detection = still(hasStillRectangle ? [toQuad(moved)] : []);
    expect(selectCaptureQuad(store.captureQuad, detection)).toEqual(toQuad(moved));
  });

  it('takes the outer rectangle for library imports and never the nested one', () => {
    expect(selectCaptureQuad(null, still([orsaySky, orsayOuter]))).toEqual(orsayOuter);
    expect(selectCaptureQuad(null, still())).toBeNull();
  });
});

describe('RectTrackerStore', () => {
  it('keeps accepted capture corners through ignored inner detections and clears them after a detection gap', () => {
    const store = new RectTrackerStore();
    store.push({ ...frame, observations: observe(box(0.1, 0.2, 0.7, 0.8)) }, 0);
    const moved = box(0.24, 0.2, 0.84, 0.8);
    store.push({ ...frame, observations: observe(moved) }, 100);
    store.push({ ...frame, observations: observe(box(0.3, 0.3, 0.75, 0.7)) }, 200);
    expect(store.captureQuad).toEqual(toQuad(moved));
    store.push({ ...frame, observations: [] }, 100 + MISS_GRACE_MS);
    expect(store.captureQuad).toEqual(toQuad(moved));
    store.push({ ...frame, observations: [] }, 100 + MISS_GRACE_MS + 1);
    expect(store.captureQuad).toBeNull();
  });

  it('notifies subscribers only when the guidance changes and on reset', () => {
    const store = new RectTrackerStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    const detection = (corners: RectPoint[]) => ({ ...frame, observations: observe(corners) });
    store.push(detection(framed), 0);
    expect(store.getGuidance()).toBe('hold-still');
    expect(store.captureQuad).toEqual(toQuad(framed));
    store.push(detection(framed), 100);
    expect(listener).toHaveBeenCalledTimes(1);
    store.push(detection(box(0.3, 0.3, 0.7, 0.6)), 100 + MISS_GRACE_MS + 1);
    expect(store.getGuidance()).toBe('move-closer');
    expect(listener).toHaveBeenCalledTimes(2);
    store.reset();
    expect(store.getGuidance()).toBe('searching');
    expect(store.captureQuad).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    store.push(detection(framed), 800);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
