import { DESCRIPTOR_BYTES } from '../../../convex/lib/orb/features';

export type OrbParity = {
  count: number;
  expectedCount: number;
  /** Rows byte-identical to the expected row at the same index. */
  rowsInOrder: number;
  /** Rows byte-identical to any expected row; ties in ORB's response ranking reorder rows. */
  rowsAnywhere: number;
};

export function compareDescriptors(actual: ArrayBuffer, expected: ArrayBuffer): OrbParity {
  const actualRows = rowsOf(new Uint8Array(actual));
  const expectedRows = rowsOf(new Uint8Array(expected));
  const expectedSet = new Set(expectedRows);
  let rowsInOrder = 0;
  let rowsAnywhere = 0;
  actualRows.forEach((row, index) => {
    if (row === expectedRows[index]) rowsInOrder += 1;
    if (expectedSet.has(row)) rowsAnywhere += 1;
  });
  return { count: actualRows.length, expectedCount: expectedRows.length, rowsInOrder, rowsAnywhere };
}

function rowsOf(bytes: Uint8Array): string[] {
  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += DESCRIPTOR_BYTES) {
    rows.push(String.fromCharCode(...bytes.subarray(offset, offset + DESCRIPTOR_BYTES)));
  }
  return rows;
}

export function decodeBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
