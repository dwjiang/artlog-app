import { act, render, waitFor } from "@testing-library/react-native";

import { getSetting, removeSetting, setSetting } from "@/db/repos/settings";
import { anonymousOwner, initializeOwner, switchOwner } from "@/lib/account/owner-store";

import { WelcomePrompt } from "./welcome-prompt";

const mockPush = jest.fn();
const mockRouter = { push: mockPush };
let mockActive = true;
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/hooks/use-screen-active", () => ({
  useScreenActive: () => mockActive,
}));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
let mockJudgesDemo = false;
jest.mock("@/lib/judges-demo", () => ({ isJudgesDemo: () => mockJudgesDemo }));
beforeEach(async () => {
  jest.clearAllMocks();
  mockActive = true;
  mockJudgesDemo = false;
  switchOwner(anonymousOwner());
  await removeSetting("welcome-seen");
  await removeSetting("local-profile-name");
});

it("returns to onboarding on relaunch until the welcome is finished", async () => {
  const first = await render(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/welcome"));
  expect(await getSetting("welcome-seen")).toBeUndefined();
  await first.unmount();
  await render(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
});

it("does not repeat completed onboarding for a guest who left the name blank", async () => {
  await setSetting("welcome-seen", "true");
  await render(<WelcomePrompt />);
  await act(async () => {});
  expect(mockPush).not.toHaveBeenCalled();
});

it("never opens the welcome in the judges' demo build", async () => {
  mockJudgesDemo = true;
  await render(<WelcomePrompt />);
  await act(async () => {});
  expect(mockPush).not.toHaveBeenCalled();
});

it("waits for the active Home screen", async () => {
  mockActive = false;
  const view = await render(<WelcomePrompt />);
  expect(mockPush).not.toHaveBeenCalled();
  mockActive = true;
  await view.rerender(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/welcome"));
});

it("onboards a signed-in account that has not finished the welcome", async () => {
  switchOwner("account:existing");
  await render(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/welcome"));
});

it("does not repeat the welcome for an account that finished it", async () => {
  await setSetting("welcome-seen", "true");
  switchOwner("account:existing");
  await render(<WelcomePrompt />);
  await act(async () => {});
  expect(mockPush).not.toHaveBeenCalled();
});

it("stays closed after signing out, and reopens for the fresh owner after local data is erased", async () => {
  await setSetting("welcome-seen", "true");
  switchOwner("account:existing");
  await render(<WelcomePrompt />);
  await act(async () => {});
  await act(() => switchOwner(anonymousOwner()));
  await act(async () => {});
  expect(mockPush).not.toHaveBeenCalled();
  await removeSetting("welcome-seen");
  await act(() => initializeOwner("erased"));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/welcome"));
});
