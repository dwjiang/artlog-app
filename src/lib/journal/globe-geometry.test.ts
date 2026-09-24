import {
  globeCamera,
  globeClusters,
  globeGeometry,
  hitGlobePin,
  projectGlobePin,
} from "./globe-geometry";
const pin = (id: string, latitude: number, longitude: number) => ({
  id,
  latitude,
  longitude,
  label: id,
});
it("centers the most recent museum and hides museums on the far side", () => {
  const camera = globeCamera(40, -74),
    center = globeGeometry(370, 337, 1);
  const point = projectGlobePin(pin("Met", 40, -74), camera, 370, 337);
  expect(point.x).toBeCloseTo(center.cx);
  expect(point.y).toBeCloseTo(center.cy);
  expect(point.depth).toBeCloseTo(1);
  expect(
    globeClusters(
      [pin("Met", 40, -74), pin("far", -40, 106)],
      camera,
      370,
      337,
    ).map((group) => group.ids),
  ).toEqual([["Met"]]);
});
it("clusters nearby museums, hits the visible cluster, and ignores empty space", () => {
  const camera = globeCamera(40.78, -73.96);
  const groups = globeClusters(
    [
      pin("Met", 40.78, -73.96),
      pin("MoMA", 40.76, -73.97),
      pin("London", 51.5, -0.13),
    ],
    camera,
    370,
    337,
  );
  expect(groups).toHaveLength(2);
  expect(groups[0].ids).toEqual(["Met", "MoMA"]);
  expect(hitGlobePin(groups, groups[0].x + 5, groups[0].y)).toBe("Met");
  expect(hitGlobePin(groups, 0, 0)).toBeUndefined();
});
it("rotates across the date line and scales positions with zoom", () => {
  const place = pin("Fiji", -17, 178);
  const a = projectGlobePin(place, globeCamera(-17, -182), 370, 337);
  const b = projectGlobePin(place, globeCamera(-17, 178), 370, 337);
  expect(a.x).toBeCloseTo(b.x);
  expect(a.depth).toBeCloseTo(b.depth);
  const camera = globeCamera(0, 0),
    center = globeGeometry(370, 337, 1);
  const normal = projectGlobePin(pin("east", 0, 30), camera, 370, 337);
  const zoomed = projectGlobePin(
    pin("east", 0, 30),
    { ...camera, zoom: 2 },
    370,
    337,
  );
  expect(zoomed.x - center.cx).toBeCloseTo(2 * (normal.x - center.cx));
});
