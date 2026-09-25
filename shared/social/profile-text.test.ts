import { isAllowedIdentity, isOffensive } from "./profile-text";

it("allows real names and their usernames that contain words the stock profanity list flags", () => {
  for (const name of [
    "Dick Van Dyke",
    "dick_van_dyke",
    "E. E. Cummings",
    "Nicholas Cock",
    "John Lee Hooker",
    "Anal Singh",
    "Analise",
    "Ashit Dikshit",
    "Kshitij",
    "Ana Negro",
    "Semenov",
    "Wankel",
    "Wańkowicz",
    "Slutsky",
    "Emily Dickinson",
    "Scunthorpe",
    "Sussex",
    "Titian",
    "Wei Fu",
    "fu_wei",
    "Angga Pratama",
    "Kenji Fukuda",
    "fukuyama",
    "Fukazawa",
    "Ngọc Bích",
    "Fagan",
    "Fagundes",
    "Pornchai",
    "Wankhede",
    "Shittu",
    "Stuart Logan",
    "smart_logic",
  ]) {
    expect({ name, allowed: isAllowedIdentity(name) }).toEqual({ name, allowed: true });
  }
});

it("leaves artists and places that contain flagged fragments alone in bios", () => {
  for (const text of [
    "Camille Pissarro",
    "Shitao",
    "Fu Baoshi",
    "Masahisa Fukase",
    "Karl Friedrich Schinkel",
    "Nusa Tenggara",
  ]) {
    expect({ text, offensive: isOffensive(text) }).toEqual({ text, offensive: false });
  }
});

it("rejects profanity and slurs, including leetspeak, joined words and underscores", () => {
  for (const text of [
    "fuck_you",
    "fuckyou",
    "fuk_you",
    "fukyou",
    "sh1t",
    "motherfucker",
    "dickhead",
    "cocksucker",
    "n1gger",
    "nigga",
    "faggot",
    "wetback",
    "raghead",
    "Spic",
    "cunt",
    "slut",
    "wanker",
  ]) {
    expect({ text, offensive: isOffensive(text) }).toEqual({ text, offensive: true });
    expect(isAllowedIdentity(text)).toBe(false);
  }
});

it("keeps names and usernames from posing as Artlog staff", () => {
  for (const identity of ["Artlog", "artlog_support", "The Artlog Team", "admin", "Support", "moderator_2", "staff"]) {
    expect({ identity, allowed: isAllowedIdentity(identity) }).toEqual({ identity, allowed: false });
  }
  expect(isAllowedIdentity("support_team_fan")).toBe(true);
  expect(isOffensive("I love the Artlog app")).toBe(false);
});
