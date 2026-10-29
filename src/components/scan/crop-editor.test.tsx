import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ComponentProps, ReactNode } from "react";

import { wholePhoto } from "@/lib/capture/crop-geometry";
import type { Quad } from "@/lib/capture/stages";

import type { CropCorners } from "./crop-corners";
import { CropEditor } from "./crop-editor";

let mockCropProps: ComponentProps<typeof CropCorners> | undefined;
jest.mock("./crop-corners", () => ({
  CropCorners: (props: ComponentProps<typeof CropCorners>) => {
    mockCropProps = props;
    return null;
  },
}));
const mockHeaderRender = jest.fn();
const mockNavigation = { setOptions: jest.fn() };
jest.mock("expo-router", () => {
  const { mockStack } = jest.requireActual("@/components/stack-toolbar-mock");
  function Toolbar(props: { children: ReactNode }) {
    mockHeaderRender();
    return mockStack.Toolbar(props);
  }
  Toolbar.Button = mockStack.Toolbar.Button;
  return { useNavigation: () => mockNavigation, Stack: { ...mockStack, Toolbar } };
});
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116, useIsFocused: () => true }));
const mockToast = jest.fn();
jest.mock("@/lib/ui/toast", () => ({
  showErrorToast: (...args: unknown[]) => mockToast(...args),
  useLiftToasts: () => {},
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0 }),
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
const mockPrepare = jest.fn();
const mockDiscard = jest.fn();
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
  mockCropProps = undefined;
  mockPrepare.mockResolvedValue(crop);
});

it("saves the whole photo when the corners are left alone and removes the temporary crop", async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  await render(<CropEditor photoPath="full.jpg" onSave={onSave} onCancel={jest.fn()} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Save crop" }));
  await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith(crop));
  expect(mockPrepare).toHaveBeenCalledWith("full.jpg", wholePhoto);
  expect(onSave).toHaveBeenCalledWith(crop, expect.any(Function));
});

it("starts from the stored crop, and from the whole photo when the stored corners are unusable", async () => {
  const stored: Quad = [
    [0.1, 0.2],
    [0.9, 0.2],
    [0.9, 0.8],
    [0.1, 0.8],
  ];
  const onSave = jest.fn().mockResolvedValue(undefined);
  const view = await render(
    <CropEditor photoPath="full.jpg" initialCorners={stored} onSave={onSave} onCancel={jest.fn()} />,
  );
  await fireEvent.press(await screen.findByRole("button", { name: "Save crop" }));
  await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("full.jpg", stored));
  await view.unmount();
  const outOfFrame: Quad = [
    [-0.2, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  await render(<CropEditor photoPath="full.jpg" initialCorners={outOfFrame} onSave={onSave} onCancel={jest.fn()} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Save crop" }));
  await waitFor(() => expect(mockPrepare).toHaveBeenLastCalledWith("full.jpg", wholePhoto));
});

it("explains a failed save in a toast and saves again from the button", async () => {
  const onSave = jest.fn().mockRejectedValueOnce(new Error("disk failed")).mockResolvedValue(undefined);
  await render(<CropEditor photoPath="full.jpg" onSave={onSave} onCancel={jest.fn()} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Save crop" }));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/^Couldn’t save this crop\./)));
  expect(mockDiscard).toHaveBeenCalledWith(crop);
  await fireEvent.press(screen.getByRole("button", { name: "Save crop" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
});

it("keeps the header out of the editor's own re-renders", async () => {
  await render(<CropEditor photoPath="full.jpg" onSave={jest.fn()} onCancel={jest.fn()} />);
  await screen.findByRole("button", { name: "Save crop" });
  expect(mockHeaderRender).toHaveBeenCalledTimes(1);
});

it("hides the back button only while the editor is open", async () => {
  const view = await render(<CropEditor photoPath="full.jpg" onSave={jest.fn()} onCancel={jest.fn()} />);
  await screen.findByRole("button", { name: "Save crop" });
  expect(mockNavigation.setOptions).toHaveBeenLastCalledWith({ headerBackVisible: false });
  await view.unmount();
  expect(mockNavigation.setOptions).toHaveBeenLastCalledWith({ headerBackVisible: undefined });
});

it("cancels without saving", async () => {
  const onSave = jest.fn();
  const onCancel = jest.fn();
  await render(<CropEditor photoPath="full.jpg" onSave={onSave} onCancel={onCancel} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});

it.each(["release", "cancel"] as const)("blocks saving until every crop drag ends: %s", async (finish) => {
  await render(<CropEditor photoPath="full.jpg" onSave={jest.fn()} onCancel={jest.fn()} />);
  await screen.findByRole("button", { name: "Save crop" });
  await fireEvent(screen.getByTestId("crop-stage"), "layout", {
    nativeEvent: { layout: { width: 390, height: 700 } },
  });
  expect(mockCropProps).toBeDefined();

  await act(() => {
    mockCropProps!.onDragStart!();
    mockCropProps!.onDragStart!();
  });
  expect(screen.getByRole("button", { name: "Save crop" })).toBeDisabled();
  await act(() => mockCropProps!.onDragEnd!());
  expect(screen.getByRole("button", { name: "Save crop" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Save crop" }));
  expect(mockPrepare).not.toHaveBeenCalled();

  const adjusted: Quad = [
    [0.1, 0.2],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  await act(() => {
    if (finish === "release") mockCropProps!.onChange(adjusted);
    mockCropProps!.onDragEnd!();
  });
  expect(screen.getByRole("button", { name: "Save crop" })).toBeEnabled();
  await fireEvent.press(screen.getByRole("button", { name: "Save crop" }));
  await waitFor(() =>
    expect(mockPrepare).toHaveBeenCalledWith("full.jpg", finish === "release" ? adjusted : wholePhoto),
  );
});
