import { Alert } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { scheduleRemoval } from "@/lib/collection/pending-removals";
import { getSavedWork, insertSavedWork } from "@/db/repos/saved-works";
import { SavedWorkToolbar } from "./saved-work-toolbar";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("../../db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/collection/pending-removals", () => ({ scheduleRemoval: jest.fn() }));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
const mockShare = jest.fn(async (_uri: string, _options: object) => {});
jest.mock("expo-sharing", () => ({
  shareAsync: (uri: string, options: object) => mockShare(uri, options),
}));
const mockBack = jest.fn(),
  mockPush = jest.fn();
jest.mock("expo-router", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  const Button = ({
    children,
    accessibilityLabel,
    disabled,
    onPress,
  }: {
    children: string;
    accessibilityLabel?: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
    >
      <Text>{children}</Text>
    </Pressable>
  );
  const Group = ({ children }: { children: unknown }) => <View>{children as never}</View>;
  return {
    useRouter: () => ({ back: mockBack, push: mockPush }),
    Stack: { Toolbar: Object.assign(Group, { Button, Menu: Group, MenuAction: Button }) },
  };
});

beforeAll(async () => {
  await insertSavedWork({
    localId: "plain",
    savedAt: 1,
    title: "Untitled",
    artist: "Unknown",
    cropPath: "crops/plain.jpg",
  });
  await insertSavedWork({ localId: "no-photo", savedAt: 2, title: "Sketch", artist: "Unknown" });
});
beforeEach(() => jest.clearAllMocks());

it("offers an undo window before deletion and returns to the collection", async () => {
  const alert = jest.spyOn(Alert, "alert");
  await render(<SavedWorkToolbar savedId="plain" />);
  await fireEvent.press(await screen.findByRole("button", { name: "Remove from collection" }));
  expect(scheduleRemoval).not.toHaveBeenCalled();
  const confirm = alert.mock.calls.at(-1)?.[2]?.find((button) => button.style === "destructive");
  expect(confirm).toBeDefined();
  confirm?.onPress?.();
  expect(scheduleRemoval).toHaveBeenCalledWith(
    expect.objectContaining({ localId: "plain", title: "Untitled" }),
  );
  expect((await getSavedWork("plain"))?.deletedAt).toBeNull();
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("shares the artwork photo and keeps sharing unavailable without one", async () => {
  const view = await render(<SavedWorkToolbar savedId="plain" />);
  await fireEvent.press(await screen.findByRole("button", { name: "Share artwork" }));
  expect(mockShare).toHaveBeenCalledWith("file:///documents/crops/plain.jpg", {
    dialogTitle: "Untitled",
  });
  await view.rerender(<SavedWorkToolbar savedId="no-photo" />);
  expect(await screen.findByRole("button", { name: "Share artwork" })).toBeDisabled();
});

it("routes editing actions from the overflow menu", async () => {
  await render(<SavedWorkToolbar savedId="plain" visitId="visit-1" />);
  await fireEvent.press(await screen.findByRole("button", { name: "Add photos" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/add-photos",
    params: { draftId: "saved:plain", savedId: "plain", title: "Untitled", visitId: "visit-1" },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Link visit" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/link-artwork",
    params: { savedId: "plain" },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Edit artwork details" }));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/identify-artwork",
    params: { savedId: "plain" },
  });
});
