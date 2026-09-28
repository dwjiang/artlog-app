import { expect, it } from "vitest";

import { trimSources } from "./docentSources";

const source = (url: string, score: number, text: string) => ({ url, label: url, score, text });
const quoted = "Van Gogh painted this wheat field with cypresses in late June 1889 while at the asylum in Saint-Rémy.";
const remark = "Critics admired it when it was first shown in Paris, and the museum bought it a century later.";

it("keeps a repeated passage only in the best-scored source and leaves short lines everywhere", () => {
  const owner = source("https://museum.example/work", 1, `Title\n${quoted}\nBought in 1993 with a gift.`);
  const article = source("https://en.wikipedia.org/wiki/Work", 0.7, `Title\n“${quoted}”\n${remark}`);
  expect(trimSources([owner, article])).toEqual([owner, { ...article, text: `Title\n${remark}` }]);
});

it("drops a source left with nothing of its own", () => {
  const owner = source("https://museum.example/work", 1, quoted);
  expect(trimSources([owner, source("https://mirror.example/work", 0.7, quoted)])).toEqual([owner]);
});

it("stops the text sent at the budget, best sources first", () => {
  const long = (letter: string) => letter.repeat(30_000);
  const trimmed = trimSources([source("a", 1, long("a")), source("b", 0.9, long("b")), source("c", 0.8, long("c"))]);
  expect(trimmed.map(({ url, text }) => [url, text.length])).toEqual([
    ["a", 30_000],
    ["b", 10_000],
  ]);
});
