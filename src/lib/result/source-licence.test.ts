import { sourceLicence, sourceLicences } from "./source-licence";

it("names the licence of Wikipedia articles in any language", () => {
  for (const url of ["https://en.wikipedia.org/wiki/Water_Lilies", "https://fr.m.wikipedia.org/wiki/Nymph%C3%A9as"]) {
    expect(sourceLicence(url)).toMatchObject({ publisher: "Wikipedia", name: "CC BY-SA 4.0" });
  }
});

it("names the licence of the Art Institute of Chicago's artwork descriptions only", () => {
  expect(sourceLicence("https://www.artic.edu/artworks/16568/water-lilies")).toMatchObject({ name: "CC BY 4.0" });
  expect(sourceLicence("https://www.artic.edu/exhibitions/9516/monet")).toBeUndefined();
});

it("names no licence for other pages or unreadable URLs", () => {
  expect(sourceLicence("https://www.metmuseum.org/art/collection/search/437112")).toBeUndefined();
  expect(sourceLicence("https://notwikipedia.org/wiki/Monet")).toBeUndefined();
  expect(sourceLicence("not a url")).toBeUndefined();
});

it("lists each licence once, in order of first citation", () => {
  expect(
    sourceLicences([
      "https://www.artic.edu/artworks/16568",
      "https://en.wikipedia.org/wiki/Water_Lilies",
      "https://de.wikipedia.org/wiki/Seerosen",
    ]).map(({ name }) => name),
  ).toEqual(["CC BY 4.0", "CC BY-SA 4.0"]);
});
