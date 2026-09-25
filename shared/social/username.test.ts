import { isUsername, usernameCandidates } from "./username";

it("accepts only lowercase letters, digits and underscores", () => {
  expect(["alex", "alex_chen", "_alex_", "a1b2c3"].every(isUsername)).toBe(true);
  expect(["alex-chen", "Alex", "alex.chen", "alex chen", "al", "a".repeat(31)].some(isUsername)).toBe(false);
});

it("turns a display name into readable, valid usernames with numbered fallbacks", () => {
  expect(usernameCandidates("  Élodie  Martin-Duval ", 3)).toEqual([
    "elodie_martin_duval",
    "elodie_martin_duval_2",
    "elodie_martin_duval_3",
  ]);
  expect(usernameCandidates("O’Keeffe", 2)).toEqual(["o_keeffe", "o_keeffe_2"]);
});

it("keeps numbered fallbacks within the length limit and skips names that are too short", () => {
  const candidates = usernameCandidates("Wolfgang Amadeus Mozart Jr Salzburg");
  expect(candidates).toHaveLength(20);
  expect(candidates.every(isUsername)).toBe(true);
  expect(candidates[0]).toBe("wolfgang_amadeus_mozart_jr");
  expect(candidates.at(-1)).toBe("wolfgang_amadeus_mozart_jr_20");
  expect(usernameCandidates("Al", 3)).toEqual(["al_2", "al_3"]);
});

it("offers nothing when a name has no letters or digits it can use", () => {
  expect(usernameCandidates("张伟")).toEqual([]);
  expect(usernameCandidates(" — ")).toEqual([]);
});

it("offers nothing for names that are offensive or pose as staff", () => {
  expect(usernameCandidates("Fuck You")).toEqual([]);
  expect(usernameCandidates("Support")).toEqual([]);
});
