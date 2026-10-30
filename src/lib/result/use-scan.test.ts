import { renderHook } from "@testing-library/react-native";

import { reportIfStalled } from "@/lib/stall-report";

import type { Id } from "../../../convex/_generated/dataModel";
import { useScan } from "./use-scan";

let mockScan: unknown;
let mockNetwork = { isConnected: true, isInternetReachable: true };
let mockWatched: Promise<unknown> | undefined;

jest.mock("convex/react", () => ({ useQueries: () => ({ scan: mockScan }) }));
jest.mock("expo-network", () => ({ useNetworkState: () => mockNetwork }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));
jest.mock("@/lib/convex-connection", () => ({ connectionDiagnostics: () => ({ ws_connected: false }) }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/stall-report", () => ({
  reportIfStalled: jest.fn((task: Promise<unknown>) => {
    mockWatched = task;
    return task;
  }),
}));

const scanId = "scan-1" as Id<"scans">;

beforeEach(() => {
  jest.clearAllMocks();
  mockScan = undefined;
  mockWatched = undefined;
  mockNetwork = { isConnected: true, isInternetReachable: true };
});

it("watches a scan that has not arrived while online, and stops once it does", async () => {
  const hook = await renderHook(() => useScan(scanId));
  expect(reportIfStalled).toHaveBeenCalledWith(expect.any(Promise), "result.load_scan_stalled", 10_000, {
    requiresNetwork: true,
    data: expect.any(Function),
  });
  const data = jest.mocked(reportIfStalled).mock.calls[0][3]!.data!;
  expect(data()).toEqual({ device_ready: true, ws_connected: false });
  let settled = false;
  void mockWatched!.then(() => {
    settled = true;
  });
  mockScan = { status: "identified" };
  await hook.rerender(undefined);
  await Promise.resolve();
  expect(settled).toBe(true);
});

it("does not watch while offline, where waiting is expected", async () => {
  mockNetwork = { isConnected: false, isInternetReachable: false };
  await renderHook(() => useScan(scanId));
  expect(reportIfStalled).not.toHaveBeenCalled();
});
