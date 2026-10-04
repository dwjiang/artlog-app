import { filterWorks, linkedVisitSearchTerms } from "./search";

const works = [
  {
    localId: "lilies",
    title: "Water Lilies",
    artist: "Claude Monet",
    institution: "Musée d'Orsay",
  },
  {
    localId: "cotton",
    title: "100% Cotton",
    artist: "Anon",
    institution: "de Young",
  },
  { localId: "bare", title: "Untitled", artist: "Monet", institution: null },
];

it.each([
  ["", ["lilies", "cotton", "bare"]],
  ["   ", ["lilies", "cotton", "bare"]],
  ["MONET", ["lilies", "bare"]],
  ["water", ["lilies"]],
  ["orsay", ["lilies"]],
  ["100%", ["cotton"]],
  ["young", ["cotton"]],
  ["nothing here", []],
])("filters by title, artist or institution for %p", (query, expected) => {
  expect(filterWorks(works, query).map((work) => work.localId)).toEqual(expected);
});

it("finds an artwork at any linked museum and excludes removed or foreign encounters", () => {
  const visits = [
    { owner: "me", localId: "first", venueId: "a", venueName: "Rijksmuseum" },
    {
      owner: "me",
      localId: "second",
      venueId: "b",
      venueName: "Musée d’Orsay",
    },
    {
      owner: "other",
      localId: "foreign",
      venueId: "c",
      venueName: "Private Museum",
    },
  ];
  const encounters = [
    {
      owner: "me",
      savedLocalId: "art",
      visitLocalId: "first",
      deletedAt: null,
    },
    {
      owner: "me",
      savedLocalId: "art",
      visitLocalId: "second",
      deletedAt: null,
    },
    {
      owner: "other",
      savedLocalId: "art",
      visitLocalId: "foreign",
      deletedAt: null,
    },
  ];
  const metadata = new Map([
    ["a", { city: "Amsterdam" }],
    ["b", { city: "Paris" }],
  ]);
  const withVisits = () => [
    {
      ...works[2],
      visitSearchTerms: linkedVisitSearchTerms("me", encounters, visits, metadata).get("art"),
    },
  ];
  for (const query of ["rijksmuseum", "orsay", "paris", "amsterdam"]) {
    expect(filterWorks(withVisits(), query)).toHaveLength(1);
  }
  expect(filterWorks(withVisits(), "Private Museum")).toEqual([]);
  const unlinked = encounters.map((encounter) =>
    encounter.visitLocalId === "second" ? { ...encounter, deletedAt: 1 } : encounter,
  );
  expect(linkedVisitSearchTerms("me", unlinked, visits, metadata).get("art")).toEqual(["Rijksmuseum", "Amsterdam"]);
});

it("normalizes accents and whitespace and searches dates, venue names and cities", () => {
  const works = [
    {
      title: "Nymphéas",
      artist: "Claude Monet",
      institution: null,
      date: "1916",
      venueName: "Musée   d’Orsay",
      city: "París",
    },
  ];
  for (const query of ["nympheas", "  MUSEE  ", "1916", "paris", "Claude   Monet"]) {
    expect(filterWorks(works, query)).toEqual(works);
  }
  expect(filterWorks(works, "m")).toEqual(works);
  expect(filterWorks(works, "z")).toEqual([]);
  expect(filterWorks(works, "x".repeat(101))).toEqual([]);
});
