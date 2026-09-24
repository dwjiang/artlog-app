import { act, render } from "@testing-library/react-native";
import { offerProfileSetup, takeProfileSetupOffer } from "@/lib/account/profile-setup-offer";
import { ProfileSetupPrompt } from "./profile-setup-prompt";

const mockPush = jest.fn();
let mockPathname = "/people";
let mockAccount: { linked: boolean; hasProfile: boolean } | undefined;
jest.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : mockAccount),
}));
jest.mock("expo-router", () => ({
  router: { push: (href: unknown) => mockPush(href) },
  usePathname: () => mockPathname,
}));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => true }));

beforeEach(() => {
  jest.clearAllMocks();
  takeProfileSetupOffer();
  mockPathname = "/people";
  mockAccount = { linked: true, hasProfile: false };
});

it("opens setup after an inline first sign-in and offers it only once", async () => {
  const view = await render(<ProfileSetupPrompt />);
  await act(() => offerProfileSetup({ name: "Alex Morgan" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/create-profile", params: { name: "Alex Morgan" } });
  expect(takeProfileSetupOffer()).toBeUndefined();
  await view.rerender(<ProfileSetupPrompt />);
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it("leaves the sign-in sheet to hand off itself and drops the offer for an existing profile", async () => {
  mockPathname = "/sign-in";
  offerProfileSetup({});
  const view = await render(<ProfileSetupPrompt />);
  expect(mockPush).not.toHaveBeenCalled();
  mockPathname = "/settings";
  mockAccount = { linked: true, hasProfile: true };
  await view.rerender(<ProfileSetupPrompt />);
  expect(mockPush).not.toHaveBeenCalled();
  expect(takeProfileSetupOffer()).toBeUndefined();
});
