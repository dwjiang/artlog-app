import {
  activeHashtag,
  completeHashtag,
  extractHashtags,
  hashtagSegments,
  MAX_POST_TAGS,
  normalizeHashtag,
} from "./hashtags";

const tags = (text: string) => hashtagSegments(text).flatMap((segment) => (segment.tag ? [segment.text] : []));

it("links tags anywhere in the text and keeps the rest as plain text", () => {
  expect(hashtagSegments("First #sketchsunday of the fall. #monet")).toEqual([
    { text: "First " },
    { text: "#sketchsunday", tag: "sketchsunday" },
    { text: " of the fall. " },
    { text: "#monet", tag: "monet" },
  ]);
  expect(hashtagSegments("No tags here.")).toEqual([{ text: "No tags here." }]);
  expect(hashtagSegments("")).toEqual([]);
});

it("ends a tag at punctuation and starts one after punctuation or a line break", () => {
  expect(tags("(#monet), #renoir. #cassatt!\n#degas?")).toEqual(["#monet", "#renoir", "#cassatt", "#degas"]);
  expect(tags("#impressionism_room")).toEqual(["#impressionism_room"]);
});

it("reads letters from any script, with or without accents", () => {
  expect(tags("#café #浮世絵 #Ελλάδα #über_art")).toEqual(["#café", "#浮世絵", "#Ελλάδα", "#über_art"]);
});

it("leaves numbers, mid-word marks, URL fragments and entities unlinked", () => {
  expect(tags("Gallery #243, room #1, a#b, example.com/#x, &#39; ##double")).toEqual([]);
  expect(tags("#1900s")).toEqual(["#1900s"]);
});

it("leaves overlong words unlinked", () => {
  expect(tags(`#${"a".repeat(50)}`)).toHaveLength(1);
  expect(tags(`#${"a".repeat(51)}`)).toEqual([]);
});

it("matches tags regardless of case and Unicode form but shows them as typed", () => {
  expect(hashtagSegments("#Monet")).toEqual([{ text: "#Monet", tag: "monet" }]);
  expect(normalizeHashtag("Café")).toBe("café");
  expect(normalizeHashtag("CAFÉ")).toBe("café");
  for (const invalid of ["", "123", "a b", "#monet", "a".repeat(51)]) expect(normalizeHashtag(invalid)).toBeNull();
});

it("indexes each tag once, up to the post limit", () => {
  expect(extractHashtags("#Monet #monet #MONET #renoir")).toEqual(["monet", "renoir"]);
  const many = Array.from({ length: MAX_POST_TAGS + 5 }, (_, index) => `#tag${index}`).join(" ");
  expect(extractHashtags(many)).toHaveLength(MAX_POST_TAGS);
});

it("finds the tag being typed at the cursor", () => {
  const text = "Water lilies #imp";
  expect(activeHashtag(text, text.length)).toEqual({ start: 13, end: 17, query: "imp" });
  expect(activeHashtag("#Imp and more", 4)).toEqual({ start: 0, end: 4, query: "imp" });
  // The cursor mid-word still completes the whole word.
  expect(activeHashtag("#impasto", 3)).toEqual({ start: 0, end: 8, query: "im" });
  expect(activeHashtag("Just #", 6)).toEqual({ start: 5, end: 6, query: "" });
  for (const [value, cursor] of [
    ["No tag", 6],
    ["#monet done", 11],
    ["a#b", 3],
    ["example.com/#x", 14],
  ] as const) {
    expect(activeHashtag(value, cursor)).toBeNull();
  }
});

it("completes the typed tag and moves the cursor past one space", () => {
  expect(completeHashtag("Lilies #imp", { start: 7, end: 11 }, "impressionism", 1000)).toEqual({
    text: "Lilies #impressionism ",
    cursor: 22,
  });
  expect(completeHashtag("#imp more", { start: 0, end: 4 }, "impasto", 1000)).toEqual({
    text: "#impasto more",
    cursor: 9,
  });
});

it("refuses overlong completions without truncating the tag or surrounding text", () => {
  expect(completeHashtag("#imp more", { start: 0, end: 4 }, "impasto", 12)).toBeNull();
  expect(completeHashtag("#imp more", { start: 0, end: 4 }, "impasto", 13)).toEqual({
    text: "#impasto more",
    cursor: 9,
  });
  expect(completeHashtag("#imp", { start: 0, end: 4 }, "impasto", 8)).toBeNull();
});
