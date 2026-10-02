import { openBrowserAsync } from "expo-web-browser";

import { openLegalPage } from "@/lib/legal-links";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/ui/toast", () => ({ showErrorToast: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL = "https://test.convex.site";
});

it("opens the page the backend serves", async () => {
  await openLegalPage("terms");
  expect(openBrowserAsync).toHaveBeenCalledWith("https://test.convex.site/terms");
  expect(showErrorToast).not.toHaveBeenCalled();
});

it("offers a retry when the browser can't open", async () => {
  const failure = new Error("no browser");
  jest.mocked(openBrowserAsync).mockRejectedValueOnce(failure);
  await openLegalPage("privacy");
  expect(reportError).toHaveBeenCalledWith(failure, "legal.open", { level: "warning" });
  const retry = jest.mocked(showErrorToast).mock.calls[0]?.[1];
  expect(jest.mocked(showErrorToast).mock.calls[0]?.[0]).toBe("Couldn’t open the page.");
  retry?.();
  expect(openBrowserAsync).toHaveBeenLastCalledWith("https://test.convex.site/privacy");
});
