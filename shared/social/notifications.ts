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
