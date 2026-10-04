import { isAllowedIdentity, isOffensive, isSevere } from "./offensive-text";

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

it("allows artwork titles and subjects that contain flagged words", () => {
  for (const text of [
    "Titian, The Rape of Europa",
    "Giambologna's Rape of the Sabine Women",
    "The Whore of Babylon",
    "Serrano, Piss Christ",
    "The ox and the ass at the manger",
    "Balaam’s Ass",
    "Rembrandt, Balaam and the Ass",
  ]) {
    expect({ text, offensive: isOffensive(text) }).toEqual({ text, offensive: false });
  }
  for (const text of ["I will rape you", "you whore", "piss off", "kiss my ass"]) {
    expect({ text, offensive: isOffensive(text) }).toEqual({ text, offensive: true });
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

it("does not exempt abusive text just because it starts like an artwork title", () => {
  for (const text of [
    "Rape of Children",
    "rape_of_children",
    "I support rape of children",
    "The Rape of Europa does not excuse rape of children",
  ]) {
    expect({ text, offensive: isOffensive(text) }).toEqual({ text, offensive: true });
    expect(isAllowedIdentity(text)).toBe(false);
  }
});

it("lets typed artwork titles use crude words but never slurs or the strongest swearing", () => {
  for (const title of [
    "Bitch",
    "Piss Flowers",
    "The Rape",
    "Penis Study",
    "My shitty sketch",
    "Whore",
    "Dick Van Dyke",
    "Fu Baoshi, Landscape",
  ]) {
    expect({ title, severe: isSevere(title) }).toEqual({ title, severe: false });
  }
  for (const title of [
    "Untitled (Fuck)",
    "Pay Attention Motherfuckers",
    "fuuuck",
    "n1gger",
    "faggot",
    "wetback",
    "Spic",
    "cunt",
    "cocksucker",
  ]) {
    expect({ title, severe: isSevere(title) }).toEqual({ title, severe: true });
  }
});

it("keeps names and usernames from posing as Artlog staff", () => {
  for (const identity of ["Artlog", "artlog_support", "The Artlog Team", "admin", "Support", "moderator_2", "staff"]) {
    expect({ identity, allowed: isAllowedIdentity(identity) }).toEqual({ identity, allowed: false });
  }
  expect(isAllowedIdentity("support_team_fan")).toBe(true);
  expect(isOffensive("I love the Artlog app")).toBe(false);
});
