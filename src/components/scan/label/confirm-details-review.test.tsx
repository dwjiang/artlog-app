import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import type { PendingScan } from "@/db/schema";
import { formStateFromValues } from "@/lib/label/fields";
import { reportError } from "@/lib/observability";
import { saveResult } from "@/lib/result/save";
import { CONFIRM_WAIT_MS } from "@/lib/result/use-confirm-details";

import type { Id } from "../../../../convex/_generated/dataModel";
import { ConfirmDetailsReview } from "./confirm-details-review";

let mockOffline = false;
const mockMutation = jest.fn();
const mockDismissTo = jest.fn();
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isInternetReachable: !mockOffline }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ dismissTo: mockDismissTo }) }));
jest.mock("@/lib/convex-client", () => ({ convex: { mutation: (...args: unknown[]) => mockMutation(...args) } }));
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
const review = (sourceKind: "manual" | "label" = "manual") => (
  <ConfirmDetailsReview scanId={scanId} sourceKind={sourceKind} capture={capture} form={form} onChange={jest.fn()} />
);

beforeEach(() => {
  jest.clearAllMocks();
  mockOffline = false;
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
