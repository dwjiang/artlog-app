import { fireEvent, render, screen } from "@testing-library/react-native";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { WallProfileSheet } from "./wall-profile-sheet";

const mockCreate = jest.fn();
jest.mock("@/lib/social/use-social-session", () => ({
  useSocialSession: () => ({ key: "account:test", status: "ready" }),
}));
jest.mock("@/lib/social/use-social-query", () => ({
  useSocialQuery: () => ({ data: true }),
}));
jest.mock("convex/react", () => ({
  useMutation: () => mockCreate,
  useAction: () => jest.fn(),
}));
jest.mock("./wall-sheet", () => ({
  WallSheet: ({ children }: { children: ReactNode }) => children,
}));

beforeEach(() => jest.clearAllMocks());

it("creates a profile only after submission and normalizes the name and username", async () => {
  const onCreated = jest.fn();
  mockCreate.mockResolvedValue({});
  await render(
    <WallProfileSheet onCreated={onCreated} onDismiss={jest.fn()} />,
  );
  expect(
    screen.getByRole("button", { name: "Create public profile" }),
  ).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Name"), "  Alex Chen  ");
  await fireEvent.changeText(screen.getByLabelText("Username"), " Alex-Chen ");
  expect(mockCreate).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole("button", { name: "Create public profile" }),
  );
  expect(mockCreate).toHaveBeenCalledWith({
    name: "Alex Chen",
    username: "alex-chen",
    bio: "",
  });
  expect(onCreated).toHaveBeenCalledTimes(1);
});

it("keeps entered profile details when a username is taken", async () => {
  const onCreated = jest.fn();
  mockCreate.mockRejectedValue(new ConvexError({ code: "username_taken" }));
  await render(
    <WallProfileSheet onCreated={onCreated} onDismiss={jest.fn()} />,
  );
  await fireEvent.changeText(screen.getByLabelText("Name"), "Alex");
  await fireEvent.changeText(screen.getByLabelText("Username"), "alex");
  await fireEvent.press(
    screen.getByRole("button", { name: "Create public profile" }),
  );
  expect(
    await screen.findByText("That username is already taken."),
  ).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  expect(onCreated).not.toHaveBeenCalled();
});
