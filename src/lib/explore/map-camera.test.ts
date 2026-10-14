import { museumMapCamera } from "./map-camera";
import type { ExploreMuseum } from "./types";

const museum = (name: string, lat: number, lng: number): ExploreMuseum => ({ id: name, name, lat, lng });
const abbadia = museum("Abbadia Castle", 43.3775, -1.749167);
const newYork = museum("A La Vieille Russie", 40.7643, -73.9728);
const nearby = museum("Nearby museum", 43.4, -1.7);

it("opens around the leading museum even when alphabetical entries cross an ocean", () => {
  const camera = museumMapCamera([abbadia, newYork, nearby], 0.55)!;
  expect(camera.coordinates!.latitude).toBeGreaterThan(43);
  expect(camera.coordinates!.latitude).toBeLessThan(44);
  expect(camera.coordinates!.longitude).toBeGreaterThan(-2);
  expect(camera.coordinates!.longitude).toBeLessThan(-1);
  expect(camera.zoom).toBeGreaterThan(10);
});

it("keeps a sparse region local even when fewer than ten museums are nearby", () => {
  expect(museumMapCamera([abbadia, newYork], 0.55)).toEqual(museumMapCamera([abbadia], 0.55));
});

it("follows a distance-ordered leading museum instead of assuming a country's mainland", () => {
  expect(museumMapCamera([newYork, abbadia, nearby], 0.55)).toEqual(museumMapCamera([newYork], 0.55));
});

it("leaves the native camera unset while no museums are available", () => {
  expect(museumMapCamera([], 0.55)).toBeUndefined();
});
