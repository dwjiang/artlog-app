import robotsParser from "robots-parser";

type Robot = ReturnType<typeof robotsParser>;
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Fetched = { status: number; headers: Headers; body: Uint8Array };
export type Followed =
  | { url: URL; response: Fetched }
  | { reason: "robots" | "redirect_elsewhere" | "too_many_redirects" };

const ROBOT = "artlog-bot";
const HOST_GAP_MS = 1000;
const TIMEOUT_MS = 15_000;
const MAX_ROBOTS_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/**
 * Fetches as artlog-bot under RFC 9309: a robots.txt that is missing (4xx) or served as an HTML page has no rules; one
 * that cannot be read (429, 5xx, network) blocks the site. Requests to a host are at least a second apart, longer when
 * its robots.txt asks; sites asking for more than `maxCrawlDelayS` between requests are skipped rather than waited on.
 */
export function politeClient({
  userAgent,
  fetchImpl = fetch,
  sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  now = () => Date.now(),
  maxCrawlDelayS = 120,
  waitForHost,
}: {
  userAgent: string;
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxCrawlDelayS?: number;
  /** Resolves when a request may start, coordinating host spacing across clients. */
  waitForHost?: (host: string, gapMs: number) => Promise<void>;
}) {
  const robots = new Map<string, Promise<Robot | undefined>>();
  const nextAt = new Map<string, number>();

  async function get(url: URL, accept: string, maxBytes: number, gapMs = HOST_GAP_MS): Promise<Fetched> {
    if (waitForHost) {
      await waitForHost(url.host, gapMs);
    } else {
      const at = Math.max(nextAt.get(url.host) ?? 0, now());
      nextAt.set(url.host, at + gapMs);
      if (at > now()) await sleep(at - now());
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(url.href, {
        redirect: "manual",
        headers: { "User-Agent": userAgent, Accept: accept },
        signal: controller.signal,
      });
      const declared = Number(response.headers.get("content-length"));
      if (declared > maxBytes) throw new Error("Response too large");
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength > maxBytes) throw new Error("Response too large");
      return { status: response.status, headers: response.headers, body };
    } finally {
      clearTimeout(timer);
    }
  }

  async function readRobots(origin: URL): Promise<Robot | undefined> {
    const url = new URL("/robots.txt", origin);
    try {
      let current = url;
      let response = await get(url, "text/plain", MAX_ROBOTS_BYTES);
      for (let hop = 0; hop < MAX_REDIRECTS && response.status >= 300 && response.status < 400; hop++) {
        const location = response.headers.get("location");
        if (!location) break;
        current = new URL(location, current);
        response = await get(current, "text/plain", MAX_ROBOTS_BYTES);
      }
      if (response.status >= 200 && response.status < 300) {
        const html = response.headers.get("content-type")?.includes("text/html");
        return robotsParser(url.href, html ? "" : new TextDecoder().decode(response.body));
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return robotsParser(url.href, "");
    } catch {
      // Unreachable: the whole site counts as disallowed.
    }
    return undefined;
  }

  /** The pause a host asks for, or undefined when artlog-bot may not fetch `url` at all. */
  async function permission(url: URL): Promise<number | undefined> {
    if (!robots.has(url.origin)) robots.set(url.origin, readRobots(url));
    const rules = await robots.get(url.origin)!;
    if (!rules || rules.isAllowed(url.href, ROBOT) === false) return undefined;
    const delay = rules.getCrawlDelay(ROBOT) ?? 0;
    return delay > maxCrawlDelayS ? undefined : Math.max(HOST_GAP_MS, delay * 1000);
  }

  /** Follows redirects that `keep` accepts, checking robots.txt before every hop. */
  async function follow(start: URL, accept: string, maxBytes: number, keep: (url: URL) => boolean): Promise<Followed> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const gapMs = await permission(url);
      if (gapMs === undefined) return { reason: "robots" };
      const response = await get(url, accept, maxBytes, gapMs);
      if (response.status < 300 || response.status >= 400) return { url, response };
      const location = response.headers.get("location");
      const next = location ? new URL(location, url) : undefined;
      if (!next || next.protocol !== "https:" || !keep(next)) return { reason: "redirect_elsewhere" };
      url = next;
    }
    return { reason: "too_many_redirects" };
  }

  return { follow };
}

const site = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");

export const sameSite = (url: URL, home: URL) => site(url) === site(home) || site(url).endsWith(`.${site(home)}`);
