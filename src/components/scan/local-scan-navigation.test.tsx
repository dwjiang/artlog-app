import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Stack } from "expo-router/stack";
import { renderRouter } from "expo-router/testing-library";
import { AppState, Text } from "react-native";

import { LocalScanScreen } from "@/components/scan/local-scan-screen";
import { QueueSheet } from "@/components/scan/states/queue-sheet";

jest.mock("./scan-crop-editor", () => ({ ScanCropEditor: () => null }));
jest.mock("@/lib/capture/photo-draft", () => ({
  isLabelCapture: () => false,
  readPhotoSession: () => ({ photos: [] }),
}));
jest.mock("@/lib/capture/discard-capture", () => ({
  discardCapture: jest.fn(),
}));
jest.mock("./capture-context-button", () => ({
  CaptureContextButton: () => null,
}));
jest.mock("./capture-photos-button", () => ({
  CapturePhotosButton: () => null,
}));

let mockRows: {
  owner: string;
  localId: string;
  status: "queued" | "identified";
  cropPath: string;
  capturedAt?: number;
  scanId?: string;
}[] = [];
const mockListeners = new Set<() => void>();
beforeEach(() => {
  AppState.currentState = "active";
});
afterEach(() => jest.useRealTimers());
jest.mock("drizzle-orm/expo-sqlite", () => ({
  useLiveQuery: () => {
    const React = jest.requireActual("react");
    const data = React.useSyncExternalStore(
      (listener: () => void) => {
        mockListeners.add(listener);
        return () => mockListeners.delete(listener);
      },
      () => mockRows,
    );
    return { data, updatedAt: new Date() };
  },
}));
jest.mock("@/db/repos/pending-scans", () => ({
  selectPendingScan: jest.fn(),
  pendingScansQuery: jest.fn(),
}));
jest.mock("@/db/repos/offline-scan-results", () => ({
  offlineResultQuery: jest.fn(),
}));
jest.mock("@/lib/files/photos", () => ({
  ...jest.requireActual("@/lib/files/photos"),
  scanDisplayPath: jest.requireActual("@/lib/files/photos").scanPreviewPath,
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
jest.mock("@/lib/queue/queue", () => ({ retryPendingScan: jest.fn() }));
jest.mock("@/lib/label/share-saved-label", () => ({
  startPendingShareFlusher: jest.fn(),
}));
jest.mock("@/lib/result/use-save-result", () => ({
  useSaveResult: () => ({ saving: false, save: jest.fn() }),
}));
jest.mock("@/lib/journal/use-visit-works", () => ({
  useVisitWorks: () => ({ works: [], loading: false }),
}));
jest.mock("@/lib/result/use-scan", () => ({ useScan: () => undefined }));
jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));

function ResultRoute() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  return scanId.startsWith("local-") ? (
    <LocalScanScreen localId={scanId.slice(6)} />
  ) : (
    <Text>Server result {scanId}</Text>
  );
}

it("keeps label capture open on completion and shows the result when returning", async () => {
  mockRows = [
    {
      owner: "device:test-installation",
      localId: "one",
      status: "queued",
      cropPath: "crops/one.jpg",
    },
  ];
  const view = await renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>Camera</Text>,
      "result/[scanId]": ResultRoute,
      "label/[scanId]": () => <Text>Label capture</Text>,
    },
    { initialUrl: "/" },
  );
  await act(() => router.push("/result/local-one"));
  await fireEvent.press(await screen.findByRole("button", { name: "Point at the label" }));
  await waitFor(() => expect(view.getPathname()).toBe("/label/local-one"));
  await act(() => {
    mockRows = [{ ...mockRows[0], status: "identified", scanId: "server-one" }];
    mockListeners.forEach((listener) => listener());
  });
  expect(view.getPathname()).toBe("/label/local-one");
  expect(screen.getByText("Label capture")).toBeOnTheScreen();
  await act(() => router.back());
  await waitFor(() => expect(view.getPathname()).toBe("/result/server-one"));
  await act(() => router.back());
  expect(view.getPathname()).toBe("/");
});

it("checks opening a row from the root queue sheet leaves one underlying stack", async () => {
  mockRows = [
    {
      owner: "device:test-installation",
      localId: "one",
      status: "queued",
      cropPath: "crops/one.jpg",
      capturedAt: Date.now(),
    },
  ];
  const view = await renderRouter(
    {
      _layout: {
        default: () => <Stack />,
        unstable_settings: { anchor: "(tabs)" },
      },
      "(tabs)/_layout": () => <Stack />,
      "(tabs)/index": () => <Text>Camera</Text>,
      "(tabs)/result/[scanId]": ResultRoute,
      "(tabs)/label/[scanId]": () => <Text>Label capture</Text>,
      queue: QueueSheet,
    },
    { initialUrl: "/" },
  );
  await act(() => router.push("/queue"));
  await fireEvent.press(await screen.findByRole("button", { name: /Scan from/ }));
  await waitFor(() => expect(view.getPathname()).toBe("/result/local-one"));
  const root = view.getRouterState()!.routes[0].state!;
  expect(root.routes.map((route) => route.name)).toEqual(["(tabs)"]);
});
