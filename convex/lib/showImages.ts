import { imageSize } from "image-size";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

import { normalizeEvidence } from "../../shared/exhibitions/acceptance";
import { sameSite, type politeClient } from "../../shared/exhibitions/polite-client";
import { contentRegion, documentTitle, listingLinks, showPage, showPages } from "./exhibitionListings";
import { metaTags, tagAttributes } from "./pageExtract";

type Follow = ReturnType<typeof politeClient>["follow"];

const HTML = "text/html, application/xhtml+xml;q=0.9";
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
// Several museums are looked up at once in one action's memory; share images are far smaller.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Share images are usually about 1200×630; anything smaller than this is a logo or an icon.
const MIN_WIDTH = 400;
const MIN_HEIGHT = 200;
// Open Graph first, then Twitter cards: the image a page offers for link previews.
const PREVIEW_KEYS = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];
// Lazy-loading pages keep a placeholder in `src` and the picture in a data attribute.
const IMAGE_SOURCES = ["src", "data-src", "data-lazy-src", "data-original"];
const PAGE_CHROME = /<(nav|footer)\b[\s\S]*?<\/\1>/gi;

/** A show's own picture, `"none"` when it has none we may use, or `"unavailable"` when a later lookup may find one. */
export type ShowImage = { imageUrl: string } | "none" | "unavailable";

export type MuseumShows = {
  website: string;
  /** The museum's validated exhibition listings. */
  listingUrls: string[];
  /** Current shows already looked up, whose pictures a due show must not repeat. */
  checked: { sourceUrl: string; imageUrl?: string }[];
  due: { title: string; sourceUrl: string }[];
};

type Page = { url: string; html: string } | "none" | "unavailable";
/** A link to a show's own page; one found near the title rather than on it is a `card` link. */
type ShowLink = { url: string; card: boolean };
type SharedPage = { image?: string; firstImage?: string; showLinks: Map<string, ShowLink> } | "none" | "unavailable";

