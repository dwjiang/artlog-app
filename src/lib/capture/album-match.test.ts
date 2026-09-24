import { albumMatch } from "./album-match";

const best = (objectId: string) => ({ objectId }) as never;

it("confirms only a confident match to the same physical object", () => {
  expect(albumMatch({ outcome: "confident", best: best("one") }, "one")).toBe("same");
  expect(albumMatch({ outcome: "confident", best: best("another") }, "one")).toBe("conflict");
});

it("requires review for soft matches, unknown targets, and unavailable recognition", () => {
  expect(albumMatch({ outcome: "soft", best: best("one") }, "one")).toBe("uncertain");
  expect(albumMatch({ outcome: "confident", best: best("one") })).toBe("uncertain");
  expect(albumMatch(undefined, "one")).toBe("uncertain");
});
