import { act, render, waitFor } from "@testing-library/react-native";

import { getSetting, removeSetting } from "@/db/repos/settings";
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
});

it("presents once for a guest before a server session is ready and remembers presentation across remounts", async () => {
  const first = await render(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/welcome"));
  expect(await getSetting("welcome-seen")).toBe("true");
  await first.unmount();
  await render(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
});

it("waits for the active Home screen", async () => {
  mockActive = false;
  const view = await render(<WelcomePrompt />);
  expect(mockPush).not.toHaveBeenCalled();
  mockActive = true;
  await view.rerender(<WelcomePrompt />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/welcome"));
});

it("does not onboard an existing linked account after signing out", async () => {
  switchOwner("account:existing");
  await render(<WelcomePrompt />);
  await waitFor(async () => expect(await getSetting("welcome-seen")).toBe("true"));
  await act(() => switchOwner(anonymousOwner()));
  expect(mockPush).not.toHaveBeenCalled();
});
