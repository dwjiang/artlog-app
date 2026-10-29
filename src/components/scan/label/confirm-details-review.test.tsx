import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";

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
const mockDismissAll = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();
// Like Expo Router's removal prevention: a blocked back goes to the screen's callback, whose `repeat` goes back.
let mockGuard: { prevented: boolean; onPrevented?: (event: { repeat: () => void }) => void } = { prevented: false };
const back = () => (mockGuard.prevented ? mockGuard.onPrevented?.({ repeat: mockBack }) : mockBack());
jest.mock("expo-router", () => ({
  useRouter: () => ({ dismissTo: mockDismissTo, dismissAll: mockDismissAll, navigate: mockNavigate }),
  usePreventRemove: (prevented: boolean, onPrevented: (event: { repeat: () => void }) => void) => {
    mockGuard = { prevented, onPrevented };
    return () => {
      mockGuard.prevented = false;
    };
  },
}));
jest.mock("@/lib/convex-client", () => ({ convex: { mutation: (...args: unknown[]) => mockMutation(...args) } }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("convex/react", () => ({
  useQueries: (requests: Record<string, { args: unknown }>) => {
    if (!requests.matches) return {};
    mockLookups.push(requests.matches.args);
    return { matches: mockMatches };
  },
}));
jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));
jest.mock("@/lib/result/save", () => ({ saveResult: jest.fn(), saveErrorMessage: () => "Couldn’t save. Try again." }));
jest.mock("@/lib/label/share-saved-label", () => ({ shareSavedLabel: jest.fn() }));
jest.mock("@/lib/venue/end-visit-prompt", () => ({
  withEndVisitPrompt: (save: (withoutVisit: boolean) => Promise<unknown>) => save(false),
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

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockOffline = false;
  mockMatches = [];
  mockLookups = [];
  jest.mocked(saveResult).mockResolvedValue({
    localId: "saved-1",
    synced: Promise.resolve(),
    completion: { savedId: "saved-1", previewPath: null, capture: { capturedAt: 1, photoIds: [] } },
  });
});
afterEach(() => {
  jest.useRealTimers();
  alert.mockRestore();
});
const alertButton = (text: string) =>
  (alert.mock.lastCall as [string, undefined, AlertButton[]])[2].find((button) => button.text === text)!;

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
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/(tabs)/(scan)/scan"));
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
  expect(mockNavigate).toHaveBeenCalledWith("/(tabs)/(scan)/scan");
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

it("goes back without asking while the details are as the screen showed them", async () => {
  const view = await render(review("label"));
  // A field typed back to its shown value, give or take spaces, is no edit.
  await view.rerender(review("label", setFieldValue(form, "title", "Pond at dusk  ")));
  await act(() => back());
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
});

it.each(["manual", "label"] as const)("asks before going back from typed %s details", async (source) => {
  const view = await render(review(source));
  await view.rerender(review(source, setFieldValue(form, "artist", "Claude Monet")));
  await act(() => back());
  expect(alert).toHaveBeenCalledWith("Discard your edits?", undefined, expect.any(Array));
  await act(() => alertButton("Keep Editing").onPress?.());
  expect(mockBack).not.toHaveBeenCalled();
  await act(() => back());
  await act(() => alertButton("Discard Edits").onPress?.());
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("lets a confirmation of typed details return to the result without asking", async () => {
  let finish!: () => void;
  mockMutation.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const view = await render(review());
  const edited = setFieldValue(form, "artist", "Claude Monet");
  await view.rerender(review("manual", edited));
  expect(mockGuard.prevented).toBe(true);
  await fireEvent.press(screen.getByRole("button", { name: "Confirm details" }));
  expect(mockGuard.prevented).toBe(false);
  await act(() => finish());
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: "/result/[scanId]", params: { scanId } });
  expect(alert).not.toHaveBeenCalled();
});

it("lets a private save of typed details return to the camera without asking", async () => {
  mockOffline = true;
  const view = await render(review());
  await view.rerender(review("manual", setFieldValue(form, "artist", "Claude Monet")));
  await fireEvent.press(screen.getByRole("button", { name: "Save to collection" }));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/(tabs)/(scan)/scan"));
  expect(mockGuard.prevented).toBe(false);
  expect(alert).not.toHaveBeenCalled();
});

it("counts edits from a new reading once it replaces the details", async () => {
  const reread = setFieldValue(form, "title", "Water Lilies");
  const reading = (state: typeof form, key: number) => (
    <ConfirmDetailsReview scanId={scanId} sourceKind="label" form={state} formKey={key} onChange={jest.fn()} />
  );
  const view = await render(reading(form, 1));
  await view.rerender(reading(reread, 2));
  expect(mockGuard.prevented).toBe(false);
  await view.rerender(reading(setFieldValue(reread, "date", "1906"), 2));
  expect(mockGuard.prevented).toBe(true);
});
