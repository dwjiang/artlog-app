import { act, renderHook, waitFor } from "@testing-library/react-native";

import { formStateFromFlow } from "@/lib/label/fields";
import { shareSavedLabel } from "@/lib/label/share-saved-label";
import { reportError } from "@/lib/observability";

import type { Id } from "../../../convex/_generated/dataModel";
import { saveResult } from "./save";
import { useSaveResult } from "./use-save-result";

jest.mock("@/lib/observability", () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock("expo-haptics", () => ({
  notificationAsync: async () => {},
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("./save", () => ({
  saveResult: jest.fn(),
  saveErrorMessage: () => "Couldn’t save. Try again.",
}));
jest.mock("@/lib/label/share-saved-label", () => ({ shareSavedLabel: jest.fn() }));

const capture = {
  localId: "capture",
  owner: "device:test",
  photoPath: "capture.jpg",
  cropPath: "crop.jpg",
  cropCorners: null,
  capturedAt: 1,
  venueId: "museum-met" as Id<"museums">,
  visitId: null,
  visitLocalId: null,
  descriptors: new ArrayBuffer(0),
  keypoints: new ArrayBuffer(0),
};
const contribution = {
  scanId: "scan-1" as Id<"scans">,
  capture,
  state: formStateFromFlow({
    stage: "verified",
    moderation: "clear",
    evidence: ["ocr"],
    warnings: [],
    updatedAt: 1,
    fields: {
      title: { value: "Water Lilies", evidence: "ocr", locked: false },
      artist: { value: "Claude Monet", evidence: "ocr", locked: false },
    },
  }),
};
const outcome = {
  contributionId: "contribution-1" as Id<"contributions">,
  status: "tentative" as const,
};
const saved = {
  localId: "saved-1",
  synced: Promise.resolve(),
  completion: {
    savedId: "saved-1",
    title: "Water Lilies",
    wasExisting: false,
    photoPaths: [],
    visitLabel: "The Met",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

it("ends the sharing state and offers a retry when the share attempt itself fails", async () => {
  jest.mocked(saveResult).mockImplementation(async () => ({
    ...saved,
    contribution: Promise.reject(new Error("database is locked")),
  }));
  const hook = await renderHook(useSaveResult);
  await act(() =>
    hook.result.current.save({
      capture,
      contribution,
      draft: {
        title: "Water Lilies",
        artist: "",
        date: "",
        medium: "",
        institution: "",
      },
    }),
  );
  await waitFor(() => expect(hook.result.current.sharing).toBe(false));
  expect(hook.result.current.savedId).toBe("saved-1");
  expect(hook.result.current.shareError).toBe("Couldn’t save to the shared index right now");
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "result.share");
  jest.mocked(shareSavedLabel).mockResolvedValue({ result: outcome });
  await act(() => hook.result.current.retrySharing());
  expect(shareSavedLabel).toHaveBeenCalledWith(contribution, "saved-1");
  expect(hook.result.current).toMatchObject({
    sharing: false,
    shared: outcome,
    shareError: undefined,
  });
});

it("reports a failed local save while leaving the draft available to retry", async () => {
  const error = new Error("database is locked");
  jest.mocked(saveResult).mockRejectedValue(error);
  const hook = await renderHook(useSaveResult);
  await act(() =>
    hook.result.current.save({
      capture,
      draft: {
        title: "Private title",
        artist: "",
        date: "",
        medium: "",
        institution: "",
      },
    }),
  );
  expect(reportError).toHaveBeenCalledWith(error, "result.save");
  expect(hook.result.current).toMatchObject({
    saving: false,
    savedId: undefined,
    error: "Couldn’t save. Try again.",
  });
});
