import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { imageSize } from "image-size";

import { politeClient as sharedPoliteClient, sameSite, type Fetch } from "../../shared/exhibitions/polite-client.ts";
import { prepareOutput } from "./import.mts";

export type ImageOutcome = { imageUrl: string } | { reason: string };
type Show = Record<string, unknown> & { sourceUrl: string; title: string; museumId?: string };

const usage =
  "Usage: node --experimental-strip-types scripts/exhibitions/images.mts --input <verified JSON> --museums <directory JSON> --output <JSON in .context>";
const contact = process.env.CRAWLER_CONTACT;
export const USER_AGENT = `artlog-bot/0.1 (+https://github.com/dwjiang/artlog-app${contact ? `; mailto:${contact}` : ""})`;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
// Share images are usually about 1200×630; anything smaller than this is a logo or an icon.
const MIN_WIDTH = 400;
const MIN_HEIGHT = 200;
// Open Graph first, then Twitter cards: the image a page offers for link previews.
const PREVIEW_KEYS = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];
const IMAGE_REMOVAL_REASONS = new Set([
  "no_preview_image",
  "site_default",
  "shared_by_shows",
  "http_404",
  "http_410",
  "image_http_404",
  "image_http_410",
  "image_not_raster",
  "image_too_small",
  "museum_opted_out",
]);

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

function decode(value: string): string {
  return value.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(/([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    result.set(match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4]));
  }
  return result;
}

/** The page's link-preview image as an absolute HTTPS URL; plain HTTP is upgraded because iOS refuses it. */
export function previewImage(html: string, pageUrl: string): string | undefined {
  const found = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const meta = attributes(tag);
    const key = (meta.get("property") ?? meta.get("name"))?.toLowerCase();
    const content = meta.get("content")?.trim();
    if (key && content && PREVIEW_KEYS.includes(key) && !found.has(key)) found.set(key, content);
  }
  for (const key of PREVIEW_KEYS) {
    const value = found.get(key);
    if (!value) continue;
    try {
      const url = new URL(value, pageUrl);
      if (url.protocol === "http:") url.protocol = "https:";
      if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch {
      // A malformed value falls through to the next preview key.
    }
  }
  return undefined;
}

/** Finds show preview images through the shared polite client; the parameters exist so tests can fake the network. */
export function politeClient(
  fetchImpl: Fetch = fetch,
  sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  now = () => Date.now(),
) {
  const { follow } = sharedPoliteClient({ userAgent: USER_AGENT, fetchImpl, sleep, now });

  async function checkImage(imageUrl: string): Promise<ImageOutcome> {
    const fetched = await follow(new URL(imageUrl), "image/*", MAX_IMAGE_BYTES, () => true);
    if ("reason" in fetched) return { reason: `image_${fetched.reason}` };
    const { response } = fetched;
    const type = response.headers.get("content-type") ?? "";
    if (response.status !== 200) return { reason: `image_http_${response.status}` };
    if (!type.startsWith("image/") || type.includes("svg")) return { reason: "image_not_raster" };
    let size;
    try {
      size = imageSize(response.body);
    } catch {
      return { reason: "image_unreadable" };
    }
    if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) return { reason: "image_too_small" };
    return { imageUrl };
  }

  async function pagePreview(pageUrl: string): Promise<ImageOutcome> {
    try {
      const start = new URL(pageUrl);
      const fetched = await follow(start, "text/html", MAX_PAGE_BYTES, (url) => sameSite(url, start));
      if ("reason" in fetched) return fetched;
      const { url, response } = fetched;
      if (response.status !== 200) return { reason: `http_${response.status}` };
      if (!response.headers.get("content-type")?.includes("html")) return { reason: "not_html" };
      const imageUrl = previewImage(new TextDecoder().decode(response.body), url.href);
      return imageUrl ? { imageUrl } : { reason: "no_preview_image" };
    } catch {
      return { reason: "fetch_failed" };
    }
  }

  /**
   * A show page's preview image once it is confirmed to load as a large enough picture. The museum home page's own
   * preview image (often its logo) is the site's default, so a show page offering it has no picture of its own.
   */
  async function findImage(sourceUrl: string, website: string): Promise<ImageOutcome> {
    const preview = await pagePreview(sourceUrl);
    if ("reason" in preview) return preview;
    const home = await pagePreview(new URL("/", website).href);
    if ("imageUrl" in home && home.imageUrl === preview.imageUrl) return { reason: "site_default" };
    try {
      return await checkImage(preview.imageUrl);
    } catch {
      return { reason: "image_fetch_failed" };
    }
  }

  return { findImage };
}

