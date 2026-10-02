import { act, render, waitFor } from "@testing-library/react-native";

import { getSetting, removeSetting, setSetting } from "@/db/repos/settings";
import { setLocalProfileName } from "@/lib/account/local-profile";
import { anonymousOwner, switchOwner } from "@/lib/account/owner-store";

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
beforeEach(async () => {
  jest.clearAllMocks();
  mockActive = true;
  switchOwner(anonymousOwner());
  await removeSetting("welcome-seen");
  await removeSetting("local-profile-name");
});

it("returns to onboarding on relaunch until the name has been saved", async () => {
  const first = await render(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/welcome"));
  expect(await getSetting("welcome-seen")).toBeUndefined();
  await first.unmount();
  await render(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
});

it("does not repeat completed onboarding", async () => {
  await setLocalProfileName("Alex");
  await setSetting("welcome-seen", "true");
  await render(<WelcomePrompt />);
  await act(async () => {});
  expect(mockPush).not.toHaveBeenCalled();
});

it("asks for a missing name even when the welcome was previously seen", async () => {
  await setSetting("welcome-seen", "true");
  await render(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/welcome"));
});

it("waits for the active Home screen", async () => {
  mockActive = false;
  const view = await render(<WelcomePrompt />);
  expect(mockPush).not.toHaveBeenCalled();
  mockActive = true;
  await view.rerender(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/welcome"));
});

it("onboards a signed-in account that has not finished the welcome, without needing a name", async () => {
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

it("asks for a name after signing out when none has been saved", async () => {
  await setSetting("welcome-seen", "true");
  switchOwner("account:existing");
  await render(<WelcomePrompt />);
  await act(async () => {});
  expect(mockPush).not.toHaveBeenCalled();
  await act(() => switchOwner(anonymousOwner()));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/welcome"));
});
