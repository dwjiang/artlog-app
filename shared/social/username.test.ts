import { isUsername, usernameCandidates } from "./username";

it("turns a display name into readable, valid usernames with numbered fallbacks", () => {
  expect(usernameCandidates("  Élodie  Martin-Duval ", 3)).toEqual([
    "elodie-martin-duval",
    "elodie-martin-duval-2",
    "elodie-martin-duval-3",
  ]);
  expect(usernameCandidates("O’Keeffe", 2)).toEqual(["o-keeffe", "o-keeffe-2"]);
});

it("keeps numbered fallbacks within the length limit and skips names that are too short", () => {
  const candidates = usernameCandidates("Wolfgang Amadeus Mozart Jr Salzburg");
  expect(candidates).toHaveLength(20);
  expect(candidates.every(isUsername)).toBe(true);
  expect(candidates[0]).toBe("wolfgang-amadeus-mozart-jr");
  expect(candidates.at(-1)).toBe("wolfgang-amadeus-mozart-jr-20");
  expect(usernameCandidates("Al", 3)).toEqual(["al-2", "al-3"]);
});

it("offers nothing when a name has no letters or digits it can use", () => {
  expect(usernameCandidates("张伟")).toEqual([]);
  expect(usernameCandidates(" — ")).toEqual([]);
});
