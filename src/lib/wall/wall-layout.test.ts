import {
  arrangeWall,
  constrainLayout,
  constrainWallPiece,
  dropWallPiece,
  nextWallLayout,
  removeWallPiece,
  resizeWallLayout,
  wallBottom,
  wallPieceBounds,
  type WallArrangement,
  type WallPiece,
} from "./wall-layout";

const piece = (width: number, height: number): WallPiece => ({
  localId: "one",
  artwork: {
    title: "A painting",
    artist: "An artist",
    media: {
      kind: "catalog",
      width,
      height,
      url: "https://example.com/art.jpg",
      sourceUrl: "https://example.com/art",
      rights: "public_domain",
    },
  },
  layout: { x: 0.1, y: 0.2, width: 0.4, layer: 0, frame: "gilt" },
});

it("sizes the wall from uncropped artwork proportions", () => {
  expect(wallBottom([{ ...piece(200, 400), layout: { ...piece(200, 400).layout, frame: "black" } }])).toBeCloseTo(
    0.9663,
  );
  expect(wallBottom([{ ...piece(400, 200), layout: { ...piece(400, 200).layout, frame: "black" } }])).toBeCloseTo(
    0.4169,
  );
});

it("keeps a newly hung local photo at its original proportions before publishing", () => {
  expect(
    wallBottom([{ ...piece(1, 1), cropAspectRatio: 0.5, layout: { ...piece(1, 1).layout, frame: "black" } }]),
  ).toBeCloseTo(0.9663);
});

it("uses a matte black frame for every new placement without changing existing customization", () => {
  const pieces = [
    piece(1, 1),
    {
      ...piece(2, 1),
      localId: "two",
      layout: { ...piece(2, 1).layout, frame: "walnut" as const },
    },
  ];
  expect(nextWallLayout([]).frame).toBe("black");
  expect(nextWallLayout(pieces).frame).toBe("black");
  expect(pieces.map((item) => item.layout.frame)).toEqual(["gilt", "walnut"]);
});

it("keeps a moved or enlarged artwork inside the wall", () => {
  const layout = constrainLayout(piece(1, 1).layout, {
    x: 2,
    y: -1,
    width: 0.9,
  });
  expect(layout.x + layout.width).toBeLessThanOrEqual(0.975);
  expect(layout.y).toBe(0.04);
  expect(constrainLayout(layout, { width: -1, y: 200 })).toMatchObject({
    width: 0.16,
    y: 99,
  });
});

it("varies new artwork sizes while keeping each placement clear of existing paintings and labels", () => {
  const pieces: WallPiece[] = [];
  for (let index = 0; index < 16; index++) {
    const next = nextWallLayout(pieces);
    expect(next.x).toBeGreaterThanOrEqual(0.025);
    expect(next.x + next.width).toBeLessThanOrEqual(0.975);
    const overlapping = pieces.filter(
      (previous) => next.x < previous.layout.x + previous.layout.width && next.x + next.width > previous.layout.x,
    );
    for (const previous of overlapping) {
      expect(next.y).toBeGreaterThanOrEqual(wallBottom([previous]) + 0.14);
    }
    pieces.push({
      ...piece(index % 2 ? 2 : 1, 2),
      localId: String(index),
      layout: next,
    });
  }
  expect(new Set(pieces.map((item) => item.layout.width)).size).toBeGreaterThan(3);
  expect(pieces[1].layout.y).toBeLessThan(wallBottom([pieces[0]]));
});

it("removes only the wall placement and compacts layers for the API", () => {
  const draft = {
    color: "#CDD0CA",
    items: ["one", "two", "three"].map((saveLocalId, layer) => ({
      placementId: saveLocalId,
      saveLocalId,
      layout: { ...piece(1, 1).layout, layer },
    })),
  };
  expect(removeWallPiece(draft, "two").items.map((item) => [item.saveLocalId, item.layout.layer])).toEqual([
    ["one", 0],
    ["three", 1],
  ]);
  expect(draft.items).toHaveLength(3);
});

