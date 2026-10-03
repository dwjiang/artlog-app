import type { RectObservation, RectPoint } from "../../../modules/vision-rect/src";
import {
  MISS_GRACE_MS,
  NESTED_AREA_RATIO,
  RectTracker,
  nestedQuads,
  SMOOTHING,
  STABLE_WINDOW_MS,
  previewQuad,
  quadArea,
  selectCaptureQuad,
  toQuad,
  turnQuad,
} from "./rectangle";
import type { Quad } from "./stages";

const frame = { width: 768, height: 1024 };
const box = (left: number, top: number, right: number, bottom: number): RectPoint[] => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
];
const observe = (corners: RectPoint[], confidence = 1): RectObservation[] => [{ confidence, corners }];
const framed = box(0.15, 0.25, 0.85, 0.75);
const shifted = (corners: RectPoint[], dx: number, dy = 0): RectPoint[] =>
  corners.map(({ x, y }) => ({ x: x + dx, y: y + dy }));

function holdSteady(tracker: RectTracker, corners: RectPoint[], from: number, until: number) {
  let result = tracker.push(observe(corners), frame, from);
  for (let now = from + 100; now <= until; now += 100) {
    result = tracker.push(observe(corners), frame, now);
  }
  return result;
}

describe("RectTracker guidance", () => {
  it("searches while nothing is detected", () => {
    expect(new RectTracker().push([], frame, 0)).toEqual({
      quad: null,
      captureQuad: null,
      stable: false,
      guidance: "searching",
      jitter: 0,
      progress: 0,
    });
  });

  it("asks to move closer when the quad covers less than a tenth of the frame", () => {
    const result = new RectTracker().push(observe(box(0.3, 0.3, 0.6, 0.6)), frame, 0);
    expect(result.guidance).toBe("move-closer");
    expect(result.quad).toEqual(toQuad(box(0.3, 0.3, 0.6, 0.6)));
    expect(new RectTracker().push(observe(box(0.3, 0.3, 0.7, 0.6)), frame, 0).guidance).toBe("hold-still");
  });

  it("asks to fit the whole painting when a corner touches the frame edge", () => {
    expect(new RectTracker().push(observe(box(0.01, 0.2, 0.8, 0.8)), frame, 0).guidance).toBe("fit-whole-painting");
  });

  it("asks to straighten when opposite edges differ by more than 1.3×", () => {
    const skewed: RectPoint[] = [
      { x: 0.15, y: 0.25 },
      { x: 0.85, y: 0.25 },
      { x: 0.85, y: 0.75 },
      { x: 0.15, y: 0.5 },
    ];
    expect(quadArea(toQuad(skewed))).toBeGreaterThan(0.25);
    expect(new RectTracker().push(observe(skewed), frame, 0).guidance).toBe("straighten");
  });

  it("holds still until the window fills, then reports ready", () => {
    const tracker = new RectTracker();
    expect(holdSteady(tracker, framed, 0, STABLE_WINDOW_MS - 100)).toMatchObject({
      stable: false,
      guidance: "hold-still",
    });
    expect(holdSteady(tracker, framed, STABLE_WINDOW_MS, STABLE_WINDOW_MS)).toMatchObject({
      stable: true,
      guidance: "ready",
    });
  });

  it("reports hold progress from accepted frames and resets it when the painting moves", () => {
    const tracker = new RectTracker();
    expect(holdSteady(tracker, framed, 0, 400).progress).toBe(0.5);
    expect(holdSteady(tracker, framed, 500, 800).progress).toBe(1);
    const moved = tracker.push(observe(shifted(framed, 0.12, 0.12)), frame, 900);
    expect(moved.progress).toBe(0);
    expect(moved.stable).toBe(false);
    tracker.reset();
    expect(tracker.push(observe(framed), frame, 1000).progress).toBe(0);
  });

  it("tolerates hand-held jitter and drops back to hold-still on a jump", () => {
    const tracker = new RectTracker();
    holdSteady(tracker, framed, 0, STABLE_WINDOW_MS);
    expect(tracker.push(observe(shifted(framed, 0.03)), frame, STABLE_WINDOW_MS + 100).guidance).toBe("ready");
    expect(tracker.push(observe(shifted(framed, -0.03)), frame, STABLE_WINDOW_MS + 200).guidance).toBe("ready");
    expect(tracker.push(observe(shifted(framed, 0.12, 0.12)), frame, STABLE_WINDOW_MS + 300)).toMatchObject({
      stable: false,
      guidance: "hold-still",
    });
  });

  it("smooths the tracked corners toward each new detection", () => {
    const tracker = new RectTracker();
    tracker.push(observe(framed), frame, 0);
    const moved = tracker.push(observe(shifted(framed, 0.1)), frame, 100);
    expect(moved.quad?.[0][0]).toBeCloseTo(0.15 + 0.1 * SMOOTHING);
    expect(moved.jitter).toBeCloseTo((0.1 * SMOOTHING * frame.width) / Math.hypot(frame.width, frame.height));
  });

  it("keeps following the tracked box when a nested candidate appears or the only candidate is far away", () => {
    const tracker = new RectTracker();
    const ready = holdSteady(tracker, framed, 0, STABLE_WINDOW_MS);
    const canvas = box(0.2, 0.3, 0.8, 0.7);
    expect(tracker.push([...observe(canvas, 1), ...observe(framed, 0.6)], frame, STABLE_WINDOW_MS + 100)).toMatchObject(
      { stable: true, guidance: "ready" },
    );
    expect(tracker.push(observe(framed), frame, STABLE_WINDOW_MS + 200).quad).toEqual(toQuad(framed));
    expect(tracker.push(observe(box(0.05, 0.05, 0.4, 0.3)), frame, STABLE_WINDOW_MS + 300)).toBe(
      tracker.push([], frame, STABLE_WINDOW_MS + 300),
    );
    expect(
      tracker.push(observe(box(0.05, 0.05, 0.4, 0.3)), frame, STABLE_WINDOW_MS + 200 + MISS_GRACE_MS + 1).guidance,
    ).toBe("searching");
    expect(ready.guidance).toBe("ready");
  });

  it("ignores a nested inner candidate while the outer was seen recently, then accepts it after the grace period", () => {
    const tracker = new RectTracker();
    const ready = holdSteady(tracker, framed, 0, STABLE_WINDOW_MS);
    const canvas = box(0.2, 0.28, 0.8, 0.72);
    expect(quadArea(toQuad(canvas))).toBeLessThan(NESTED_AREA_RATIO * quadArea(toQuad(framed)));
    expect(tracker.push(observe(canvas), frame, STABLE_WINDOW_MS + 100)).toBe(ready);
    const accepted = tracker.push(observe(canvas), frame, STABLE_WINDOW_MS + MISS_GRACE_MS + 1);
    expect(accepted.quad).toEqual(toQuad(canvas));
    expect(accepted.guidance).toBe("hold-still");
  });

  it("upgrades to a larger candidate that encloses the tracked box and restarts the window", () => {
    const tracker = new RectTracker();
    const canvas = box(0.35, 0.4, 0.65, 0.6);
    expect(holdSteady(tracker, canvas, 0, STABLE_WINDOW_MS).guidance).toBe("move-closer");
    const upgraded = tracker.push([...observe(canvas), ...observe(framed)], frame, STABLE_WINDOW_MS + 100);
    expect(upgraded.quad).toEqual(toQuad(framed));
    expect(upgraded).toMatchObject({ stable: false, guidance: "hold-still" });
    expect(holdSteady(tracker, framed, STABLE_WINDOW_MS + 200, 2 * STABLE_WINDOW_MS + 100).guidance).toBe("ready");
  });

  it("keeps the last result through a short detection gap and resets after the grace period", () => {
    const tracker = new RectTracker();
    const ready = holdSteady(tracker, framed, 0, STABLE_WINDOW_MS);
    expect(tracker.push([], frame, STABLE_WINDOW_MS + MISS_GRACE_MS)).toBe(ready);
    expect(tracker.push([], frame, STABLE_WINDOW_MS + MISS_GRACE_MS + 1).guidance).toBe("searching");
    expect(
      holdSteady(tracker, framed, STABLE_WINDOW_MS + MISS_GRACE_MS + 100, STABLE_WINDOW_MS + MISS_GRACE_MS + 100)
        .guidance,
    ).toBe("hold-still");
  });

  it("tracks the largest observation", () => {
    const observations = [...observe(box(0.4, 0.4, 0.6, 0.6), 1), ...observe(framed, 0.7)];
    expect(new RectTracker().push(observations, frame, 0).quad).toEqual(toQuad(framed));
  });
});

