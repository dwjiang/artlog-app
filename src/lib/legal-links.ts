import { openBrowserAsync } from "expo-web-browser";

import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

/** Opens the Privacy Policy or Terms of Service page that the backend serves, in the in-app browser. */
export async function openLegalPage(page: "privacy" | "terms") {
  try {
    const site = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
    if (!site) throw new Error("EXPO_PUBLIC_CONVEX_SITE_URL is not configured");
    await openBrowserAsync(new URL(`/${page}`, site).href);
  } catch (cause) {
    reportError(cause, "legal.open", { level: "warning" });
    showErrorToast("Couldn’t open the page.", () => void openLegalPage(page));
  }
}