describe("resizing from artwork corners", () => {
  const layout = { ...piece(2, 1).layout, x: 0.3, y: 0.4 };

  it.each(["top-left", "top-right", "bottom-left", "bottom-right"] as const)(
    "grows from %s while the opposite corner stays fixed",
    (corner) => {
      const left = corner.endsWith("left");
      const top = corner.startsWith("top");
      const next = resizeWallLayout(layout, corner, { x: left ? -0.1 : 0.1, y: top ? -0.05 : 0.05 }, 2);
      expect(next.width).toBeCloseTo(0.5);
      expect(next.x + (left ? next.width : 0)).toBeCloseTo(layout.x + (left ? layout.width : 0));
      expect(next.y + (top ? next.width / 2 : 0)).toBeCloseTo(layout.y + (top ? layout.width / 2 : 0));
      expect(next.frame).toBe(layout.frame);
      expect(next.layer).toBe(layout.layer);
    },
  );

  it("responds to vertical dragging and keeps a minimum size", () => {
    expect(resizeWallLayout(layout, "bottom-right", { x: 0, y: 0.2 }, 2).width).toBeGreaterThan(layout.width);
    expect(resizeWallLayout(layout, "top-left", { x: 10, y: 10 }, 2)).toMatchObject({ width: 0.16 });
  });

  it("stops at the side and top of the wall without shifting the opposite corner", () => {
    const left = resizeWallLayout(layout, "bottom-left", { x: -10, y: 10 }, 2);
    expect(left.x).toBeCloseTo(0.025);
    expect(left.x + left.width).toBeCloseTo(layout.x + layout.width);
    const right = resizeWallLayout(layout, "bottom-right", { x: 10, y: 10 }, 2);
    expect(right.x + right.width).toBeCloseTo(0.975);
    expect(right.x).toBe(layout.x);
    const top = resizeWallLayout({ ...layout, y: 0.05 }, "top-right", { x: 10, y: -10 }, 0.5);
    expect(top.y).toBeCloseTo(0.04);
    expect(top.y + top.width / 0.5).toBeCloseTo(0.05 + layout.width / 0.5);
  });
});

describe("keeping wall artworks apart", () => {
  const moving = { ...piece(1, 1), layout: { ...piece(1, 1).layout, x: 0.05, y: 0.1, width: 0.2 } };
  const neighbor = {
    ...piece(1, 1),
    localId: "neighbor",
    layout: { ...moving.layout, x: 0.5 },
  };

  it("stops a drag before another artwork and permits moving away again", () => {
    const next = constrainWallPiece(moving, { x: 0.4 }, [moving, neighbor], 390);
    expect(next.x).toBeGreaterThan(moving.layout.x);
    expect(next.x + next.width).toBeLessThanOrEqual(neighbor.layout.x - 0.025);
    expect(constrainWallPiece({ ...moving, layout: next }, { x: 0.05 }, [neighbor], 390).x).toBe(0.05);
  });

  it("constrains resizing and accessible size adjustments against neighbors", () => {
    const next = constrainWallPiece(moving, { width: 0.6 }, [neighbor], 390);
    expect(next.width).toBeGreaterThan(moving.layout.width);
    expect(next.x + next.width).toBeLessThanOrEqual(neighbor.layout.x - 0.025);
    expect(next.x).toBe(moving.layout.x);
  });

  it("accounts for landscape frames and leaves room for artwork labels", () => {
    const landscape = { ...moving, cropAspectRatio: 3, layout: { ...moving.layout, frame: "mat" as const } };
    const bounds = wallPieceBounds(landscape, 390);
    expect(bounds.height).toBeGreaterThan(landscape.layout.width / 3);
    const below = { ...neighbor, layout: { ...neighbor.layout, x: moving.layout.x, y: 0.8 } };
    const next = constrainWallPiece(below, { y: 0.12 }, [landscape], 390);
    expect(next.y).toBeGreaterThanOrEqual(bounds.y + bounds.height + 0.16);
  });

  it("allows clear placements and ignores the artwork's own old placement", () => {
    expect(constrainWallPiece(moving, { y: 0.5 }, [moving, neighbor], 390)).toEqual({ ...moving.layout, y: 0.5 });
  });

  it("allows an already overlapping artwork to be dragged into free space", () => {
    const overlapping = { ...moving, layout: { ...moving.layout, x: 0.5 } };
    expect(constrainWallPiece(overlapping, { y: 1 }, [neighbor], 390).y).toBe(1);
  });

  it("lets repeated small moves separate artworks after a taller photo is selected", () => {
    const taller = { ...piece(1, 1), cropAspectRatio: 0.4 };
    let below = { ...neighbor, layout: { ...taller.layout, y: 1.2 } };
    for (let step = 0; step < 8; step++) {
      const next = constrainWallPiece(below, { y: below.layout.y + 0.025 }, [taller], 390);
      expect(next.y).toBeCloseTo(below.layout.y + 0.025);
      below = { ...below, layout: next };
    }
    const bounds = wallPieceBounds(taller, 390);
    expect(below.layout.y).toBeGreaterThanOrEqual(bounds.y + bounds.height + 0.16);
  });

  it("lets repeated small size decreases resolve an overlap", () => {
    let taller = { ...piece(1, 1), cropAspectRatio: 0.4 };
    const below = { ...neighbor, layout: { ...taller.layout, y: 1.2 } };
    for (let step = 0; step < 4; step++) {
      const next = constrainWallPiece(taller, { width: taller.layout.width - 0.04 }, [below], 390);
      expect(next.width).toBeCloseTo(taller.layout.width - 0.04);
      taller = { ...taller, layout: next };
    }
    const bounds = wallPieceBounds(taller, 390);
    expect(bounds.y + bounds.height + 0.16).toBeLessThanOrEqual(below.layout.y);
  });

  it("lets an artwork fully inside another move toward the nearest edge", () => {
    const inside = { ...moving, layout: { ...moving.layout, x: 0.2, y: 0.2, width: 0.16 } };
    const enclosing = { ...neighbor, layout: { ...neighbor.layout, x: 0.1, y: 0.1, width: 0.6 } };
    expect(constrainWallPiece(inside, { x: 0.175 }, [enclosing], 390).x).toBe(0.175);
    expect(constrainWallPiece(inside, { x: 0.225 }, [enclosing], 390)).toEqual(inside.layout);
  });

  it.each([0.525, 0.625])("does not worsen another collision while escaping an overlap (neighbor at %s)", (x) => {
    const overlapping = { ...moving, layout: { ...moving.layout, x: 0.4 } };
    const left = { ...neighbor, layout: { ...neighbor.layout, x: 0.25 } };
    const right = { ...neighbor, localId: "right", layout: { ...neighbor.layout, x } };
    expect(constrainWallPiece(overlapping, { x: 0.425 }, [left, right], 390)).toEqual(overlapping.layout);
  });
});

