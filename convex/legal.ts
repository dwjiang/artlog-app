import { httpAction } from "./_generated/server";
import { legalDocuments, renderLegalPage, type LegalDocument } from "./lib/legalPages";

// Public pages: the App Store listing and the app's legal links point here.
function page(document: LegalDocument) {
  return new Response(renderLegalPage(document), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export const privacy = httpAction(async () => page(legalDocuments.privacy));
export const terms = httpAction(async () => page(legalDocuments.terms));
