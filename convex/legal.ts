import { httpAction } from "./_generated/server";
import { legalDocuments, renderLegalPage, renderLicensesPage } from "./lib/legalPages";
import notices from "./lib/thirdPartyNotices.json";

// Public pages: the App Store listing and the app's legal links point here.
function page(html: string) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export const privacy = httpAction(async () => page(renderLegalPage(legalDocuments.privacy)));
export const terms = httpAction(async () => page(renderLegalPage(legalDocuments.terms)));
export const licenses = httpAction(async () => page(renderLicensesPage(notices)));
