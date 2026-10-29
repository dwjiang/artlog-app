import { renderHook, waitFor } from "@testing-library/react-native";

import type { Located } from "@/lib/venue/use-venue";

import { useMyLocationAction } from "./use-my-location";

const mockResolve = jest.fn<Promise<Located>, []>();
const mockChooseCity = jest.fn();
const mockErrorToast = jest.fn();
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ resolve: mockResolve }) }));
jest.mock("./use-explore", () => ({ chooseCity: (...args: unknown[]) => mockChooseCity(...args) }));
jest.mock("@/lib/ui/toast", () => ({
  showToast: jest.fn(),
  showErrorToast: (...args: unknown[]) => mockErrorToast(...args),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("expo-location", () => ({
  useForegroundPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn(), jest.fn(async () => ({}))],
}));

beforeEach(() => {
  for (const mock of [mockResolve, mockChooseCity, mockErrorToast]) mock.mockReset();
});

it("follows the phone again without a message when the fix comes back", async () => {
  mockResolve.mockResolvedValue({ fix: { lat: 37.77, lng: -122.42, at: 0 } });
  const { result } = await renderHook(() => useMyLocationAction({ following: false }));
  expect(result.current.label).toBe("My Location");
  result.current.onPress();
  await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(1));
  expect(mockChooseCity).toHaveBeenCalledWith(undefined);
  expect(mockErrorToast).not.toHaveBeenCalled();
});

it("says so when the phone can’t be located, and follows it again on Retry", async () => {
  mockResolve.mockResolvedValueOnce({ failure: "unavailable" });
  const { result } = await renderHook(() => useMyLocationAction({ following: true }));
  result.current.onPress();
  await waitFor(() =>
    expect(mockErrorToast).toHaveBeenCalledWith("Couldn’t find your location.", expect.any(Function)),
  );

  mockResolve.mockResolvedValueOnce({ fix: { lat: 37.77, lng: -122.42, at: 0 } });
  const [, retry] = mockErrorToast.mock.calls[0] as [string, () => void];
  retry();
  await waitFor(() => expect(mockResolve).toHaveBeenCalledTimes(2));
  expect(mockErrorToast).toHaveBeenCalledTimes(1);
});
