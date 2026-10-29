import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { confidentScan, failedScan, missScan, softScan } from "@/components/scan/result/__fixtures__/scan";
import { db } from "@/db/client";
import { cacheOfflineResult } from "@/db/repos/offline-scan-results";
import { offlineScanResults, pendingScans, type PendingScan } from "@/db/schema";
import type { PhotoSessionDraft } from "@/lib/capture/photo-draft";
import type { ScanResult } from "@/lib/result/state";
import { useScan } from "@/lib/result/use-scan";

import { QueueRow, RETRY_ROW, queueStatusText } from "./queue-row";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

let mockScan: ScanResult | Error | undefined;
let mockSession: PhotoSessionDraft;
jest.mock("@/lib/result/use-scan", () => ({
  useScan: jest.fn((scanId?: string) => (scanId ? mockScan : undefined)),
}));

jest.mock("@/lib/files/photos", () => ({
  ...jest.requireActual("@/lib/files/photos"),
  scanDisplayPath: jest.requireActual("@/lib/files/photos").scanPreviewPath,
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));

jest.mock("@/lib/capture/photo-draft", () => ({
  readPhotoSession: () => mockSession,
}));

const now = new Date(2026, 8, 11, 12, 0, 0).getTime();
const row: PendingScan = {
  owner: "device:test-installation",
  localId: "cap-1",
  photoPath: "photos/cap-1.jpg",
  cropPath: "crops/cap-1.jpg",
  cropCorners: null,
  modelCropGeometry: null,
  savedPhotoLocalId: null,
  vector: [0.1],
  descriptors: new ArrayBuffer(0),
  keypoints: new ArrayBuffer(0),
  modelVersion: "m",
  venueId: null,
  visitId: null,
  visitLocalId: null,
  capturedAt: now - 5 * 60_000,
  labelPhotoPath: null,
  qrUrl: null,
  status: "queued",
  attemptModelVersion: "m",
  attempts: 0,
  lastError: null,
  scanId: null,
  createdAt: now,
};
const handlers = {
  onOpen: jest.fn(),
  onRetry: jest.fn(),
  onDiscard: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  db.delete(offlineScanResults).run();
  db.delete(pendingScans).run();
  mockScan = undefined;
  mockSession = { photos: [] };
});

it.each([
  ["queued", "Waiting for signal"],
  ["identifying", "Identifying…"],
  ["failed", "Couldn’t identify"],
] as const)("describes a %s row", async (status, text) => {
  expect(queueStatusText(status)).toBe(text);
  await render(<QueueRow item={{ ...row, status }} now={now} {...handlers} />);
  expect(status === "identifying" ? screen.getByLabelText(text) : screen.getByText(text)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: `Artwork scan, Scan from 5 min ago, ${text}` })).toBeOnTheScreen();
  expect(screen.getByText("5 min ago · 1 photo")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Label attached")).toBeNull();
});

