import { openBrowserAsync } from "expo-web-browser";

import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

// Proxies production's Convex pages (www/vercel.json), so every build shows the published policy.
const LEGAL_SITE = "https://artlog.dwjiang.com";

/** Opens a legal page (Privacy Policy, Terms of Service or Open source licenses) in the in-app browser. */
export async function openLegalPage(page: "privacy" | "terms" | "licenses") {
  try {
    await openBrowserAsync(`${LEGAL_SITE}/${page}`);
  } catch (cause) {
    reportError(cause, "legal.open", { level: "warning" });
    showErrorToast("Couldn’t open the page.", () => void openLegalPage(page));
  }
}
