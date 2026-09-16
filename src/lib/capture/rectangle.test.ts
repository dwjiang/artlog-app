import type { RectPoint } from '../../../modules/vision-rect/src';
import { quadArea, selectCaptureQuad, toQuad } from './rectangle';
import type { Quad } from './stages';

const box = (left: number, top: number, right: number, bottom: number): RectPoint[] => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];
const framed = box(0.15, 0.25, 0.85, 0.75);
const shifted = (corners: RectPoint[], dx: number, dy = 0): RectPoint[] => corners.map(({ x, y }) => ({ x: x + dx, y: y + dy }));

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
    // Georges de La Tour photographed edge to edge: the figure is lifted; nothing else means a boundary retake.
    expect(selectCaptureQuad(null, still([], [{ quad: [[0.2115, 0.0532], [0.516, 0.0884], [0.5665, 0.9858], [0.03, 0.9918]], quadFill: 1.187 }]))).toBeNull();
    expect(selectCaptureQuad(null, still([], [{ quad: petitPalaisPainting, quadFill: 0.962 }]))).toBeNull();
    expect(selectCaptureQuad(null, still([], [{ quad: petitPalaisPainting, quadFill: 1.03 }]))).toBeNull();
  });

  it.each([
    { title: 'The Bedroom', quad: [[0.478, 0.268], [0.919, 0.339], [0.935, 0.774], [0.598, 0.846]] as Quad, quadFill: 1.004 },
    { title: 'La Grande Jatte', quad: [[0.764, 0.115], [0.903, 0.165], [0.951, 0.849], [0.784, 0.883]] as Quad, quadFill: 0.981 },
  ])('requests a boundary retake for $title when a small interior subject lifts without a painting boundary', ({ quad, quadFill }) => {
    // iPhone 16 Pro detections on the original collection images: the bed and a figure, respectively.
    expect(selectCaptureQuad(null, still([], [{ quad, quadFill }]))).toBeNull();
  });

  it('accepts a small lifted painting when a rectangle corroborates its boundary', () => {
    const painting = toQuad(box(0.3, 0.3, 0.7, 0.6));
    expect(selectCaptureQuad(null, still([painting], [{ quad: painting, quadFill: 1.004 }]))).toEqual(painting);
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
    // Paul Klee photographed edge to edge: the mask misses a corner and its quad tilts across the image; a retake is required.
    const tilted: Quad = [[0, 0], [0.9428, 0.1038], [0.9963, 0.8607], [0.103, 1]];
    expect(selectCaptureQuad(null, still([], [{ quad: tilted, quadFill: 1.013 }]))).toBeNull();
  });

  it('refines the preview quad with the still rectangle closest to it when nothing was lifted', () => {
    const detection = still([toQuad(shifted(framed, 0.02)), toQuad(box(0.2, 0.05, 0.9, 0.2))]);
    expect(selectCaptureQuad(previewQuad, detection)).toEqual(toQuad(shifted(framed, 0.02)));
  });

  it('uses still evidence when no rectangle matches the preview', () => {
    expect(selectCaptureQuad(previewQuad, still([toQuad(shifted(framed, 0.1))]))).toEqual(toQuad(shifted(framed, 0.1)));
    expect(selectCaptureQuad(previewQuad, still())).toBeNull();
  });

  it.each([true, false])('trusts a preview quad only when a still rectangle corroborates it (still rectangle present: %s)', (hasStillRectangle) => {
    const moved = toQuad(box(0.24, 0.2, 0.84, 0.8));
    expect(selectCaptureQuad(moved, still(hasStillRectangle ? [moved] : []))).toEqual(hasStillRectangle ? moved : null);
  });

  it('takes the outer rectangle for library imports and never the nested one', () => {
    expect(selectCaptureQuad(null, still([orsaySky, orsayOuter]))).toEqual(orsayOuter);
    expect(selectCaptureQuad(null, still())).toBeNull();
  });
});