describe("previewQuad", () => {
  it("maps a 4:3 frame onto a taller full-screen preview the way a cover-fit camera view does", () => {
    const preview = { width: 390, height: 844 };
    const [[left, top], , [right, bottom]] = previewQuad(toQuad(framed), frame, preview);
    // The preview shows the middle of the frame: its height covers, so the sides are cropped away.
    expect(top).toBeCloseTo(0.25);
    expect(bottom).toBeCloseTo(0.75);
    expect(left).toBeLessThan(0.15);
    expect(right).toBeGreaterThan(0.85);
  });
});

describe("turnQuad", () => {
  // A wide painting seen in the portrait preview while the phone is held sideways: it stands on its end.
  const onItsSide = toQuad(box(0.2, 0.1, 0.6, 0.7));
  const rounded = (quad: Quad) => quad.map((corner) => corner.map((v) => Math.round(v * 1000) / 1000));

  it.each([
    ["a quarter turn clockwise", 1, box(0.3, 0.2, 0.9, 0.6)],
    ["a half turn", 2, box(0.4, 0.3, 0.8, 0.9)],
    ["a quarter turn counterclockwise", -1, box(0.1, 0.4, 0.7, 0.8)],
  ])("moves the corners with the image over %s and puts the new top-left first", (_, turns, upright) => {
    expect(rounded(turnQuad(onItsSide, turns))).toEqual(rounded(toQuad(upright)));
  });

  it("returns to the original corners when turned back", () => {
    const tilted: Quad = [
      [0.3, 0.1],
      [0.8, 0.25],
      [0.7, 0.9],
      [0.15, 0.7],
    ];
    for (const turns of [0, 1, 2, 3]) {
      expect(rounded(turnQuad(turnQuad(tilted, turns), -turns))).toEqual(rounded(tilted));
    }
  });
});

