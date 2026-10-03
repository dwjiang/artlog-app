/** Likes on one visit share the row of the newest like; every other notification keeps a row of its own. */
export function groupNotifications<T extends { kind: string; postId?: string }>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  const likes = new Map<string, T[]>();
  for (const item of items) {
    const postId = item.kind === "visitLike" ? item.postId : undefined;
    const row = postId === undefined ? undefined : likes.get(postId);
    if (row) {
      row.push(item);
      continue;
    }
    const created = [item];
    if (postId !== undefined) likes.set(postId, created);
    rows.push(created);
  }
  return rows;
}

export type NotificationSegment = { text: string; bold?: boolean };
export type NotificationPerson = { name: string; username: string };

export type NotificationSummary =
  | { kind: "friendRequest"; actor: NotificationPerson; accepted: boolean }
  | { kind: "friendAccepted"; actor: NotificationPerson }
  /** `people` leads with the newest liker; `count` is every like the sentence covers. */
  | { kind: "visitLike"; people: readonly NotificationPerson[]; count: number; venue: string }
  | { kind: "visitComment"; actor: NotificationPerson; venue: string };

/** The sentence an inbox row and its push notification share; people's names are the bold segments. */
export function notificationSentence(summary: NotificationSummary): NotificationSegment[] {
  const person = ({ name, username }: NotificationPerson): NotificationSegment[] => [
    { text: name, bold: true },
    { text: ` (@${username})` },
  ];
  switch (summary.kind) {
    case "friendRequest":
      return summary.accepted
        ? [{ text: "You and " }, ...person(summary.actor), { text: " are now friends." }]
        : [...person(summary.actor), { text: " sent you a friend request." }];
    case "friendAccepted":
      return [...person(summary.actor), { text: " accepted your friend request." }];
    case "visitLike": {
      const [first, second] = summary.people;
      const others = summary.count - 1;
      const people =
        others === 0
          ? person(first)
          : others === 1 && second !== undefined
            ? [...person(first), { text: " and " }, ...person(second)]
            : [...person(first), { text: ` and ${others} ${others === 1 ? "other" : "others"}` }];
      return [...people, { text: ` liked your visit to ${summary.venue}.` }];
    }
    case "visitComment":
      return [...person(summary.actor), { text: ` commented on your visit to ${summary.venue}:` }];
  }
}
