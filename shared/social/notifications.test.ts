import { notificationSentence } from "./notifications";

const person = (name: string) => ({ profileId: `${name}-id`, name, username: name.toLowerCase() });

it("links the visit owner a comment mention names, and reads their own visit as theirs", () => {
  expect(
    notificationSentence({ kind: "commentMention", actor: person("Priya"), owner: person("Jonah"), venue: "MoMA" }),
  ).toEqual([
    { text: "Priya", profileId: "Priya-id" },
    { text: " (@priya)" },
    { text: " mentioned you in a comment on " },
    { text: "Jonah", profileId: "Jonah-id" },
    { text: "’s" },
    { text: " visit to MoMA:" },
  ]);
  const own = notificationSentence({
    kind: "commentMention",
    actor: person("Priya"),
    owner: person("Priya"),
    venue: "MoMA",
  });
  expect(own.map((segment) => segment.text).join("")).toBe(
    "Priya (@priya) mentioned you in a comment on their visit to MoMA:",
  );
  expect(own.filter((segment) => segment.profileId)).toEqual([{ text: "Priya", profileId: "Priya-id" }]);
});
