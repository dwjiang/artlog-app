import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { CropEditor } from "./crop-editor";

jest.mock("./crop-corners", () => ({ CropCorners: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
jest.mock("../../../modules/vision-rect/src", () => ({
  getVisionRect: () => ({
    detectStill: async () => {
      throw new Error("No detection");
    },
  }),
}));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///documents/${path}`,
}));
jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: {
    manipulate: () => ({
      renderAsync: async () => ({ width: 1200, height: 1600, release() {} }),
      release() {},
    }),
  },
}));
const mockPrepare = jest.fn(),
  mockDiscard = jest.fn();
jest.mock("@/lib/capture/edit-crop", () => ({
  prepareEditedCrop: (...args: unknown[]) => mockPrepare(...args),
  discardEditedCrop: (...args: unknown[]) => mockDiscard(...args),
}));
const crop = {
  modelUri: "model.jpg",
  previewUri: "preview.jpg",
  width: 512,
  height: 400,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockPrepare.mockResolvedValue(crop);
});

it("requires a preview before saving and keeps a failed save available for retry", async () => {
  const onSave = jest
    .fn()
    .mockRejectedValueOnce(new Error("disk failed"))
    .mockResolvedValue(undefined);
  await render(
    <CropEditor photoPath="full.jpg" onSave={onSave} onCancel={jest.fn()} />,
  );
  expect(screen.queryByRole("button", { name: "Save crop" })).toBeNull();
  await fireEvent.press(
    await screen.findByRole("button", { name: "Preview crop" }),
  );
  expect(
    await screen.findByLabelText("Corrected painting preview"),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Save crop" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /Couldn’t save this crop/,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Save crop" }));
  expect(onSave).toHaveBeenCalledTimes(2);
});

it("cancels without saving and removes the temporary preview on unmount", async () => {
  const onSave = jest.fn(),
    onCancel = jest.fn();
  const view = await render(
    <CropEditor photoPath="full.jpg" onSave={onSave} onCancel={onCancel} />,
  );
  await fireEvent.press(
    await screen.findByRole("button", { name: "Preview crop" }),
  );
  await fireEvent.press(await screen.findByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
  await view.unmount();
  expect(mockDiscard).toHaveBeenCalledWith(crop);
});

it("discards the previous preview when returning to the corner controls", async () => {
  await render(
    <CropEditor photoPath="full.jpg" onSave={jest.fn()} onCancel={jest.fn()} />,
  );
  await fireEvent.press(
    await screen.findByRole("button", { name: "Preview crop" }),
  );
  await fireEvent.press(
    await screen.findByRole("button", { name: "Adjust corners" }),
  );
  expect(mockDiscard).toHaveBeenCalledWith(crop);
  expect(screen.queryByRole("button", { name: "Save crop" })).toBeNull();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Preview crop" }),
    ).toBeOnTheScreen(),
  );
});
