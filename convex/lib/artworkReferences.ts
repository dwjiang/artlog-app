import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

import policy from "../../shared/sources/research-policy.json";
import { websiteUrl } from "./collectionSiteProbe";
import type { WikidataEntity } from "./wikidata";

export type ArtworkReference = { url: string; referenceUrl: string };

export function boundedReferences(references: ArtworkReference[]): ArtworkReference[] {
  const seen = new Set<string>();
  return references
    .flatMap((reference) => {
      const url = websiteUrl(reference.url);
      if (!url || url.protocol !== "https:" || url.port) return [];
      url.search = new URLSearchParams(
        [...url.searchParams].filter(([key]) => !key.startsWith("utm_") && !["fbclid", "gclid"].includes(key)),
      ).toString();
      url.searchParams.sort();
      const identity = url.href.replace("https://www.", "https://").replace(/\/$/, "");
      if (seen.has(identity)) return [];
      seen.add(identity);
      return [{ ...reference, url: url.href }];
    })
    .slice(0, policy.maxReferencePages);
}

export function wikidataReferences(entity: WikidataEntity): ArtworkReference[] {
  return Object.values(entity.claims ?? {}).flatMap((claims) =>
    claims.flatMap((claim) =>
      claim.rank === "deprecated"
        ? []
        : (claim.references ?? []).flatMap((reference) =>
            (reference.snaks?.P854 ?? []).flatMap((snak) =>
              typeof snak.datavalue?.value === "string"
                ? [{ url: snak.datavalue.value, referenceUrl: `https://www.wikidata.org/wiki/${entity.id}` }]
                : [],
            ),
          ),
    ),
  );
}

type Node = DefaultTreeAdapterTypes.Node;
function descendants(node: Node): DefaultTreeAdapterTypes.Element[] {
  return "childNodes" in node
    ? node.childNodes.flatMap((child) => [...("tagName" in child ? [child] : []), ...descendants(child)])
    : [];
}
const attribute = (node: DefaultTreeAdapterTypes.Element, name: string) =>
  node.attrs.find((a) => a.name === name)?.value;

// Commons source rows link each identifier to its Wikidata property page ("Property:P4610", the Art
// Institute ID), which documents the identifier for every artwork rather than describing this one.
const WIKI_NAMESPACE =
  /^https:\/\/[^/]*\b(?:wikidata|wikipedia|wikimedia|wikisource|wikiquote)\.org\/wiki\/(?:Property|Special|Help|Template|Category|Commons|File|User|Wikidata|Wikipedia|Portal|Talk|Lexeme|EntitySchema|Module|MediaWiki|Project)(?:_talk)?:/i;
export const wikiNamespacePage = (url: string) => WIKI_NAMESPACE.test(url);

export function commonsReferences(html: string, referenceUrl: string): ArtworkReference[] {
  return descendants(parseFragment(html))
    .filter((node) => ["fileinfotpl_src", "fileinfotpl_art_references"].includes(attribute(node, "id") ?? ""))
    .flatMap((cell) => {
      const row = cell.parentNode;
      if (!row || !("tagName" in row) || row.tagName !== "tr") return [];
      return descendants(row).flatMap((node) => {
        const url = node.tagName === "a" ? attribute(node, "href") : undefined;
        // Only explicit external citations, never navigation, creator links or file licensing links.
        return url?.startsWith("https://") && !wikiNamespacePage(url) ? [{ url, referenceUrl }] : [];
      });
    });
}
