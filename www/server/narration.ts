import type { DemoNarration } from "../../shared/capture/judges-demo.ts";

/**
 * What the page plays: a narration the phone streams (HLS) or has cached (MP3), both served from this origin. `src` is
 * relative to the page's API root.
 */
export type PageNarration = { src: string; live: boolean; playing: boolean; position: number; rate: number } | null;

// The app's narration cache, as `src/lib/audio/narration-renderer.ts` names its files.
const CACHED = /^Library\/Caches\/narration\/([\w-]+)\.mp3$/;

/**
 * The app's narration report as the page plays it. The app reports only changes, so a playing report's position is
 * moved on by its age.
 */
export function pageNarration(
  state: DemoNarration | null,
  sessionId: string,
  site: string,
  now: number,
): PageNarration {
  const source = state?.source ? pageSource(state.source, sessionId, site) : undefined;
  if (!state || !source) return null;
  const age = Math.max(now - state.at, 0) / 1000;
  const position = state.position + (state.playing ? age * state.rate : 0);
  return { ...source, playing: state.playing, position, rate: state.rate };
}

function pageSource(source: string, sessionId: string, site: string) {
  const cached = CACHED.exec(source);
  if (cached) return { src: `sessions/${sessionId}/narration/${cached[1]}.mp3`, live: false };
  const url = URL.canParse(source) ? new URL(source) : undefined;
  if (url?.origin === new URL(site).origin && url.pathname === "/narration-playlist") {
    return { src: `narration/playlist${url.search}`, live: true };
  }
}

/** The app's path to a cached narration, from the render id in its page URL. */
export const cachedNarrationPath = (renderId: string) => `Library/Caches/narration/${renderId}.mp3`;

/**
 * Fetches a narration playlist or segment from the backend for the page. The backend sends no CORS headers, and a
 * segment redirects to signed storage, so the page plays both through this origin; only these two paths are served.
 */
export async function proxyNarration(
  kind: "playlist" | "file",
  search: string,
  site: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const upstream = await fetchImpl(`${site}/${kind === "playlist" ? "narration-playlist" : "file"}${search}`);
  if (!upstream.ok) return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
  if (kind === "file") {
    return new Response(upstream.body, {
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg", "Cache-Control": "private" },
    });
  }
  const files = `${site}/file?`;
  const playlist = (await upstream.text())
    .split("\n")
    // Relative, so segments resolve next to the playlist wherever the page's API is mounted.
    .map((line) => (line.startsWith(files) ? `file?${line.slice(files.length)}` : line))
    .join("\n");
  return new Response(playlist, {
    headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
  });
}
