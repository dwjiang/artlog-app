import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import type { PendingScan } from "@/db/schema";
import { formStateFromValues, setFieldValue } from "@/lib/label/fields";
import { reportError } from "@/lib/observability";
import { saveResult } from "@/lib/result/save";
import type { ResultCandidate } from "@/lib/result/state";
import { CONFIRM_WAIT_MS } from "@/lib/result/use-confirm-details";
import { MATCH_DELAY_MS } from "@/lib/result/use-corpus-matches";

import type { Id } from "../../../../convex/_generated/dataModel";
import { ConfirmDetailsReview } from "./confirm-details-review";

let mockOffline = false;
let mockMatches: ResultCandidate[] | undefined;
let mockLookups: unknown[] = [];
const mockMutation = jest.fn();
const mockDismissTo = jest.fn();
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isInternetReachable: !mockOffline }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ dismissTo: mockDismissTo }) }));
jest.mock("@/lib/convex-client", () => ({ convex: { mutation: (...args: unknown[]) => mockMutation(...args) } }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("convex/react", () => ({
  useQueries: (requests: Record<string, { args: unknown }>) => {
    if (!requests.matches) return {};
    mockLookups.push(requests.matches.args);
    return { matches: mockMatches };
  },
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock("@/lib/result/save", () => ({ saveResult: jest.fn(), saveErrorMessage: () => "Couldn’t save. Try again." }));
jest.mock("@/lib/label/share-saved-label", () => ({ shareSavedLabel: jest.fn() }));
jest.mock("@/lib/venue/end-visit-prompt", () => ({
  withEndVisitPrompt: (save: (withoutVisit: boolean) => Promise<unknown>) => save(false),
}));
jest.mock("@/components/scan/capture-completion", () => ({
  CaptureCompletion: ({ children, completion }: { children: ReactNode; completion?: { title: string } }) => {
    const { Text } = jest.requireActual("react-native");
    return completion ? <Text>Saved {completion.title}</Text> : children;
  },
}));

const scanId = "scan-1" as Id<"scans">;
const capture = {
  localId: "capture-1",
  owner: "device:test-installation",
  photoPath: "photo.jpg",
  cropPath: "crop.jpg",
} as PendingScan;
const form = formStateFromValues({ title: " Pond at dusk ", artist: "Monet", date: "1900" });
const review = (sourceKind: "manual" | "label" = "manual", state = form) => (
  <ConfirmDetailsReview scanId={scanId} sourceKind={sourceKind} capture={capture} form={state} onChange={jest.fn()} />
);
const pond: ResultCandidate = {
  identityStatus: "established",
  objectId: "obj-pond" as Id<"objects">,
  artworkId: "art-pond" as Id<"artworks">,
  title: "The Water Lily Pond",
  artist: "Claude Monet",
  institution: "National Gallery",
  rightsStatus: "public_domain",
  thumbnailUrl: "https://museum.example/pond.jpg",
};
const named = { title: "Pond at dusk", artist: "Monet", date: "1900" };

beforeEach(() => {
  jest.clearAllMocks();
  mockOffline = false;
  mockMatches = [];
  mockLookups = [];
  jest.mocked(saveResult).mockResolvedValue({
    localId: "saved-1",
    synced: Promise.resolve(),
    completion: { savedId: "saved-1", title: "Pond at dusk", previewPath: null },
  });
});
afterEach(() => jest.useRealTimers());

it.each(["manual", "label"] as const)("saves %s details privately while offline", async (source) => {
  mockOffline = true;
  await render(review(source));
  expect(screen.getByRole("button", { name: "Confirm details" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Save to collection" }));
  expect(saveResult).toHaveBeenCalledWith(
    {
      scanId,
      capture,
      draft: { title: "Pond at dusk", artist: "Monet", date: "1900", medium: "", institution: "" },
    },
    { withoutVisit: false },
  );
  expect(await screen.findByText("Saved Pond at dusk")).toBeOnTheScreen();
  expect(mockMutation).not.toHaveBeenCalled();
});

it("releases a pending confirmation when signal drops and ignores its late reply after a local save", async () => {
  let finish!: () => void;
  mockMutation.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const view = await render(review());
  await fireEvent.press(screen.getByRole("button", { name: "Confirm details" }));
  expect(screen.getByRole("button", { name: "Confirm details" })).toBeDisabled();
  mockOffline = true;
  await view.rerender(review());
  expect(await screen.findByRole("button", { name: "Save to collection" })).toBeEnabled();
  expect(screen.getByLabelText("Title")).toHaveProp("editable", true);
  await fireEvent.press(screen.getByRole("button", { name: "Save to collection" }));
  await act(() => finish());
  expect(screen.getByText("Saved Pond at dusk")).toBeOnTheScreen();
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
});

it("offers local saving when the server stalls even though network reachability stays online", async () => {
  jest.useFakeTimers();
  mockMutation.mockReturnValue(new Promise(() => {}));
  await render(review());
  await fireEvent.press(screen.getByRole("button", { name: "Confirm details" }));
  await act(() => jest.advanceTimersByTime(CONFIRM_WAIT_MS));
  expect(screen.getByRole("button", { name: "Confirm details" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Save to collection" })).toBeEnabled();
  expect(reportError).not.toHaveBeenCalled();
});

it("does not navigate after the person has left a confirming form", async () => {
  let finish!: () => void;
  mockMutation.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const view = await render(review());
  await fireEvent.press(screen.getByRole("button", { name: "Confirm details" }));
  await view.unmount();
  await act(() => finish());
  expect(mockDismissTo).not.toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
});

it("offers the catalogue work the details name and links it as the scan's match", async () => {
  mockMatches = [pond];
  mockMutation.mockResolvedValue(null);
  await render(review("label"));
  expect(mockLookups.at(-1)).toEqual({ scanId, fields: named });
  expect(screen.getByRole("header", { name: "Is it this?" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "The Water Lily Pond, Claude Monet" }));
  expect(mockMutation).toHaveBeenCalledWith(expect.anything(), {
    scanId,
    objectId: pond.objectId,
    source: "label",
    fields: named,
  });
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: "/result/[scanId]", params: { scanId } });
});

it("looks up edited details only once typing pauses", async () => {
  jest.useFakeTimers();
  const view = await render(review());
  await view.rerender(review("manual", setFieldValue(form, "title", "Water Lily Pond")));
  expect(mockLookups.at(-1)).toEqual({ scanId, fields: named });
  await act(() => jest.advanceTimersByTime(MATCH_DELAY_MS));
  expect(mockLookups.at(-1)).toEqual({ scanId, fields: { ...named, title: "Water Lily Pond" } });
});

it("keeps the details form when choosing a work fails", async () => {
  mockMatches = [pond, { ...pond, objectId: "obj-pond-2" as Id<"objects">, title: "Water Lilies" }];
  mockMutation.mockRejectedValue(new Error("invalid_object"));
  await render(review());
  expect(screen.getByRole("header", { name: "Is it one of these?" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Water Lilies, Claude Monet" }));
  expect(await screen.findByText("Couldn’t choose this artwork. Try again.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Confirm details" })).toBeEnabled();
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "result.link_artwork");
  expect(mockDismissTo).not.toHaveBeenCalled();
});
