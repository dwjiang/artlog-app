import { artistLine } from "./artist-line";

it("joins the artist and date with a middle dot", () => {
  expect(artistLine("Vincent van Gogh", "1889")).toBe("Vincent van Gogh · 1889");
});

it("shows whichever part is known, trimmed, and nothing when neither is", () => {
  expect(artistLine("Edward Hopper", "")).toBe("Edward Hopper");
  expect(artistLine(undefined, "c. 1665")).toBe("c. 1665");
  expect(artistLine("  Claude Monet ", " 1906 ")).toBe("Claude Monet · 1906");
  expect(artistLine(null, null)).toBe("");
});
