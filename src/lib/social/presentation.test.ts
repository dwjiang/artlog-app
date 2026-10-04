import {
  friendshipActions,
  initials,
  notificationAge,
  peopleSearch,
  suggestionReasonText,
  visitDate,
} from "./presentation";
import type { Relationship } from "./types";

it("formats calendar dates without shifting the visit into another day", () => {
  expect(visitDate("2026-01-01", "en-US")).toBe("January 1, 2026");
  expect(visitDate("2026-01-01", "en-US", "short")).toBe("Jan 1");
  expect(visitDate("2026-02-30", "en-US")).toBe("Date unavailable");
  expect(visitDate("invalid")).toBe("Date unavailable");
});

it("ages notifications in the largest whole unit and switches to the date after a week", () => {
  const now = Date.UTC(2026, 9, 1, 12);
  expect(notificationAge(now - 20_000, now)).toEqual({ short: "now", spoken: "just now" });
  expect(notificationAge(now - 60_000, now)).toEqual({ short: "1m", spoken: "1 minute ago" });
  expect(notificationAge(now - 3 * 3_600_000 - 59_000, now)).toEqual({ short: "3h", spoken: "3 hours ago" });
  expect(notificationAge(now - 6 * 86_400_000, now).short).toBe("6d");
  expect(notificationAge(Date.UTC(2026, 8, 22, 12), now, "en-US").short).toBe("Sep 22");
});

it("uses first and last initials without inventing a photo", () => {
  expect(initials("  Alex River Chen ")).toBe("AC");
  expect(initials("李")).toBe("李");
  expect(initials("")).toBe("?");
});

it("enforces existing search limits before sending a request", () => {
  expect(peopleSearch(" ")).toBeUndefined();
  expect(peopleSearch("A")).toBe("a");
  expect(peopleSearch("a".repeat(201))).toBeUndefined();
  expect(peopleSearch(Array(17).fill("word").join(" "))).toBeUndefined();
  expect(peopleSearch(" Alex  Chen ")).toBe("alex chen");
});

it.each([
  ["none", null, false, ["request"]],
  ["pending", "me", false, ["cancel"]],
  ["pending", "other", false, ["accept", "decline"]],
  ["accepted", "other", false, ["remove"]],
  ["none", null, true, []],
] as const)("offers the allowed actions for %s / %s / blocked %s", (state, requesterId, blocked, actions) => {
  expect(
    friendshipActions(
      {
        state,
        requesterId,
        blocked,
        revision: 2,
        blockRevision: 0,
      } as Relationship,
      "me",
    ),
  ).toEqual(actions);
});

it("explains each suggestion in one line, naming mutual friends by first name", () => {
  const friend = (name: string) => ({
    profileId: name as never,
    name,
    username: name,
    avatar: "vermeer" as const,
    publishedWallCount: 0,
  });
  const mutual = (count: number, ...names: string[]) =>
    suggestionReasonText({ kind: "mutual", count, friends: names.map(friend) });
  expect(mutual(1, "Theo Alvarez")).toBe("Friends with Theo");
  expect(mutual(2, "Theo Alvarez", "Sam Okafor")).toBe("Friends with Theo and Sam");
  expect(mutual(2, "Theo Alvarez")).toBe("Friends with Theo and 1 other");
  expect(mutual(3, "Theo Alvarez", "Sam Okafor")).toBe("Friends with Theo and 2 others");
  expect(
    suggestionReasonText({
      kind: "artwork",
      artwork: {
        itemId: "item" as never,
        artwork: { title: "Water Lilies", artist: "Claude Monet", media: { kind: "placeholder", width: 1, height: 1 } },
      },
    }),
  ).toBe("Also saved Water Lilies");
  expect(suggestionReasonText({ kind: "museum", venueName: "The Art Institute of Chicago" })).toBe(
    "Also visited The Art Institute of Chicago",
  );
  expect(suggestionReasonText({ kind: "liked", venueName: "The Met" })).toBe("Liked your visit to The Met");
});
