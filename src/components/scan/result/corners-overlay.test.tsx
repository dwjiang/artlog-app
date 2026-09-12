import { render } from '@testing-library/react-native';

import { CornersOverlay, edgeSegments } from './corners-overlay';

const square = [[0, 0], [100, 0], [100, 100], [0, 100]];

it('turns the four corners into centred edges scaled to the rendered image', () => {
  const segments = edgeSegments(square, 0.5);
  expect(segments.map((segment) => Math.round(segment.length))).toEqual([50, 50, 50, 50]);
  expect(segments.map((segment) => segment.angle)).toEqual([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
  expect(segments[0]).toMatchObject({ cx: 25, cy: 0 });
  expect(segments[2]).toMatchObject({ cx: 25, cy: 50 });
});

it('draws nothing for missing or malformed corners', async () => {
  expect(edgeSegments(undefined, 1)).toEqual([]);
  expect(edgeSegments([[0, 0], [1, 1]], 1)).toEqual([]);
  expect(edgeSegments([[0, 0], [Number.NaN, 0], [1, 1], [0, 1]], 1)).toEqual([]);
  expect((await render(<CornersOverlay inputSize={512} size={256} />)).toJSON()).toBeNull();
});

it('renders one edge per side over the image', async () => {
  const tree = (await render(<CornersOverlay corners={square} inputSize={100} size={200} />)).toJSON();
  expect(tree && !Array.isArray(tree) ? tree.children : []).toHaveLength(4);
});
