import { sourceLicence } from "./source-licence";

it("names the licence of Wikipedia articles in any language", () => {
  for (const url of ["https://en.wikipedia.org/wiki/Water_Lilies", "https://fr.m.wikipedia.org/wiki/Nymph%C3%A9as"]) {
    expect(sourceLicence(url)).toEqual({
      name: "CC BY-SA 4.0",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    });
  }
});

it("names the licence of the Art Institute of Chicago's artwork descriptions only", () => {
  expect(sourceLicence("https://www.artic.edu/artworks/16568/water-lilies")?.name).toBe("CC BY 4.0");
  expect(sourceLicence("https://www.artic.edu/exhibitions/9516/monet")).toBeUndefined();
});

it("names no licence for other pages or unreadable URLs", () => {
  expect(sourceLicence("https://www.metmuseum.org/art/collection/search/437112")).toBeUndefined();
  expect(sourceLicence("https://notwikipedia.org/wiki/Monet")).toBeUndefined();
  expect(sourceLicence("not a url")).toBeUndefined();
});
