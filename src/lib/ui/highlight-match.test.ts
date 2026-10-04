import { highlightMatch } from "./highlight-match";

const marked = (text: string, query: string) =>
  highlightMatch(text, query)
    .map((part) => (part.match ? `[${part.text}]` : part.text))
    .join("");

it("marks the typed prefix of every word that starts with a query word", () => {
  expect(marked("MoMA · Museum of Modern Art", "mo")).toBe("[Mo]MA · Museum of [Mo]dern Art");
  expect(marked("The Morgan Library & Museum", "Mor")).toBe("The [Mor]gan Library & Museum");
  expect(marked("Mo Reyes", "m")).toBe("[M]o Reyes");
});

it("matches each query word on its own, like the search does", () => {
  expect(marked("The Metropolitan Museum of Art", "met art")).toBe("The [Met]ropolitan Museum of [Art]");
  expect(marked("Musée d’Orsay", "musee or")).toBe("[Musée] d’[Or]say");
});

it("keeps accents and combining marks with the letters they decorate", () => {
  expect(marked("Élodie", "e")).toBe("[É]lodie");
  expect(marked("Pérez", "pe")).toBe("[Pé]rez");
});

it("leaves text unmarked for an empty query or a word in the middle", () => {
  expect(highlightMatch("Monet", "  ")).toEqual([{ text: "Monet", match: false }]);
  expect(marked("Marmottan Monet", "net")).toBe("Marmottan Monet");
});
