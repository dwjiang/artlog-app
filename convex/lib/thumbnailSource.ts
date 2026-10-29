/** Only known whole-image resize variants can supply the ORB reference's aspect ratio. */
export function thumbnailShowsReference(thumbnail: string, reference: string): boolean {
  return imageKey(thumbnail) === imageKey(reference);
}

function imageKey(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname === "commons.wikimedia.org" && url.pathname.startsWith("/wiki/Special:FilePath/")) {
      url.searchParams.delete("width");
    } else if (url.hostname === "www.artic.edu") {
      url.pathname = url.pathname.replace(/^(\/iiif\/2\/[^/]+\/full\/)\d+,(\/0\/default\.jpg)$/, "$1size$2");
    } else if (url.hostname === "kokoelma.kansallisgalleria.fi") {
      url.pathname = url.pathname.replace(/^(\/media-assets\/[^/]+\/jpg\/)\d+(\/[^/]+)$/, "$1size$2");
    }
    return url.href;
  } catch {
    return value;
  }
}