it("keeps completed scans accessible and resumable without a status chip", async () => {
  const identified = { ...row, status: "identified" as const };
  await render(<QueueRow item={identified} now={now} {...handlers} />);
  expect(screen.queryByText("Ready to save")).toBeNull();
  expect(screen.getByText("Artwork scan")).toBeOnTheScreen();
  expect(screen.getByText("5 min ago · 1 photo")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Artwork scan, Scan from 5 min ago, Ready to save" }));
  expect(handlers.onOpen).toHaveBeenCalledWith(identified);
});

it("shows the identified artwork's artist and date without the museum", async () => {
  mockScan = confidentScan;
  await render(
    <QueueRow item={{ ...row, status: "identified", scanId: confidentScan.scanId }} now={now} {...handlers} />,
  );
  expect(await screen.findByText("Claude Monet · 1916")).toBeOnTheScreen();
  expect(screen.getByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.queryByText("Metropolitan Museum of Art")).toBeNull();
  expect(
    screen.getByRole("button", {
      name: "Water Lilies, Claude Monet · 1916, Scan from 5 min ago, Ready to save",
    }),
  ).toBeOnTheScreen();
  expect(screen.queryByText("Possible match")).toBeNull();
});

it("uses edited details and omits empty fields without falling back to recognition", async () => {
  mockScan = confidentScan;
  mockSession = {
    photos: [],
    saveInput: {
      capture: row,
      draft: { title: " My study ", artist: "  ", date: " 2026 ", institution: " ", medium: "" },
    },
  };
  await render(
    <QueueRow item={{ ...row, status: "identified", scanId: confidentScan.scanId }} now={now} {...handlers} />,
  );
  expect(await screen.findByText("My study")).toBeOnTheScreen();
  expect(screen.getByText("2026")).toBeOnTheScreen();
  expect(screen.queryByText("Claude Monet · 1916")).toBeNull();
  expect(screen.queryByText("Metropolitan Museum of Art")).toBeNull();
});

it("shows the cached local match while a scan waits for signal", async () => {
  db.insert(pendingScans).values(row).run();
  await cacheOfflineResult(row.localId, confidentScan, row.owner);
  await render(<QueueRow item={row} now={now} {...handlers} />);
  expect(await screen.findByText("Claude Monet · 1916")).toBeOnTheScreen();
  expect(screen.getByText("Water Lilies")).toBeOnTheScreen();
  expect(screen.getByText("Waiting for signal")).toBeOnTheScreen();
});

it("distinguishes a possible match from an identified artwork", async () => {
  mockScan = softScan;
  await render(<QueueRow item={{ ...row, status: "identified", scanId: softScan.scanId }} now={now} {...handlers} />);
  expect(await screen.findByText("Possible match")).toBeOnTheScreen();
  expect(screen.getByText("Claude Monet · 1899")).toBeOnTheScreen();
});

it.each([
  { source: "manual", scan: softScan },
  { source: "label", scan: softScan },
  { source: "manual", scan: missScan },
  { source: "label", scan: missScan },
] as const)("shows $source confirmed details after a $scan.outcome result", async ({ source, scan }) => {
  mockScan = {
    ...scan,
    confirmed: {
      source,
      fields: { title: "The Starry Night", artist: "Vincent van Gogh", date: "1889" },
      confirmedAt: 1,
    },
  };
  await render(<QueueRow item={{ ...row, status: "identified", scanId: scan.scanId }} now={now} {...handlers} />);
  expect(await screen.findByText("The Starry Night")).toBeOnTheScreen();
  expect(screen.getByText("Vincent van Gogh · 1889")).toBeOnTheScreen();
  expect(screen.queryByText("The Japanese Footbridge")).toBeNull();
  expect(screen.queryByText("Possible match")).toBeNull();
});

it.each([missScan, failedScan, null, new Error("Unavailable")])(
  "keeps the scan usable when no reliable artwork details are available (%#)",
  async (scan) => {
    mockScan = scan;
    await render(
      <QueueRow item={{ ...row, status: "identified", scanId: confidentScan.scanId }} now={now} {...handlers} />,
    );
    await waitFor(() => expect(useScan).toHaveBeenCalledWith(confidentScan.scanId));
    expect(screen.getByText("Artwork scan")).toBeOnTheScreen();
    expect(screen.queryByText("Haystacks")).toBeNull();
    expect(screen.queryByText("Possible match")).toBeNull();
    expect(screen.getByText("5 min ago · 1 photo")).toBeOnTheScreen();
  },
);

it("opens the card from the row and shows the crop", async () => {
  await render(<QueueRow item={row} now={now} {...handlers} />);
  await fireEvent.press(
    screen.getByRole("button", {
      name: "Artwork scan, Scan from 5 min ago, Waiting for signal",
    }),
  );
  expect(handlers.onOpen).toHaveBeenCalledWith(row);
  expect(handlers.onRetry).not.toHaveBeenCalled();
});

it("opens a failed row and retries only from its menu action", async () => {
  const failed = {
    ...row,
    status: "failed" as const,
    lastError: "bad_features",
  };
  await render(<QueueRow item={failed} now={now} {...handlers} />);
  await fireEvent.press(
    screen.getByRole("button", {
      name: "Artwork scan, Scan from 5 min ago, Couldn’t identify",
    }),
  );
  expect(handlers.onOpen).toHaveBeenCalledWith(failed);
  expect(handlers.onRetry).not.toHaveBeenCalled();
  handlers.onOpen.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: RETRY_ROW }));
  expect(handlers.onRetry).toHaveBeenCalledWith(failed);
  expect(handlers.onOpen).not.toHaveBeenCalled();
});

it.each([
  ["a label photo", { labelPhotoPath: "labels/cap-1.jpg" }],
  ["a decoded QR code", { qrUrl: "https://museum.example/object/1" }],
])("marks a row that carries %s", async (_what, label) => {
  await render(<QueueRow item={{ ...row, ...label }} now={now} {...handlers} />);
  expect(screen.getByLabelText("Label attached")).toBeOnTheScreen();
});