describe("dropping an artwork", () => {
  const hung = (localId: string, layout: Partial<WallPiece["layout"]>, aspect = 1): WallPiece => ({
    ...piece(aspect, 1),
    localId,
    layout: { x: 0.05, y: 0.1, width: 0.3, layer: 0, frame: "black", ...layout },
  });
  const left = hung("left", {});
  const right = hung("right", { x: 0.55, width: 0.4 }, 1.5);
  const bottomOf = (item: WallPiece) => {
    const bounds = wallPieceBounds(item, 390);
    return bounds.y + bounds.height;
  };
  const clashes = (pieces: WallPiece[], arrangement: WallArrangement) => {
    const placed = pieces.map((item) =>
      wallPieceBounds({ ...item, layout: arrangement[item.localId] ?? item.layout }, 390),
    );
    const apart = (a: (typeof placed)[number], b: (typeof placed)[number]) =>
      a.x + a.width + 0.025 <= b.x + 1e-9
      || b.x + b.width + 0.025 <= a.x + 1e-9
      || a.y + a.height + 0.16 <= b.y + 1e-9
      || b.y + b.height + 0.16 <= a.y + 1e-9;
    return placed.flatMap((bounds, index) => placed.slice(index + 1).filter((other) => !apart(bounds, other)));
  };

  it("trades places and sizes with the artwork it is dropped onto, reversibly", () => {
    const swapped = dropWallPiece([left, right], "left", { x: 0.6, y: 0.05 }, 390);
    expect(swapped).toEqual({
      left: { ...left.layout, x: 0.55, y: 0.1, width: 0.4 },
      right: { ...right.layout, x: 0.05, y: 0.1, width: 0.3 },
    });
    const after = [
      { ...left, layout: swapped.left },
      { ...right, layout: swapped.right },
    ];
    expect(dropWallPiece(after, "right", { x: 0.6, y: 0.05 }, 390)).toEqual({
      left: left.layout,
      right: right.layout,
    });
  });

  it.each([
    { edge: "left", x: 0.025, y: 0.5 },
    { edge: "right", x: 0.78, y: 0.5 },
    { edge: "top", x: 0.4, y: 0.04 },
  ])("swaps a large artwork onto a smaller one at the $edge edge", ({ x, y }) => {
    const large = hung("large", { x: 0.1, y: 2, width: 0.6 });
    const small = hung("small", { x, y, width: 0.18 });
    const draggedBounds = wallPieceBounds(large, 390);
    const targetBounds = wallPieceBounds(small, 390);
    const arrangement = dropWallPiece(
      [large, small],
      "large",
      {
        x: x + (targetBounds.width - draggedBounds.width) / 2,
        y: y + (targetBounds.height - draggedBounds.height) / 2,
      },
      390,
    );
    expect(arrangement).toEqual({
      large: { ...large.layout, x, y, width: small.layout.width },
      small: { ...small.layout, x: large.layout.x, y: large.layout.y, width: large.layout.width },
    });
  });

  it("keeps traded artworks apart when their new shapes would crowd each other", () => {
    const wide = hung("wide", { x: 0.55, y: 0.5 }, 1.5);
    const tall = hung("tall", { width: 0.5, y: bottomOf(wide) + 0.17 }, 0.6);
    const arrangement = dropWallPiece([wide, tall], "tall", { x: 0.45, y: 0.19 }, 390);
    expect(arrangement.tall).toEqual({ ...tall.layout, x: 0.55, y: 0.5, width: 0.3 });
    expect(arrangement.wide.width).toBe(0.5);
    expect(Math.hypot(arrangement.wide.x - 0.05, arrangement.wide.y - tall.layout.y)).toBeLessThan(0.05);
    expect(clashes([wide, tall], arrangement)).toEqual([]);
  });

  it("lands where it is dropped on open wall, kept inside the wall, without moving other artworks", () => {
    expect(dropWallPiece([left, right], "left", { x: 0.1, y: 1 }, 390)).toEqual({
      left: { ...left.layout, x: 0.1, y: 1 },
    });
    expect(dropWallPiece([left, right], "left", { x: -1, y: 2 }, 390)).toEqual({
      left: { ...left.layout, x: 0.025, y: 2 },
    });
  });

  it("moves an artwork it partly covers aside when there is room beside it", () => {
    const small = hung("small", { x: 0.6, width: 0.2 });
    const arrangement = dropWallPiece([left, small], "left", { x: 0.4, y: 0.1 }, 390);
    expect(arrangement.left).toEqual({ ...left.layout, x: 0.4 });
    expect(arrangement.small.x).toBeCloseTo(0.725);
    expect(arrangement.small.y).toBe(small.layout.y);
    expect(clashes([left, small], arrangement)).toEqual([]);
  });

  it("moves an artwork it partly covers below it when the sides are full", () => {
    const arrangement = dropWallPiece([left, right], "left", { x: 0.35, y: 0.1 }, 390);
    expect(arrangement.left).toEqual({ ...left.layout, x: 0.35 });
    expect(arrangement.right.x).toBe(right.layout.x);
    expect(arrangement.right.y).toBeCloseTo(bottomOf(left) + 0.16);
    expect(clashes([left, right], arrangement)).toEqual([]);
  });

  it("keeps moving artworks aside until none overlap", () => {
    const top = hung("top", { width: 0.4 });
    const middle = hung("middle", { width: 0.4, y: bottomOf(top) + 0.16 });
    const lower = hung("lower", { width: 0.4, y: bottomOf(middle) + 0.16 });
    const side = hung("side", { x: 0.55, width: 0.4 });
    const pieces = [top, middle, lower, side];
    const arrangement = dropWallPiece(pieces, "side", { x: 0.3, y: 0.1 }, 390);
    expect(arrangement.side).toEqual({ ...side.layout, x: 0.3 });
    expect(Object.keys(arrangement).length).toBeGreaterThan(2);
    expect(clashes(pieces, arrangement)).toEqual([]);
  });

  it("makes room below an artwork whose new frame is taller", () => {
    const upper = hung("upper", { width: 0.5 }, 2);
    const below = hung("below", { width: 0.5, y: bottomOf(upper) + 0.16 });
    const framed = { ...upper.layout, frame: "carved-leaf" as const };
    const arrangement = arrangeWall([upper, below], { upper: framed }, 390);
    expect(arrangement.upper).toEqual(framed);
    expect(arrangement.below.y).toBeGreaterThan(below.layout.y);
    expect(clashes([upper, below], arrangement)).toEqual([]);
  });
});