type Subject = { quad: Quad; quadFill: number; area?: number };
const still = (rectangles: Quad[] = [], subjects: Subject[] = []) => ({
  width: 1280,
  height: 853,
  rectangles: rectangles.map((quad) => ({
    confidence: 1,
    corners: quad.map(([x, y]) => ({ x, y })),
  })),
  subjects: subjects.map((subject) => ({
    area: subject.area ?? quadArea(subject.quad),
    quadFill: subject.quadFill,
    quad: subject.quad.map(([x, y]) => ({ x, y })),
  })),
});

// Mac harness corners on an iPhone photo of La Grande Jatte displayed on a laptop.
const laptopScreen: Quad = [
  [0.0687, 0.3582],
  [0.8313, 0.359],
  [0.8145, 0.7285],
  [0.0786, 0.7048],
];
const jatteOnScreen: Quad = [
  [0.2285, 0.4087],
  [0.7677, 0.4097],
  [0.7552, 0.6805],
  [0.2328, 0.665],
];

describe("selectCaptureQuad", () => {
  const previewQuad = toQuad(framed);
  // Numbers below come from the Mac harness (`mac-harness.swift analyze`) on Wikimedia Commons gallery photographs.
  const petitPalaisPainting: Quad = [
    [0.1795, 0.2414],
    [0.7914, 0.2171],
    [0.7862, 0.8535],
    [0.1953, 0.7576],
  ];
  const petitPalaisRectangle: Quad = [
    [0.173, 0.2418],
    [0.7883, 0.2167],
    [0.7921, 0.8371],
    [0.1717, 0.8069],
  ];
  const orsayOuter: Quad = [
    [0.29, 0.1123],
    [0.8552, 0.0845],
    [0.8415, 0.6115],
    [0.2919, 0.3365],
  ];
  const orsaySky: Quad = [
    [0.3348, 0.174],
    [0.8075, 0.1571],
    [0.8056, 0.3771],
    [0.3334, 0.3803],
  ];
  const orsayVisitors: Quad = [
    [0.1431, 0.3468],
    [0.2729, 0.3365],
    [0.3101, 0.9263],
    [0.1663, 0.8814],
  ];

  it("crops to the lifted subject shaped like a quadrilateral, frame included, over the rectangles", () => {
    const detection = still(
      [petitPalaisRectangle],
      [
        { quad: petitPalaisPainting, quadFill: 1.001 },
        { quad: orsayVisitors, quadFill: 1.101 },
      ],
    );
    expect(selectCaptureQuad(null, detection)).toEqual(petitPalaisPainting);
    expect(selectCaptureQuad(previewQuad, detection)).toEqual(petitPalaisPainting);
  });

  it("ignores lifted subjects that are not quadrilaterals: visitors, figures inside a canvas, visitors merged with a painting", () => {
    // Orsay (Jean-François Gornet, CC BY-SA 2.0): the visitors are lifted, not the painting; the sky rectangle is inside the painting.
    expect(selectCaptureQuad(null, still([orsaySky, orsayOuter], [{ quad: orsayVisitors, quadFill: 1.164 }]))).toEqual(
      orsayOuter,
    );
    // Georges de La Tour photographed edge to edge: the figure is lifted; nothing else means a boundary retake.
    expect(
      selectCaptureQuad(
        null,
        still(
          [],
          [
            {
              quad: [
                [0.2115, 0.0532],
                [0.516, 0.0884],
                [0.5665, 0.9858],
                [0.03, 0.9918],
              ],
              quadFill: 1.187,
            },
          ],
        ),
      ),
    ).toBeNull();
    expect(selectCaptureQuad(null, still([], [{ quad: petitPalaisPainting, quadFill: 0.962 }]))).toBeNull();
    expect(selectCaptureQuad(null, still([], [{ quad: petitPalaisPainting, quadFill: 1.03 }]))).toBeNull();
  });

  it.each([
    {
      title: "The Bedroom",
      quad: [
        [0.478, 0.268],
        [0.919, 0.339],
        [0.935, 0.774],
        [0.598, 0.846],
      ] as Quad,
      quadFill: 1.004,
    },
    {
      title: "La Grande Jatte",
      quad: [
        [0.764, 0.115],
        [0.903, 0.165],
        [0.951, 0.849],
        [0.784, 0.883],
      ] as Quad,
      quadFill: 0.981,
    },
  ])(
    "requests a boundary retake for $title when a small interior subject lifts without a painting boundary",
    ({ quad, quadFill }) => {
      // iPhone 16 Pro detections on the original collection images: the bed and a figure, respectively.
      expect(selectCaptureQuad(null, still([], [{ quad, quadFill }]))).toBeNull();
    },
  );

  it("accepts a small lifted painting when a rectangle corroborates its boundary", () => {
    const painting = toQuad(box(0.3, 0.3, 0.7, 0.6));
    expect(selectCaptureQuad(null, still([painting], [{ quad: painting, quadFill: 1.004 }]))).toEqual(painting);
  });

  it("prefers the subject under the preview quad and drops subjects cut off by the image edge", () => {
    // Alte Pinakothek Room XIII (Mattes, CC BY-SA 3.0), cropped around the left wall: two framed paintings lifted.
    const left: Quad = [
      [0.2076, 0.1839],
      [0.5967, 0.2334],
      [0.5801, 0.8001],
      [0.1835, 0.8538],
    ];
    const middle: Quad = [
      [0.6995, 0.2952],
      [0.9439, 0.3167],
      [0.9295, 0.7217],
      [0.6834, 0.7508],
    ];
    const both = still(
      [],
      [
        { quad: middle, quadFill: 1.012 },
        { quad: left, quadFill: 1.004 },
      ],
    );
    expect(selectCaptureQuad(null, both)).toEqual(left);
    expect(
      selectCaptureQuad(
        [
          [0.65, 0.25],
          [0.98, 0.25],
          [0.98, 0.8],
          [0.65, 0.8],
        ],
        both,
      ),
    ).toEqual(middle);
    // National Museum in Kielce (SOULinPIX, CC BY 4.0), cropped: the larger lifted quadrilateral is a door at the right edge.
    const door: Quad = [
      [0.7082, 0.1692],
      [0.998, 0.2411],
      [0.998, 0.9985],
      [0.7087, 0.9985],
    ];
    const painting: Quad = [
      [0.2348, 0.2239],
      [0.6638, 0.2903],
      [0.6518, 0.7293],
      [0.2262, 0.8094],
    ];
    expect(
      selectCaptureQuad(
        null,
        still(
          [painting],
          [
            { quad: door, quadFill: 1.016 },
            { quad: painting, quadFill: 1.016 },
          ],
        ),
      ),
    ).toEqual(painting);
    // Paul Klee photographed edge to edge: the mask misses a corner and its quad tilts across the image; a retake is required.
    const tilted: Quad = [
      [0, 0],
      [0.9428, 0.1038],
      [0.9963, 0.8607],
      [0.103, 1],
    ];
    expect(selectCaptureQuad(null, still([], [{ quad: tilted, quadFill: 1.013 }]))).toBeNull();
  });

  it("refines the preview quad with the still rectangle closest to it when nothing was lifted", () => {
    const detection = still([toQuad(shifted(framed, 0.02)), toQuad(box(0.2, 0.05, 0.9, 0.2))]);
    expect(selectCaptureQuad(previewQuad, detection)).toEqual(toQuad(shifted(framed, 0.02)));
  });

  it("uses still evidence when no rectangle matches the preview", () => {
    expect(selectCaptureQuad(previewQuad, still([toQuad(shifted(framed, 0.1))]))).toEqual(toQuad(shifted(framed, 0.1)));
    expect(selectCaptureQuad(previewQuad, still())).toBeNull();
  });

  it.each([true, false])(
    "trusts a preview quad only when a still rectangle corroborates it (still rectangle present: %s)",
    (hasStillRectangle) => {
      const moved = toQuad(box(0.24, 0.2, 0.84, 0.8));
      expect(selectCaptureQuad(moved, still(hasStillRectangle ? [moved] : []))).toEqual(
        hasStillRectangle ? moved : null,
      );
    },
  );

  it("takes the outer rectangle for library imports and never the nested one", () => {
    expect(selectCaptureQuad(null, still([orsaySky, orsayOuter]))).toEqual(orsayOuter);
    expect(selectCaptureQuad(null, still())).toBeNull();
  });

  it.each([null, toQuad(box(0.1, 0.1, 0.9, 0.9))])(
    "keeps the whole painting when a textured detail is surrounded by smooth paint: %s",
    (preview) => {
      const painting = toQuad(box(0.1, 0.1, 0.9, 0.9));
      const detail = toQuad(box(0.3, 0.3, 0.7, 0.7));
      expect(selectCaptureQuad(preview, still([painting, detail]))).toEqual(painting);
    },
  );

  it("keeps the preview's confirmed painting instead of a lifted detail inside it", () => {
    const painting = toQuad(box(0.1, 0.1, 0.9, 0.9));
    const detail = toQuad(box(0.25, 0.25, 0.75, 0.75));
    expect(selectCaptureQuad(painting, still([painting], [{ quad: detail, quadFill: 1.004 }]))).toEqual(painting);
  });

  it("keeps the preview's confirmed painting instead of an unrelated lifted painting", () => {
    const target = toQuad(box(0.1, 0.2, 0.4, 0.8));
    const neighbor = toQuad(box(0.5, 0.1, 0.95, 0.9));
    expect(selectCaptureQuad(target, still([target], [{ quad: neighbor, quadFill: 1.004 }]))).toEqual(target);
  });

  it("refines the preview with a matching lifted boundary even when another subject is larger", () => {
    const target = toQuad(box(0.1, 0.2, 0.4, 0.8));
    const refined = toQuad(box(0.11, 0.21, 0.41, 0.81));
    const neighbor = toQuad(box(0.5, 0.1, 0.95, 0.9));
    expect(
      selectCaptureQuad(
        target,
        still(
          [target],
          [
            { quad: neighbor, quadFill: 1.004 },
            { quad: refined, quadFill: 1.004 },
          ],
        ),
      ),
    ).toEqual(refined);
  });

  it("keeps an ambiguous screen boundary unless the preview targets the painting inside it", () => {
    const detection = still([laptopScreen, jatteOnScreen]);
    expect(selectCaptureQuad(null, detection)).toEqual(laptopScreen);
    expect(selectCaptureQuad(laptopScreen, detection)).toEqual(laptopScreen);
    expect(selectCaptureQuad(jatteOnScreen, detection)).toEqual(jatteOnScreen);
  });
});

