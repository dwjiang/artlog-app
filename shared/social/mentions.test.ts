import {
  activeMention,
  completeMention,
  extractMentions,
  MAX_MENTIONS,
  mentionSegments,
  normalizeMention,
} from "./mentions";
import { richTextSegments } from "./rich-text";

const handles = (text: string) => mentionSegments(text).flatMap((segment) => (segment.mention ? [segment.text] : []));

it("finds handles anywhere in the text and keeps the rest as plain text", () => {
  expect(mentionSegments("Saw it with @maya and @jonahp.")).toEqual([
    { text: "Saw it with " },
    { text: "@maya", mention: "maya" },
    { text: " and " },
    { text: "@jonahp", mention: "jonahp" },
    { text: "." },
  ]);
  expect(mentionSegments("No one here.")).toEqual([{ text: "No one here." }]);
  expect(mentionSegments("")).toEqual([]);
});

it("ends a handle at punctuation and starts one after punctuation or a line break", () => {
  expect(handles("(@maya), @leo_m! @priya’s\n@sam?")).toEqual(["@maya", "@leo_m", "@priya", "@sam"]);
});

it("leaves email addresses, URL paths, tags, accented words and impossible usernames as text", () => {
  expect(handles("maya@example.com site.com/@maya #art@maya @@maya @café @ab")).toEqual([]);
  expect(handles(`@${"a".repeat(30)} @${"a".repeat(31)}`)).toEqual([`@${"a".repeat(30)}`]);
});

it("matches handles regardless of case but shows them as typed", () => {
  expect(mentionSegments("@Maya")).toEqual([{ text: "@Maya", mention: "maya" }]);
  expect(normalizeMention("MAYA_C")).toBe("maya_c");
  for (const invalid of ["", "ab", "maya chen", "maya.chen", "café"]) expect(normalizeMention(invalid)).toBeNull();
});

it("names each person once, up to the limit", () => {
  expect(extractMentions("@Maya @maya @leo")).toEqual(["maya", "leo"]);
  const many = Array.from({ length: MAX_MENTIONS + 5 }, (_, index) => `@person${index}`).join(" ");
  expect(extractMentions(many)).toHaveLength(MAX_MENTIONS);
});

it("finds the handle being typed at the cursor, including a bare @", () => {
  const text = "Loved this. @Ma";
  expect(activeMention(text, text.length)).toEqual({ start: 12, end: 15, query: "ma" });
  expect(activeMention("Loved this. @", 13)).toEqual({ start: 12, end: 13, query: "" });
  expect(activeMention("@mayachen", 3)).toEqual({ start: 0, end: 9, query: "ma" });
  for (const [value, cursor] of [
    ["No one", 6],
    ["@maya done", 10],
    ["maya@ex", 7],
    ["#art@ma", 7],
  ] as const) {
    expect(activeMention(value, cursor)).toBeNull();
  }
});

it("completes the handle and moves the cursor past one space", () => {
  expect(completeMention("Loved this. @ma", { start: 12, end: 15 }, "maya", 1000)).toEqual({
    text: "Loved this. @maya ",
    cursor: 18,
  });
  expect(completeMention("@ma it", { start: 0, end: 3 }, "maya", 1000)).toEqual({ text: "@maya it", cursor: 6 });
  expect(completeMention("@ma it", { start: 0, end: 3 }, "maya", 7)).toBeNull();
});

it("splits tags and handles together, keeping each one's word boundaries", () => {
  expect(richTextSegments("With @maya at #monet, then #art@leo")).toEqual([
    { text: "With " },
    { text: "@maya", mention: "maya" },
    { text: " at " },
    { text: "#monet", tag: "monet" },
    { text: ", then " },
    { text: "#art", tag: "art" },
    { text: "@leo" },
  ]);
});
