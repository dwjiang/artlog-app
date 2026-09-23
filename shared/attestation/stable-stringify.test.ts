import { stableStringify } from "./stable-stringify";

describe("canonical payloads", () => {
  it("sorts object keys recursively and preserves array order", () => {
    const first = { z: [{ b: 2, a: 1 }, null, "é.🎨"], a: { d: false, c: 3 } };
    const second = { a: { c: 3, d: false }, z: [{ a: 1, b: 2 }, null, "é.🎨"] };
    expect(stableStringify(first)).toBe('{"a":{"c":3,"d":false},"z":[{"a":1,"b":2},null,"é.🎨"]}');
    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(stableStringify({ a: [2, 1] })).not.toBe(stableStringify({ a: [1, 2] }));
    expect(Object.keys(first)).toEqual(["z", "a"]);
  });

  it("keeps JSON semantics for optional fields, dates, and special property names", () => {
    expect(
      stableStringify({ z: undefined, a: [undefined], date: new Date("2026-09-09T00:00:00Z") }),
    ).toBe('{"a":[null],"date":"2026-09-09T00:00:00.000Z"}');
    expect(stableStringify(JSON.parse('{"z":1,"__proto__":{"b":2,"a":1}}'))).toBe(
      '{"__proto__":{"a":1,"b":2},"z":1}',
    );
  });
});
