type Rect = { x: number; y: number; width: number; height: number };
type RailOrnaments = { corner: number; center: number };
export type FrameSource = {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  railMode?: "tile" | "stretch";
  ornaments?: { horizontal: RailOrnaments; vertical: RailOrnaments };
};

export function framePatches(source: FrameSource, width: number, height: number, inset: number) {
  const patches: { src: Rect; dest: Rect }[] = [];
  if (width <= inset * 2 || height <= inset * 2 || inset <= 0) return patches;
  const { width: sw, height: sh, top, right, bottom, left } = source;
  const add = (src: Rect, dest: Rect) => patches.push({ src, dest });
  for (const [sx, sy, w, h, dx, dy] of [
    [0, 0, left, top, 0, 0],
    [sw - right, 0, right, top, width - inset, 0],
    [0, sh - bottom, left, bottom, 0, height - inset],
    [sw - right, sh - bottom, right, bottom, width - inset, height - inset],
  ]) {
    add({ x: sx, y: sy, width: w, height: h }, { x: dx, y: dy, width: inset, height: inset });
  }

  // Carved rails tile to preserve ornament proportions; plain rails stretch to avoid lighting seams.
  for (const [sy, thickness, dy] of [
    [0, top, 0],
    [sh - bottom, bottom, height - inset],
  ]) {
    if (source.ornaments) {
      for (const segment of ornamentSegments(
        left,
        sw - right,
        sw,
        width - inset * 2,
        inset / thickness,
        source.ornaments.horizontal,
      )) {
        add(
          { x: segment.src, y: sy, width: segment.sourceLength, height: thickness },
          { x: inset + segment.dest, y: dy, width: segment.length, height: inset },
        );
      }
      continue;
    }
    if (source.railMode === "stretch") {
      add(
        { x: left, y: sy, width: sw - left - right, height: thickness },
        { x: inset, y: dy, width: width - inset * 2, height: inset },
      );
      continue;
    }
    const scale = inset / thickness;
    const tile = (sw - left - right) * scale;
    for (let x = inset; x < width - inset - 0.001; x += tile) {
      const length = Math.min(tile, width - inset - x);
      add({ x: left, y: sy, width: length / scale, height: thickness }, { x, y: dy, width: length, height: inset });
    }
  }
  for (const [sx, thickness, dx] of [
    [0, left, 0],
    [sw - right, right, width - inset],
  ]) {
    if (source.ornaments) {
      for (const segment of ornamentSegments(
        top,
        sh - bottom,
        sh,
        height - inset * 2,
        inset / thickness,
        source.ornaments.vertical,
      )) {
        add(
          { x: sx, y: segment.src, width: thickness, height: segment.sourceLength },
          { x: dx, y: inset + segment.dest, width: inset, height: segment.length },
        );
      }
      continue;
    }
    if (source.railMode === "stretch") {
      add(
        { x: sx, y: top, width: thickness, height: sh - top - bottom },
        { x: dx, y: inset, width: inset, height: height - inset * 2 },
      );
      continue;
    }
    const scale = inset / thickness;
    const tile = (sh - top - bottom) * scale;
    for (let y = inset; y < height - inset - 0.001; y += tile) {
      const length = Math.min(tile, height - inset - y);
      add({ x: sx, y: top, width: thickness, height: length / scale }, { x: dx, y, width: inset, height: length });
    }
  }
  return patches;
}

function ornamentSegments(
  start: number,
  end: number,
  size: number,
  length: number,
  scale: number,
  { corner, center }: RailOrnaments,
) {
  const first = corner - start;
  const last = end - (size - corner);
  // Extreme panorama crops compress the ornament length, keeping clear space between the carvings.
  const fittedScale = Math.min(scale, (length * 0.9) / (2 * Math.max(first, last) + center));
  const middle = center * fittedScale;
  const src = [start, corner, (size - center) / 2, (size + center) / 2, size - corner, end];
  const dest = [
    0,
    first * fittedScale,
    (length - middle) / 2,
    (length + middle) / 2,
    length - last * fittedScale,
    length,
  ];
  return src.slice(0, -1).map((position, index) => ({
    src: position,
    sourceLength: src[index + 1] - position,
    dest: dest[index],
    length: dest[index + 1] - dest[index],
  }));
}
