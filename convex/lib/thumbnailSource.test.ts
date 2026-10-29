import { expect, it } from "vitest";

import { thumbnailShowsReference } from "./thumbnailSource";

it.each([
  ["https://museum.example/work.jpg", "https://museum.example/work.jpg", true],
  [
    "https://commons.wikimedia.org/wiki/Special:FilePath/Work.jpg?width=330",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Work.jpg",
    true,
  ],
  [
    "https://www.artic.edu/iiif/2/id/full/843,/0/default.jpg",
    "https://www.artic.edu/iiif/2/id/full/1686,/0/default.jpg",
    true,
  ],
  [
    "https://kokoelma.kansallisgalleria.fi/media-assets/1/jpg/500/9012.jpg",
    "https://kokoelma.kansallisgalleria.fi/media-assets/1/jpg/1000/9012.jpg",
    true,
  ],
  ["https://museum.example/alias.jpg", "https://museum.example/work.jpg", false],
  ["https://museum.example/work.jpg?crop=square", "https://museum.example/work.jpg", false],
  [
    "https://commons.wikimedia.org/wiki/Special:FilePath/Other.jpg?width=330",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Work.jpg",
    false,
  ],
  [
    "https://www.artic.edu/iiif/2/id/0,0,100,100/843,/0/default.jpg",
    "https://www.artic.edu/iiif/2/id/full/1686,/0/default.jpg",
    false,
  ],
])("checks thumbnail %s against reference %s", (thumbnail, reference, expected) => {
  expect(thumbnailShowsReference(thumbnail, reference)).toBe(expected);
});