describe("nestedQuads", () => {
  const phone = toQuad(box(0.3, 0.1, 0.7, 0.9));
  const phoneScreen = toQuad(box(0.31, 0.12, 0.69, 0.88));
  // Letterboxed on the screen, so its sides sit on the screen's edges, where Vision places corners a little outside.
  const paintingOnPhone = toQuad(box(0.299, 0.35, 0.701, 0.6));

  it("offers the painting shown on a laptop screen", () => {
    expect(nestedQuads(laptopScreen, still([laptopScreen, jatteOnScreen]))).toEqual([jatteOnScreen]);
  });

  it("offers the painting on a phone, skipping a screen that is nearly the whole phone", () => {
    expect(nestedQuads(phone, still([phone, phoneScreen, paintingOnPhone]))).toEqual([paintingOnPhone]);
  });

  it("offers lifted quadrilateral subjects but not lifted people", () => {
    const visitor = toQuad(box(0.35, 0.3, 0.6, 0.8));
    expect(
      nestedQuads(
        phone,
        still(
          [phone],
          [
            { quad: paintingOnPhone, quadFill: 1.004 },
            { quad: visitor, quadFill: 1.3 },
          ],
        ),
      ),
    ).toEqual([paintingOnPhone]);
  });

  it("ignores rectangles reaching outside the boundary and details too small to be the painting", () => {
    const neighbor = toQuad(box(0.6, 0.3, 0.95, 0.6));
    const detail = toQuad(box(0.4, 0.4, 0.55, 0.55));
    expect(nestedQuads(phone, still([phone, neighbor, detail]))).toEqual([]);
  });

  it("offers at most two crops, each clearly smaller than the one before", () => {
    const outer = toQuad(box(0.05, 0.05, 0.95, 0.95));
    const canvas = toQuad(box(0.1, 0.1, 0.9, 0.9));
    const sameCanvas = toQuad(box(0.12, 0.12, 0.88, 0.88));
    const inner = toQuad(box(0.2, 0.2, 0.8, 0.8));
    const detail = toQuad(box(0.3, 0.3, 0.7, 0.7));
    expect(nestedQuads(outer, still([detail, inner, sameCanvas, canvas, outer]))).toEqual([canvas, inner]);
  });
});