/** Sets each show's image; one shared by several shows is a site-wide default, not the show's own picture. */
export function withImages<T extends { exhibitions: Show[] }>(
  input: T,
  outcomes: ImageOutcome[],
  imageCheckedAt = Date.now(),
) {
  const uses = new Map<string, number>();
  for (const outcome of outcomes) {
    if ("imageUrl" in outcome) uses.set(outcome.imageUrl, (uses.get(outcome.imageUrl) ?? 0) + 1);
  }
  const results = outcomes.map((outcome) =>
    "imageUrl" in outcome && uses.get(outcome.imageUrl)! > 1 ? { reason: "shared_by_shows" } : outcome,
  );
  const exhibitions = input.exhibitions.map((show, index) => {
    const result = results[index];
    if ("imageUrl" in result) return { ...show, imageUrl: result.imageUrl, imageCheckedAt };
    // An unavailable check says nothing about the previously verified image or its revision.
    if (!IMAGE_REMOVAL_REASONS.has(result.reason)) return show;
    const { imageUrl: _previous, ...withoutImage } = show;
    return { ...withoutImage, imageCheckedAt };
  });
  const imageReport = input.exhibitions.map((show, index) => ({
    title: show.title,
    sourceUrl: show.sourceUrl,
    ...results[index],
  }));
  return { ...input, exhibitions, imageReport };
}

function options(args: string[]) {
  const allowed = ["--input", "--museums", "--output"];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const [key, value] = [args[index], args[index + 1]];
    if (!allowed.includes(key) || !value || value.startsWith("--") || values.has(key)) throw new Error(usage);
    values.set(key, value);
  }
  if (values.size !== allowed.length) throw new Error(usage);
  const [input, museums, output] = allowed.map((key) => resolve(values.get(key)!));
  return { input, museums, output };
}

/**
 * Websites of the museums that may be read, by museum ID: directory rows with an explicit `optOut: false`, as the
 * import requires.
 */
export function readableMuseums(directory: unknown): Map<string, string> {
  if (!Array.isArray(directory)) throw new Error("Museum directory must be an array");
  return new Map(
    directory.flatMap((row: { _id?: unknown; optOut?: unknown; website?: unknown }) =>
      typeof row._id === "string" && row.optOut === false && typeof row.website === "string"
        ? [[row._id, row.website] as const]
        : [],
    ),
  );
}

async function main() {
  const config = options(process.argv.slice(2));
  await prepareOutput(config.output);
  const input = JSON.parse(await readFile(config.input, "utf8")) as { exhibitions: Show[] };
  if (!Array.isArray(input.exhibitions)) throw new Error("Input has no exhibitions");
  const readable = readableMuseums(JSON.parse(await readFile(config.museums, "utf8")));
  const { findImage } = politeClient();
  const outcomes: ImageOutcome[] = [];
  for (const [index, show] of input.exhibitions.entries()) {
    const website = show.museumId === undefined ? undefined : readable.get(show.museumId);
    const outcome = website ? await findImage(show.sourceUrl, website) : { reason: "museum_opted_out" };
    outcomes.push(outcome);
    process.stdout.write(
      `${index + 1}/${input.exhibitions.length} ${"reason" in outcome ? outcome.reason : "image"}\n`,
    );
  }
  const result = withImages(input, outcomes);
  await writeFile(config.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  const found = result.exhibitions.filter((show) => "imageUrl" in show).length;
  process.stdout.write(`Preview images for ${found} of ${result.exhibitions.length} shows -> ${config.output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Image lookup failed"}\n`);
    process.exitCode = 1;
  });
}
