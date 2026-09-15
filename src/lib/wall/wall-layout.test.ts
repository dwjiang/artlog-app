import { constrainLayout, nextWallLayout, removeWallPiece, wallBottom, type WallPiece } from './wall-layout';

const piece = (width: number, height: number): WallPiece => ({ localId: 'one',
  artwork: { title: 'A painting', artist: 'An artist', media: { kind: 'catalog', width, height,
    url: 'https://example.com/art.jpg', sourceUrl: 'https://example.com/art', rights: 'public_domain' } },
  layout: { x: 0.1, y: 0.2, width: 0.4, layer: 0, frame: 'gilt' },
});

it('sizes the wall from uncropped artwork proportions', () => {
  expect(wallBottom([piece(200, 400)])).toBeCloseTo(1);
  expect(wallBottom([piece(400, 200)])).toBeCloseTo(0.4);
});

it('keeps a newly hung local photo at its original proportions before publishing', () => {
  expect(wallBottom([{ ...piece(1, 1), cropAspectRatio: 0.5 }])).toBeCloseTo(1);
});

it('keeps a moved or enlarged artwork inside the wall', () => {
  const layout = constrainLayout(piece(1, 1).layout, { x: 2, y: -1, width: 0.9 });
  expect(layout.x + layout.width).toBeLessThanOrEqual(0.975);
  expect(layout.y).toBe(0.04);
  expect(constrainLayout(layout, { width: -1, y: 200 })).toMatchObject({ width: 0.16, y: 99 });
});

it('varies new artwork sizes while keeping each placement clear of existing paintings and labels', () => {
  const pieces: WallPiece[] = [];
  for (let index = 0; index < 16; index++) {
    const next = nextWallLayout(pieces);
    expect(next.x).toBeGreaterThanOrEqual(0.025);
    expect(next.x + next.width).toBeLessThanOrEqual(0.975);
    for (const previous of pieces) {
      const overlaps = next.x < previous.layout.x + previous.layout.width && next.x + next.width > previous.layout.x;
      if (overlaps) expect(next.y).toBeGreaterThanOrEqual(wallBottom([previous]) + 0.14);
    }
    pieces.push({ ...piece(index % 2 ? 2 : 1, 2), localId: String(index), layout: next });
  }
  expect(new Set(pieces.map((item) => item.layout.width)).size).toBeGreaterThan(3);
  expect(pieces[1].layout.y).toBeLessThan(wallBottom([pieces[0]]));
});

it('removes only the wall placement and compacts layers for the API', () => {
  const draft = { color: '#CDD0CA', items: ['one', 'two', 'three'].map((saveLocalId, layer) => ({
    saveLocalId, layout: { ...piece(1, 1).layout, layer },
  })) };
  expect(removeWallPiece(draft, 'two').items.map((item) => [item.saveLocalId, item.layout.layer]))
    .toEqual([['one', 0], ['three', 1]]);
  expect(draft.items).toHaveLength(3);
});