/** The link as HTTPS without credentials, since iOS refuses plain HTTP images. */
function httpsUrl(value: string, base?: string): URL | undefined {
  try {
    const url = new URL(value, base);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The page's link-preview image as an absolute HTTPS URL. */
export function previewImage(html: string, pageUrl: string): string | undefined {
  const meta = metaTags(html);
  for (const key of PREVIEW_KEYS) {
    const value = meta.get(key);
    const url = value === undefined ? undefined : httpsUrl(value, pageUrl);
    if (url) return url.href;
  }
  return undefined;
}

/** The first picture in the page's content that is neither a vector nor declared smaller than a show picture. */
function contentImage(html: string, pageUrl: string): string | undefined {
  for (const [tag] of contentRegion(html)
    .replace(PAGE_CHROME, " ")
    .matchAll(/<img\b[^>]*>/gi)) {
    const attrs = tagAttributes(tag);
    if (Number(attrs.get("width")) < MIN_WIDTH || Number(attrs.get("height")) < MIN_HEIGHT) continue;
    const source = IMAGE_SOURCES.map((key) => attrs.get(key)).find((value) => value && !value.startsWith("data:"));
    const url = source === undefined ? undefined : httpsUrl(source, pageUrl);
    if (url && !/\.svg$/i.test(url.pathname)) return url.href;
  }
  return undefined;
}

/**
 * For each title no link names, the one page the nearest block around the title links to, such as a card whose image
 * and button lead to the show. A block linking to several pages is a list rather than one show's card.
 */
function cardLinks(html: string, pageUrl: string, titles: string[], keep: (url: URL) => boolean) {
  const keys = titles.flatMap((title) => {
    const key = normalizeEvidence(title);
    return key ? [[title, key] as const] : [];
  });
  const holders = new Map<string, DefaultTreeAdapterTypes.Element>();
  // Children are visited first, so each title is held by the innermost element whose text contains it.
  function text(node: DefaultTreeAdapterTypes.Node): string {
    if (node.nodeName === "#text") return (node as DefaultTreeAdapterTypes.TextNode).value;
    if (!("childNodes" in node)) return "";
    const value = node.childNodes.map(text).join("");
    if ("tagName" in node && holders.size < keys.length) {
      const normalized = normalizeEvidence(value);
      for (const [title, key] of keys) {
        if (!holders.has(title) && normalized.includes(key)) holders.set(title, node);
      }
    }
    return value;
  }
  function links(node: DefaultTreeAdapterTypes.Node): string[] {
    if (!("childNodes" in node)) return [];
    const href = "tagName" in node && node.tagName === "a" ? node.attrs.find(({ name }) => name === "href") : undefined;
    const own = href ? httpsUrl(href.value, pageUrl) : undefined;
    if (own) own.hash = "";
    return [...(own && keep(own) ? [own.href] : []), ...node.childNodes.flatMap(links)];
  }
  if (keys.length > 0) text(parseFragment(contentRegion(html)));
  const cards = new Map<string, string>();
  for (const [title, holder] of holders) {
    let node: DefaultTreeAdapterTypes.ParentNode | null = holder;
    for (; node && "tagName" in node; node = node.parentNode) {
      const urls = new Set(links(node));
      if (urls.size === 0) continue;
      if (urls.size === 1) cards.set(title, [...urls][0]);
      break;
    }
  }
  return cards;
}

const words = (text: string) =>
  normalizeEvidence(text)
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Whether the page's title or main heading names the show. */
function namesShow(html: string, title: string): boolean {
  const key = words(title);
  return (
    !!key && [documentTitle(html), showPage(html).singleShow?.heading ?? ""].some((name) => words(name).includes(key))
  );
}

// Refusals and missing pages are answers; rate limits, server errors and network failures may pass.
const retryable = (status: number) => status === 429 || status >= 500;

async function readPage(follow: Follow, url: URL): Promise<Page> {
  try {
    const followed = await follow(url, HTML, MAX_PAGE_BYTES, (next) => sameSite(next, url));
    if ("reason" in followed) return followed.reason === "robots_unavailable" ? "unavailable" : "none";
    const { status, headers, body } = followed.response;
    if (retryable(status)) return "unavailable";
    if (status !== 200 || !headers.get("content-type")?.includes("html")) return "none";
    return { url: followed.url.href, html: new TextDecoder().decode(body) };
  } catch {
    return "unavailable";
  }
}

async function loadsAsPicture(follow: Follow, imageUrl: string): Promise<ShowImage> {
  let followed: Awaited<ReturnType<Follow>>;
  try {
    followed = await follow(new URL(imageUrl), "image/*", MAX_IMAGE_BYTES, () => true);
  } catch {
    return "unavailable";
  }
  if ("reason" in followed) return followed.reason === "robots_unavailable" ? "unavailable" : "none";
  const { status, headers, body } = followed.response;
  if (retryable(status)) return "unavailable";
  const type = headers.get("content-type") ?? "";
  if (status !== 200 || !type.startsWith("image/") || type.includes("svg")) return "none";
  try {
    const { width, height } = imageSize(body);
    return width >= MIN_WIDTH && height >= MIN_HEIGHT ? { imageUrl } : "none";
  } catch {
    return "none";
  }
}

/**
 * Each due show's own picture, in order: its page's link-preview image, or else the first picture in its content. A
 * show citing a page that lists several shows is looked up on the page that listing links under its title. A picture
 * the home page or that listing also previews, or another show also has, belongs to the site rather than the show.
 */
export async function findShowImages(
  follow: Follow,
  museum: MuseumShows,
  deadline = Number.POSITIVE_INFINITY,
): Promise<ShowImage[]> {
  const home = httpsUrl("/", museum.website);
  if (!home) return museum.due.map(() => "none");
  const listings = new Set([home.href, ...museum.listingUrls.flatMap((url) => httpsUrl(url)?.href ?? [])]);
  const citations = new Map<string, number>();
  for (const { sourceUrl } of [...museum.checked, ...museum.due]) {
    citations.set(sourceUrl, (citations.get(sourceUrl) ?? 0) + 1);
  }
  const titlesBySource = new Map<string, string[]>();
  for (const { title, sourceUrl } of museum.due) {
    const source = httpsUrl(sourceUrl)?.href;
    if (source) titlesBySource.set(source, [...(titlesBySource.get(source) ?? []), title]);
  }

  // The home page and listings serve several shows, so each is read once and kept only as its picture and show links.
  const sharedPages = new Map<string, Promise<SharedPage>>();
  function summarizeListing(page: Exclude<Page, string>, titles: string[]): Exclude<SharedPage, string> {
    const keep = (link: URL) => link.href !== page.url && link.href !== home!.href && sameSite(link, home!);
    const links = listingLinks(page.html, page.url).filter((link) => keep(new URL(link.url)));
    const showLinks = new Map<string, ShowLink>();
    const unlinked: string[] = [];
    for (const title of titles) {
      const [link] = showPages([title], links, 1);
      if (link) showLinks.set(title, { url: link, card: false });
      else unlinked.push(title);
    }
    for (const [title, link] of cardLinks(page.html, page.url, unlinked, keep)) {
      showLinks.set(title, { url: link, card: true });
    }
    return { image: previewImage(page.html, page.url), firstImage: contentImage(page.html, page.url), showLinks };
  }
  async function readListing(url: URL): Promise<SharedPage> {
    const page = await readPage(follow, url);
    return typeof page === "string" ? page : summarizeListing(page, titlesBySource.get(url.href) ?? []);
  }
  function readShared(url: URL): Promise<SharedPage> {
    if (!sharedPages.has(url.href)) sharedPages.set(url.href, readListing(url));
    return sharedPages.get(url.href)!;
  }
  const homePage = await readShared(home);
  const homeImages: { image?: string; firstImage?: string } = typeof homePage === "string" ? {} : homePage;

  async function readShowLink(link: ShowLink | undefined, title: string): Promise<Page> {
    const own = link && httpsUrl(link.url);
    if (!own) return "none";
    const page = await readPage(follow, own);
    // A link found near the title rather than on it may be a neighbour's, so the page must name the show.
    return typeof page !== "string" && link.card && !namesShow(page.html, title) ? "none" : page;
  }

  async function ownPreview({ title, sourceUrl }: MuseumShows["due"][number]): Promise<ShowImage> {
    const source = httpsUrl(sourceUrl);
    if (!source) return "none";
    let page: Page;
    let listingImage: string | undefined;
    if (listings.has(source.href) || (citations.get(sourceUrl) ?? 0) > 1) {
      const listing = await readShared(source);
      if (typeof listing === "string") return listing;
      listingImage = listing.image;
      page = await readShowLink(listing.showLinks.get(title), title);
    } else {
      page = await readPage(follow, source);
      // Extraction cites the redirect destination, which can differ from the discovery listing URL.
      if (typeof page !== "string" && !namesShow(page.html, title)) {
        const listing = summarizeListing(page, [title]);
        const link = listing.showLinks.get(title);
        if (link) {
          listingImage = listing.image;
          page = await readShowLink(link, title);
        }
      }
    }
    if (typeof page === "string") return page;
    const preview = previewImage(page.html, page.url);
    const imageUrl = preview ?? contentImage(page.html, page.url);
    // The first picture on the home page too is the site's header or logo rather than the show's.
    const siteImages = [homeImages.image, listingImage, ...(preview ? [] : [homeImages.firstImage])];
    if (!imageUrl || siteImages.includes(imageUrl) || /logo/i.test(new URL(imageUrl).pathname)) return "none";
    return { imageUrl };
  }

  const uses = new Map<string, number>();
  for (const imageUrl of museum.checked.flatMap((show) => show.imageUrl ?? [])) {
    uses.set(imageUrl, (uses.get(imageUrl) ?? 0) + 1);
  }
  // Finish each image before reading the next page so a slow museum makes progress within the budget.
  const previews: ShowImage[] = [];
  const images: ShowImage[] = [];
  for (const show of museum.due) {
    const preview = Date.now() < deadline ? await ownPreview(show) : "unavailable";
    previews.push(preview);
    if (typeof preview === "string") {
      images.push(preview);
    } else {
      uses.set(preview.imageUrl, (uses.get(preview.imageUrl) ?? 0) + 1);
      images.push(
        uses.get(preview.imageUrl)! > 1
          ? "none"
          : Date.now() < deadline
            ? await loadsAsPicture(follow, preview.imageUrl)
            : "unavailable",
      );
    }
  }
  // A later show can identify an earlier picture as shared even after that picture has been validated.
  return previews.map((preview, index) =>
    typeof preview !== "string" && uses.get(preview.imageUrl)! > 1 ? "none" : images[index],
  );
}
