import { v } from 'convex/values';
export const leaderboardMetric = v.union(v.literal('visits'), v.literal('contributions'));
export const leaderboardVisibility = v.union(v.literal('off'), v.literal('friends'), v.literal('global'));
export function rankScores<T extends { score: number; name: string; username: string }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.username.localeCompare(b.username));
  let rank = 0;
  return sorted.map((row, index) => { if (index === 0 || row.score !== sorted[index - 1].score) rank = index + 1; return { ...row, rank }; });
}
