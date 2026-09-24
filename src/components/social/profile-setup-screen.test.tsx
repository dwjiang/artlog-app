import { fireEvent, render, screen } from "@testing-library/react-native";
import { ConvexError } from "convex/values";
import { chooseProfilePhoto, profilePhotoBytes } from "@/lib/social/profile-photo";
import { ProfileSetupScreen } from "./profile-setup-screen";

const mockCreate = jest.fn(),
  mockSavePhoto = jest.fn(),
  mockBack = jest.fn(),
  mockDismissTo = jest.fn(),
  mockReplace = jest.fn(),
  mockRefresh = jest.fn();
let mockSession: { key: string; status: string; offline: boolean; refresh: () => void };
let mockSuggestion: string | null;
let mockTaken: Set<string>;
let mockMine: { username: string; name: string; photoUrl?: string } | undefined;
jest.mock("convex/react", () => ({
  useMutation: () => mockCreate,
  useAction: () => mockSavePhoto,
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, dismissTo: mockDismissTo, replace: mockReplace }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => mockSession,
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: (query: unknown, args: "skip" | { username?: string }) => {
    if (args === "skip") return { data: undefined, loading: false, refresh: jest.fn() };
    const name = jest.requireActual("convex/server").getFunctionName(query);
    const data =
      name === "profiles:suggestUsername"
        ? mockSuggestion
        : name === "profiles:usernameAvailable"
          ? !mockTaken.has(args.username!)
          : mockMine;
    return { data, loading: false, refresh: jest.fn() };
  },
}));
jest.mock("@/lib/social/profile-photo", () => ({
  chooseProfilePhoto: jest.fn(),
  profilePhotoBytes: jest.fn(),
  removeProfilePhotoDraft: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { key: "account:a", status: "profile-required", offline: false, refresh: mockRefresh };
  mockSuggestion = "alex-morgan";
  mockTaken = new Set();
  mockMine = undefined;
  mockCreate.mockResolvedValue({});
  mockSavePhoto.mockResolvedValue({});
  jest.mocked(chooseProfilePhoto).mockResolvedValue("file:///profile.jpg");
  jest.mocked(profilePhotoBytes).mockResolvedValue(new ArrayBuffer(3));
});

async function continueTo(header: string) {
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("header", { name: header })).toBeOnTheScreen();
}

async function reachPhoto() {
  await screen.findByText("Username available");
  await continueTo("Your name");
  await continueTo("Add a photo");
}

it("claims the suggested username on the first step, then keeps Apple’s name and adds a photo", async () => {
  await render(<ProfileSetupScreen suggestedName="Alex Morgan" />);
  expect(screen.getByText("Step 1 of 3")).toBeOnTheScreen();
  expect(screen.getByLabelText("Username")).toHaveDisplayValue("alex-morgan");
  await screen.findByText("Username available");
  await continueTo("Your name");
  expect(mockCreate).toHaveBeenCalledWith({ name: "Alex Morgan", username: "alex-morgan" });
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(screen.getByLabelText("Name")).toHaveDisplayValue("Alex Morgan");
  await continueTo("Add a photo");
  expect(mockSavePhoto).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Choose photo" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save photo" }));
  expect(mockSavePhoto).toHaveBeenCalledWith({ name: "Alex Morgan", photo: new ArrayBuffer(3) });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("header", { name: "Your profile is ready." })).toBeOnTheScreen();
  expect(screen.getByText("@alex-morgan")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Find friends" }));
  expect(mockDismissTo).toHaveBeenCalledWith("/people");
  expect(mockBack).not.toHaveBeenCalled();
});

it("keeps the person on the username step when the name is taken, then saves a typed display name", async () => {
  mockTaken = new Set(["alex"]);
  mockCreate.mockRejectedValueOnce(new ConvexError({ code: "username_taken" }));
  await render(<ProfileSetupScreen />);
  expect(screen.getByLabelText("Username")).toHaveDisplayValue("");
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Username"), "Alex");
  expect(await screen.findByText("That username is taken. Try another.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Username"), "alex-reads");
  await screen.findByText("Username available");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("header", { name: "Your username" })).toBeOnTheScreen();
  expect(screen.getByRole("alert")).toHaveTextContent("That username is taken. Try another.");
  await fireEvent.changeText(screen.getByLabelText("Username"), "alex-reads-art");
  await screen.findByText("Username available");
  await continueTo("Your name");
  expect(mockCreate).toHaveBeenLastCalledWith({ name: "alex-reads-art", username: "alex-reads-art" });
  expect(screen.getByLabelText("Name")).toHaveDisplayValue("");
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Name"), " Alex ");
  await continueTo("Add a photo");
  expect(mockSavePhoto).toHaveBeenCalledWith({ name: "Alex" });
  await fireEvent.press(screen.getByRole("button", { name: "Skip for now" }));
  expect(screen.getByRole("header", { name: "Your profile is ready." })).toBeOnTheScreen();
  expect(mockSavePhoto).toHaveBeenCalledTimes(1);
});

it("keeps the profile when a photo upload fails and lets setup finish without it", async () => {
  mockSavePhoto.mockRejectedValueOnce(new Error("offline"));
  await render(<ProfileSetupScreen suggestedName="Alex Morgan" />);
  await reachPhoto();
  await fireEvent.press(screen.getByRole("button", { name: "Choose photo" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save photo" }));
  expect(screen.getByRole("alert")).toHaveTextContent("The photo couldn’t upload. Try again or continue without it.");
  await fireEvent.press(screen.getByRole("button", { name: "Continue without photo" }));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("header", { name: "Your profile is ready." })).toBeOnTheScreen();
});

it("waits for sign-in to finish before claiming a username and closes without a profile on Not now", async () => {
  mockSession.status = "loading";
  const view = await render(<ProfileSetupScreen suggestedName="Alex Morgan" />);
  await screen.findByText("Username available");
  const claim = screen.getByRole("button", { name: "Continue" });
  expect(claim).toBeDisabled();
  expect(claim).toHaveAccessibilityValue({ text: "Finishing sign-in…" });
  mockSession = { ...mockSession, status: "profile-required" };
  await view.rerender(<ProfileSetupScreen suggestedName="Alex Morgan" />);
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockCreate).not.toHaveBeenCalled();
});

it("continues a visit share after setup that started from sharing", async () => {
  await render(<ProfileSetupScreen suggestedName="Alex Morgan" visitId="museum-visit" />);
  await reachPhoto();
  await fireEvent.press(screen.getByRole("button", { name: "Skip for now" }));
  await fireEvent.press(screen.getByRole("button", { name: "Continue to sharing" }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/visit-share/[visitId]", params: { visitId: "museum-visit" } });
});

it("shows an existing profile instead of asking for setup again", async () => {
  mockSession.status = "ready";
  mockMine = { username: "alex", name: "Alex Morgan" };
  await render(<ProfileSetupScreen />);
  expect(screen.getByRole("header", { name: "Your profile is ready." })).toBeOnTheScreen();
  expect(screen.getByText("@alex")).toBeOnTheScreen();
  expect(screen.queryByText("Step 1 of 3")).toBeNull();
});
