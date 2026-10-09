import { visibleText } from "./pageExtract";
import { commonsImages, getEntities, wikipediaLeadImages, type CommonsImage, type WikidataEntity } from "./wikidata";

const IMAGE = "P18";
const MAX_IMAGE_CLAIMS = 3;
// A famous museum's claims and sitelinks run to a few hundred kilobytes, so 20 stay well under the response cap.
const ENTITY_BATCH = 20;
// Keeps a request's URL short even with non-Latin file names.
const TITLE_BATCH = 20;
// Narrower photos blur across the card's width.
const MIN_WIDTH = 640;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/tiff"]);
// Small museums' Wikipedia lead images are often a locator map, a logo or a "no free image" placeholder.
const NOT_A_PHOTO =
  /\b(?:map|karte|carte|mapa|locator|location|logo|flag|coat of arms|wappen|placeholder|no free image)\b/i;
// Some Commons authors write a paragraph of credit instructions; the card has room for one line.
const MAX_AUTHOR = 80;
// Commons' note for a file without an author field names the uploader, as a global account name such as "Urban~commonswiki".
const ASSUMED_AUTHOR = /^No machine-readable author provided\. (.+?)(?:~\w+)? assumed\b/;
// Some photographers spell out the line they want inside a paragraph of instructions: "… Credit: Name - CC BY-SA …".
const REQUESTED_CREDIT = /\bCr[eé]dits?\s*:\s*(.+?)(?:\s+[-–]\s+(?:CC|Creative Commons)\b|\.\s|$)/i;
const WIKIPEDIA_SITE = /^([a-z]{2,3}(?:_[a-z0-9]+)*)wiki$/;

export type MuseumPhoto = { file: string; author?: string; license?: string };

/**
 * Each museum's photo from its Wikidata item, else its Wikipedia article's free lead image, with the credit its
 * license asks for, keyed by Wikidata ID. Null when neither is a usable photo.
 */
export async function findMuseumPhotos(wikidataIds: string[]): Promise<Map<string, MuseumPhoto | null>> {
  const photos = new Map<string, MuseumPhoto | null>(wikidataIds.map((id) => [id, null]));
  const entities: WikidataEntity[] = [];
  for (const ids of chunks(wikidataIds, ENTITY_BATCH)) {
    entities.push(...Object.values(await getEntities(ids, "claims|sitelinks", ["en"], "all")));
  }

  const claimed = new Map(entities.map((entity) => [entity.id, imageClaims(entity)]));
  const claimedImages = await lookUpImages([...claimed.values()].flat());
  for (const [id, files] of claimed) photos.set(id, firstPhoto(files, claimedImages));

  const articles = entities.flatMap((entity) => {
    const article = photos.get(entity.id) ? undefined : wikipediaArticle(entity);
    return article ? [{ id: entity.id, ...article }] : [];
  });
  const byLanguage = new Map<string, typeof articles>();
  for (const article of articles) {
    byLanguage.set(article.language, [...(byLanguage.get(article.language) ?? []), article]);
  }
  const leads = new Map<string, string>();
  for (const [language, group] of byLanguage) {
    for (const part of chunks(group, TITLE_BATCH)) {
      const images = await wikipediaLeadImages(
        part.map((article) => article.title),
        language,
      );
      for (const article of part) {
        const file = images.get(article.title);
        if (file) leads.set(article.id, file);
      }
    }
  }
  const leadImages = await lookUpImages([...leads.values()]);
  for (const [id, file] of leads) photos.set(id, firstPhoto([file], leadImages));
  return photos;
}

export async function findMuseumPhoto(wikidataId: string): Promise<MuseumPhoto | null> {
  return (await findMuseumPhotos([wikidataId])).get(wikidataId) ?? null;
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function imageClaims(entity: WikidataEntity): string[] {
  return (entity.claims?.[IMAGE] ?? [])
    .filter((claim) => claim.rank !== "deprecated")
    .toSorted((a, b) => Number(b.rank === "preferred") - Number(a.rank === "preferred"))
    .flatMap((claim) => {
      const file = claim.mainsnak?.datavalue?.value;
      return typeof file === "string" ? [file] : [];
    })
    .slice(0, MAX_IMAGE_CLAIMS);
}

// English first, else the first language the museum has an article in.
function wikipediaArticle(entity: WikidataEntity): { title: string; language: string } | undefined {
  const articles = Object.entries(entity.sitelinks ?? {}).flatMap(([site, { title }]) => {
    const language = WIKIPEDIA_SITE.exec(site)?.[1].replaceAll("_", "-");
    return language ? [{ title, language }] : [];
  });
  return articles.find((article) => article.language === "en") ?? articles[0];
}

// Commons names files with spaces; Wikipedia hands lead images over with underscores.
const fileName = (file: string) => file.replaceAll("_", " ");

async function lookUpImages(files: string[]): Promise<Map<string, CommonsImage>> {
  const names = [...new Set(files.map(fileName).filter((name) => !NOT_A_PHOTO.test(name)))];
  const images = new Map<string, CommonsImage>();
  for (const part of chunks(names, TITLE_BATCH)) {
    for (const [name, image] of await commonsImages(part)) images.set(name, image);
  }
  return images;
}

function firstPhoto(files: string[], images: Map<string, CommonsImage>): MuseumPhoto | null {
  for (const file of files) {
    const image = images.get(fileName(file));
    if (image && PHOTO_TYPES.has(image.mime) && image.width >= MIN_WIDTH) {
      return { file: image.file.replaceAll(" ", "_"), ...credit(image) };
    }
  }
  return null;
}

function credit(image: CommonsImage): Omit<MuseumPhoto, "file"> {
  if (!image.attributionRequired) return {};
  const text = image.artist && visibleText(image.artist).trim();
  const author = text && (ASSUMED_AUTHOR.exec(text)?.[1] ?? REQUESTED_CREDIT.exec(text)?.[1] ?? text);
  return {
    author:
      author && author.length > MAX_AUTHOR ? `${author.slice(0, MAX_AUTHOR - 1).trimEnd()}…` : author || undefined,
    license: image.license,
  };
}
