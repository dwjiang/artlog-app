import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { SEARCH_CONSENT_TITLE } from "@/components/scan/result/search-consent-sheet";
import { runMuseumSearch } from "@/lib/museum-search/flow";
import * as museumSearch from "@/lib/settings/museum-search";

import { MUSEUM_SEARCH_SETTING } from "./museum-search-section";
import { SettingsDetailScreen } from "./settings-detail-screen";

const { getMuseumSearchConsent, setMuseumSearchConsent } = museumSearch;

jest.mock("./leaderboard-preference", () => ({
  LeaderboardPreference: () => null,
}));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/hooks/use-screen-active", () => ({ useScreenActive: () => true }));
jest.mock("./dev-tools", () => ({ DevTools: () => null }));
jest.mock("@/lib/account/use-account", () => ({
  useAccount: () => ({
    account: null,
    available: false,
    busy: false,
    ready: false,
  }),
}));
jest.mock("convex/react", () => ({
  useQuery: () => undefined,
  useConvexAuth: () => ({ isAuthenticated: false }),
}));
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  Stack: { Screen: () => null },
}));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => false }));

beforeEach(async () => {
  await setMuseumSearchConsent("unset");
});
afterEach(() => jest.restoreAllMocks());

it("ends loading with a footer message when the stored choice cannot be read", async () => {
  jest.spyOn(museumSearch, "getMuseumSearchConsent").mockRejectedValue(new Error("Read failed"));
  await render(<SettingsDetailScreen section="privacy" />);
  expect(await screen.findByText("Couldn't read your choice. Reopen Settings to try again.")).toBeOnTheScreen();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).toBeDisabled();
});

it("mounts the privacy control in Settings and requires consent before enabling it", async () => {
  await render(<SettingsDetailScreen section="privacy" />);
  const toggle = await screen.findByRole("switch", {
    name: MUSEUM_SEARCH_SETTING,
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).not.toBeChecked();
  await fireEvent.press(toggle);
  expect(await screen.findByText(SEARCH_CONSENT_TITLE)).toBeOnTheScreen();
  expect(await getMuseumSearchConsent()).toBe("unset");
  await fireEvent.press(screen.getByRole("button", { name: "Search this museum" }));
  await waitFor(() => expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).toBeChecked());
  expect(await getMuseumSearchConsent()).toBe("granted");
});

it("persists off as declined through a remount and keeps cancellation off", async () => {
  await setMuseumSearchConsent("granted");
  const view = await render(<SettingsDetailScreen section="privacy" />);
  await waitFor(() => expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).toBeChecked());
  let release!: () => void;
  jest.spyOn(museumSearch, "setMuseumSearchConsent").mockImplementationOnce(async (value) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return setMuseumSearchConsent(value);
  });
  await fireEvent.press(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING }));
  expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).not.toBeChecked();
  expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).toBeEnabled();
  await act(() => release());
  expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).not.toBeChecked();
  expect(await getMuseumSearchConsent()).toBe("declined");
  await view.unmount();
  await render(<SettingsDetailScreen section="privacy" />);
  await waitFor(() => expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).toBeEnabled());
  expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).not.toBeChecked();
  await fireEvent.press(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING }));
  await fireEvent.press(await screen.findByRole("button", { name: "Not now" }));
  expect(await getMuseumSearchConsent()).toBe("declined");
  expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).not.toBeChecked();
  await fireEvent.press(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING }));
  await fireEvent.press(await screen.findByRole("button", { name: "Search this museum" }));
  await waitFor(() => expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).toBeChecked());
});

it("turns the switch back on and explains when saving off fails", async () => {
  await setMuseumSearchConsent("granted");
  await render(<SettingsDetailScreen section="privacy" />);
  await waitFor(() => expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).toBeChecked());
  jest.spyOn(museumSearch, "setMuseumSearchConsent").mockRejectedValueOnce(new Error("Disk full"));
  await fireEvent.press(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING }));
  await waitFor(() => expect(screen.getByText("Couldn't save your choice. Try again.")).toBeOnTheScreen());
  expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).toBeChecked();
  expect(await getMuseumSearchConsent()).toBe("granted");
});

it("prevents any request after revoking consent in Settings and returning to a scan", async () => {
  await setMuseumSearchConsent("granted");
  const view = await render(<SettingsDetailScreen section="privacy" />);
  const toggle = screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING });
  await waitFor(() => expect(toggle).toBeChecked());
  await fireEvent.press(toggle);
  await waitFor(() => expect(screen.getByRole("switch", { name: MUSEUM_SEARCH_SETTING })).not.toBeChecked());
  await view.unmount();
  const searchExhibitions = jest.fn();
  expect(
    await runMuseumSearch({
      scanId: "scan-1" as import("../../../convex/_generated/dataModel").Id<"scans">,
      localId: "capture-1",
      inputSize: 512,
      canContinue: () => true,
      getCapture: jest.fn(),
      api: { searchExhibitions, confirmSearchCandidate: jest.fn() },
      images: {
        download: jest.fn(),
        letterbox: jest.fn(),
        embed: jest.fn(),
        extractOrb: jest.fn(),
        remove: jest.fn(),
      },
    }),
  ).toEqual({ stage: "cancelled" });
  expect(searchExhibitions).not.toHaveBeenCalled();
});
