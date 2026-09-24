import { render } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { MuseumDownloadLifecycle } from "./use-museum-downloads";

const mockPauseAll = jest.fn(async () => {});
jest.mock("./storage", () => ({
  museumDownloads: { pauseAll: () => mockPauseAll() },
}));
jest.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: jest.fn() }),
}));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => false }));

it("keeps transfers running through Control Center and similar interruptions, and pauses them in the background", async () => {
  let onChange!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    onChange = listener;
    return { remove: jest.fn() };
  });
  await render(<MuseumDownloadLifecycle />);
  onChange("inactive");
  expect(mockPauseAll).not.toHaveBeenCalled();
  onChange("background");
  expect(mockPauseAll).toHaveBeenCalledTimes(1);
});
