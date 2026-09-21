import { toOcrLines } from './label-ocr';

it('trims, clamps confidence, drops blank lines, and caps the count in reading order', () => {
  const lines = [
    { text: '  Claude Monet ', confidence: 1.2 }, { text: '   ', confidence: 1 }, { text: 'x'.repeat(400), confidence: -0.1 },
    ...Array.from({ length: 90 }, (_, i) => ({ text: `line ${i}`, confidence: 0.5 })),
  ];
  const result = toOcrLines(lines);
  expect(result).toHaveLength(80);
  expect(result[0]).toEqual({ text: 'Claude Monet', confidence: 1 });
  expect(result[1]).toEqual({ text: 'x'.repeat(300), confidence: 0 });
  expect(result[2]).toEqual({ text: 'line 0', confidence: 0.5 });
  expect(result[79]).toEqual({ text: 'line 77', confidence: 0.5 });
});
