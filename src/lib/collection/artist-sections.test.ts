import { artistSections } from "./artist-sections";
it("groups accented artists under their letter and puts unnamed artists at the end without mutating input", () => {
  const works = [
    { localId: "1", artist: "Édouard Manet", title: "Later", date: "1870" },
    { localId: "2", artist: "Claude Monet", title: "Lilies", date: "1916" },
    { localId: "3", artist: "", title: "Untitled", date: null },
    { localId: "4", artist: "Édouard Manet", title: "Earlier", date: "1860" },
  ];
  expect(artistSections(works).map((section) => [section.title, section.data.map((work) => work.localId)])).toEqual([
    ["C", ["2"]],
    ["E", ["4", "1"]],
    ["#", ["3"]],
  ]);
  expect(works.map((work) => work.localId)).toEqual(["1", "2", "3", "4"]);
});
