import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";

import type { CaptureCompletion } from "@/lib/capture/completion";
import { CONTRIBUTION_MESSAGES } from "@/lib/label/contribute";
import { formStateFromFlow } from "@/lib/label/fields";
import { shareSavedLabel } from "@/lib/label/share-saved-label";
import { reportError } from "@/lib/observability";
import { dismissToast, useToast } from "@/lib/ui/toast";
import { VisitInProgressError } from "@/lib/venue/use-venue";

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
const mockDismissAll = jest.fn();
const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ dismissAll: mockDismissAll, navigate: mockNavigate }) }));
const mockMake = jest.fn();
jest.mock("@/lib/journal/visitless-saves", () => ({ useMakeVisit: () => ({ make: mockMake }) }));
const mockInVisit = jest.fn(() => false);
jest.mock("@/db/repos/artwork-album", () => ({ isArtworkInVisit: () => mockInVisit() }));

let toastHook: { result: { current: ReturnType<typeof useToast> } };
const getToast = () => toastHook.result.current;

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
    capture: { capturedAt: capture.capturedAt, venueId: capture.venueId, photoIds: [capture.localId] },
    title: "Water Lilies",
    previewPath: null,
  },
};

afterEach(() => dismissToast());

beforeEach(async () => {
  jest.clearAllMocks();
  toastHook = await renderHook(useToast);
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("a completed save", () => {
  const draft = { title: "Water Lilies", artist: "", date: "", medium: "", institution: "" };
  async function saveWith(completion: Partial<CaptureCompletion>) {
    jest.mocked(saveResult).mockResolvedValue({
      ...saved,
      completion: { ...saved.completion, ...completion },
      contribution: undefined,
    });
    const hook = await renderHook(useSaveResult);
    await act(() => hook.result.current.save({ capture, draft }));
    return hook;
  }

  it("returns to the camera, where the toast shows the artwork and opens it", async () => {
    await saveWith({ previewPath: "crops/c1.preview.jpg", visitOutcome: "joined" });
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/(tabs)/(scan)/scan");
    expect(getToast()).toMatchObject({
      message: "Saved",
      action: { label: "View" },
      image: expect.stringMatching(/crops\/c1\.preview\.jpg$/),
    });
    getToast()?.action?.onPress();
    expect(mockNavigate).toHaveBeenLastCalledWith({ pathname: "/saved/[savedId]", params: { savedId: "saved-1" } });
  });

  it("says when the save started a visit", async () => {
    await saveWith({ visitOutcome: "started" });
    expect(getToast()?.message).toBe("Saved · visit started");
  });

  it("offers to add a save that joined no visit to one", async () => {
    await saveWith({});
    expect(getToast()).toMatchObject({ message: "Saved", action: { label: "Add to visit" } });
    getToast()?.action?.onPress();
    expect(mockMake).toHaveBeenCalledWith(["saved-1"], capture.venueId, saved.completion.capture);
  });

  it("opens an artwork that was already in a visit even when this save joined none", async () => {
    mockInVisit.mockReturnValueOnce(true);
    await saveWith({});
    expect(getToast()?.action?.label).toBe("View");
  });
});

it("reports the shared index's answer in toasts, with a retry when the share attempt itself fails", async () => {
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
  expect(hook.result.current.savedId).toBe("saved-1");
  await waitFor(() =>
    expect(getToast()).toMatchObject({
      message: "Couldn’t save to the shared index right now. Your artwork is saved to your collection.",
      action: { label: "Retry" },
    }),
  );
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "result.share");
  jest.mocked(shareSavedLabel).mockResolvedValue({ result: outcome });
  await act(() => getToast()?.action?.onPress());
  expect(shareSavedLabel).toHaveBeenCalledWith(contribution, "saved-1");
  await waitFor(() => expect(getToast()?.message).toBe(CONTRIBUTION_MESSAGES.tentative));
  expect(getToast()?.action).toBeUndefined();
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

describe("a save that would start a visit while another is open", () => {
  const draft = { title: "Water Lilies", artist: "", date: "", medium: "", institution: "" };
  const open = {
    localId: "open-visit",
    venueId: "museum-other" as Id<"museums">,
    venueName: "Neue Galerie",
    startedAt: 0,
    visitedOn: "1970-01-01",
    timeZone: "UTC",
  };
  function answer(text: string) {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      buttons?.find((button) => button.text === text)?.onPress?.();
    });
  }
  afterEach(() => jest.restoreAllMocks());

  it("saves the artwork alone when the person keeps that visit open", async () => {
    answer("Save artwork only");
    jest
      .mocked(saveResult)
      .mockRejectedValueOnce(new VisitInProgressError(open))
      .mockResolvedValueOnce({ ...saved, contribution: undefined });
    const hook = await renderHook(useSaveResult);
    await act(() => hook.result.current.save({ capture, draft }));
    expect(jest.mocked(saveResult).mock.calls.map(([, options]) => options)).toEqual([
      { withoutVisit: false },
      { withoutVisit: true },
    ]);
    expect(hook.result.current).toMatchObject({ saving: false, savedId: "saved-1", error: undefined });
  });

  it("leaves the draft unsaved and without an error when the person cancels", async () => {
    answer("Cancel");
    jest.mocked(saveResult).mockRejectedValue(new VisitInProgressError(open));
    const hook = await renderHook(useSaveResult);
    await act(() => hook.result.current.save({ capture, draft }));
    expect(saveResult).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
    expect(hook.result.current).toMatchObject({ saving: false, savedId: undefined, error: undefined });
  });
});
