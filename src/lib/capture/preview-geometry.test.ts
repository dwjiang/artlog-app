import { previewGeometry } from './preview-geometry';

it.each([
  { width: 512, height: 341, x: 0, y: 85 },
  { width: 341, height: 512, x: 85, y: 0 },
  { width: 512, height: 512, x: 0, y: 0 },
])('fits the whole artwork and aligns model corners after removing padding: %j', ({ width, height, x, y }) => {
  const geometry = previewGeometry({ width, height }, { width: 390, height: 339 }, 512)!;
  const scale = geometry.model.width / 512;
  expect(geometry.artwork.width).toBeCloseTo(width * scale);
  expect(geometry.artwork.height).toBeCloseTo(height * scale);
  expect(geometry.artwork.left * 2 + geometry.artwork.width).toBeCloseTo(390);
  expect(geometry.artwork.top * 2 + geometry.artwork.height).toBeCloseTo(339);
  expect(geometry.model.left + x * scale).toBeCloseTo(0);
  expect(geometry.model.top + y * scale).toBeCloseTo(0);
  expect(geometry.artwork.width).toBeLessThanOrEqual(390);
  expect(geometry.artwork.height).toBeLessThanOrEqual(339);
});

it('waits for image dimensions and layout', () => {
  expect(previewGeometry({ width: 0, height: 0 }, { width: 390, height: 339 }, 512)).toBeNull();
  expect(previewGeometry({ width: 512, height: 341 }, { width: 0, height: 0 }, 512)).toBeNull();
});
