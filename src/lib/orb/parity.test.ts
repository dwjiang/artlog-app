import { compareDescriptors, decodeBase64 } from "./parity";

function rows(...values: number[]): ArrayBuffer {
  const bytes = new Uint8Array(values.length * 32);
  values.forEach((value, index) =>
    bytes.fill(value, index * 32, (index + 1) * 32),
  );
  return bytes.buffer;
}

it("counts rows identical at the same index and rows present anywhere in the expected set", () => {
  expect(compareDescriptors(rows(1, 2, 3, 4), rows(1, 3, 2, 9))).toEqual({
    count: 4,
    expectedCount: 4,
    rowsInOrder: 1,
    rowsAnywhere: 3,
  });
});

it("compares different counts without reading past the shorter side", () => {
  expect(compareDescriptors(rows(1, 2), rows(1, 2, 3))).toEqual({
    count: 2,
    expectedCount: 3,
    rowsInOrder: 2,
    rowsAnywhere: 2,
  });
  expect(compareDescriptors(rows(1, 2, 3), rows(1))).toEqual({
    count: 3,
    expectedCount: 1,
    rowsInOrder: 1,
    rowsAnywhere: 1,
  });
});

it("treats rows differing in a single byte as different", () => {
  const changed = new Uint8Array(rows(7));
  changed[31] ^= 1;
  expect(compareDescriptors(changed.buffer, rows(7))).toEqual({
    count: 1,
    expectedCount: 1,
    rowsInOrder: 0,
    rowsAnywhere: 0,
  });
});

it("decodes base64 into the fixture bytes", () => {
  expect(Array.from(new Uint8Array(decodeBase64("AAEC/w==")))).toEqual([
    0, 1, 2, 255,
  ]);
});
