import { fireEvent, render, screen } from "@testing-library/react-native";
import { getFunctionName } from "convex/server";

import type { ScanResult } from "@/lib/result/state";

import { EnterDetailsScreen } from "./enter-details-screen";
import { CONFIRM_BUTTON } from "./label/confirm-details-form";
import { missScan, SCAN_ID, softScan } from "./result/__fixtures__/scan";

const mockMutation = jest.fn();
const mockDismissTo = jest.fn();
const mockBack = jest.fn();
let mockScan: ScanResult | Error | undefined;

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ dismissTo: mockDismissTo, back: mockBack }),
  usePreventRemove: () => () => {},
}));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isInternetReachable: true }) }));
jest.mock("@/lib/convex-client", () => ({
  convex: { mutation: (...args: unknown[]) => mockMutation(...args) },
}));
jest.mock("@/lib/result/use-corpus-matches", () => ({ useCorpusMatches: () => ({ matches: [] }) }));
jest.mock("@/lib/result/use-scan", () => ({ useScan: () => mockScan }));

beforeEach(() => {
  jest.resetAllMocks();
  mockMutation.mockResolvedValue(null);
});

function confirmed() {
  const call = mockMutation.mock.calls.find(([fn]) => getFunctionName(fn) === "scans:confirm");
  return call?.[1];
}

it("confirms typed details for an unidentified scan and returns to its result page", async () => {
  mockScan = missScan;
  await render(<EnterDetailsScreen scanId={SCAN_ID} />);
  expect(screen.getByText("Confirm artwork details")).toBeOnTheScreen();
  expect(screen.getByLabelText("Title")).toHaveProp("defaultValue", "");
  expect(screen.getByRole("button", { name: CONFIRM_BUTTON })).toBeDisabled();
  expect(screen.getByText("Add a title to continue.")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Title"), " Ellington, East Yorkshire ");
  await fireEvent.changeText(screen.getByLabelText("Artist"), "Benjamin Haughton");
  await fireEvent.press(screen.getByRole("button", { name: CONFIRM_BUTTON }));
  expect(confirmed()).toEqual({
    scanId: SCAN_ID,
    source: "manual",
    fields: { title: "Ellington, East Yorkshire", artist: "Benjamin Haughton" },
  });
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: "/result/[scanId]", params: { scanId: SCAN_ID } });
});

it("starts from details already confirmed, else from the suggested work", async () => {
  mockScan = {
    ...missScan,
    confirmed: { source: "manual", fields: { title: "Pond at dusk", date: "1890s" }, confirmedAt: 5 },
  };
  const view = await render(<EnterDetailsScreen scanId={SCAN_ID} />);
  expect(screen.getByLabelText("Title")).toHaveProp("defaultValue", "Pond at dusk");
  expect(screen.getByLabelText("Date")).toHaveProp("defaultValue", "1890s");
  await view.unmount();
  mockScan = softScan;
  await render(<EnterDetailsScreen scanId={SCAN_ID} />);
  expect(screen.getByLabelText("Title")).toHaveProp("defaultValue", "The Japanese Footbridge");
  expect(screen.getByLabelText("Artist")).toHaveProp("defaultValue", "Claude Monet");
});

it("waits for the scan and offers a way back when it can't be loaded", async () => {
  mockScan = undefined;
  const view = await render(<EnterDetailsScreen scanId={SCAN_ID} />);
  expect(screen.getByLabelText("Loading the details…")).toBeOnTheScreen();
  mockScan = new Error("Server unavailable");
  await view.rerender(<EnterDetailsScreen scanId={SCAN_ID} />);
  expect(screen.getByText("This scan isn’t available")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
