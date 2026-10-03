import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { Ref } from "react";

import { reportError } from "@/lib/observability";

import { TapToFocusCamera } from "./tap-to-focus-camera";

const mockFocusTo = jest.fn(async () => {});
const mockResetFocus = jest.fn(async () => {});
let mockSubjectAreaChanged: (() => void) | undefined;

jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

jest.mock("react-native-vision-camera", () => ({
  Camera: ({ ref, onSubjectAreaChanged }: { ref: Ref<unknown>; onSubjectAreaChanged?: () => void }) => {
    mockSubjectAreaChanged = onSubjectAreaChanged;
    jest
      .requireActual<typeof import("react")>("react")
      .useImperativeHandle(ref, () => ({ focusTo: mockFocusTo, resetFocus: mockResetFocus }));
    return null;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

async function tap(x: number, y: number) {
  await fireEvent.press(screen.getByTestId("camera-preview"), { nativeEvent: { locationX: x, locationY: y } });
}

function pendingFocus() {
  let reject!: (error: Error) => void;
  mockFocusTo.mockImplementationOnce(
    () =>
      new Promise<void>((_, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  return { reject: (error: Error) => reject(error) };
}

it("focuses where the preview is tapped and holds that point", async () => {
  await render(<TapToFocusCamera device="back" isActive />);

  await tap(120, 340);

  expect(mockFocusTo).toHaveBeenCalledWith({ x: 120, y: 340 }, { autoResetAfter: null });
});

it("ignores taps while the camera is stopped", async () => {
  await render(<TapToFocusCamera device="back" isActive={false} />);

  await tap(120, 340);

  expect(mockFocusTo).not.toHaveBeenCalled();
});

it("returns to automatic focus once the view moves on from a tapped point", async () => {
  await render(<TapToFocusCamera device="back" isActive />);

  await act(() => mockSubjectAreaChanged?.());
  expect(mockResetFocus).not.toHaveBeenCalled();

  await tap(120, 340);
  await act(() => mockSubjectAreaChanged?.());
  expect(mockResetFocus).toHaveBeenCalledTimes(1);

  await act(() => mockSubjectAreaChanged?.());
  expect(mockResetFocus).toHaveBeenCalledTimes(1);
});

it("restores continuous autofocus when the current metering request times out", async () => {
  mockFocusTo.mockRejectedValueOnce(new Error("The metering operation has timeouted!"));
  await render(<TapToFocusCamera device="back" isActive />);

  await tap(120, 340);

  expect(mockResetFocus).toHaveBeenCalledTimes(1);
  expect(reportError).not.toHaveBeenCalled();
  await act(() => mockSubjectAreaChanged?.());
  expect(mockResetFocus).toHaveBeenCalledTimes(1);
});

it("ignores a native metering cancellation without resetting or reporting it", async () => {
  mockFocusTo.mockRejectedValueOnce(new Error("The metering operation has been canceled!"));
  await render(<TapToFocusCamera device="back" isActive />);

  await tap(120, 340);

  expect(mockResetFocus).not.toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
});

it.each(["The metering operation has been canceled!", "The metering operation has timeouted!"])(
  "keeps a newer tap focused when an earlier request rejects: %s",
  async (message) => {
    const first = pendingFocus();
    await render(<TapToFocusCamera device="back" isActive />);
    await tap(120, 340);
    await tap(240, 180);

    await act(() => first.reject(new Error(message)));

    expect(mockResetFocus).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    await act(() => mockSubjectAreaChanged?.());
    expect(mockResetFocus).toHaveBeenCalledTimes(1);
  },
);

it("does not reset again when a subject-area reset cancels pending metering", async () => {
  const request = pendingFocus();
  await render(<TapToFocusCamera device="back" isActive />);
  await tap(120, 340);
  await act(() => mockSubjectAreaChanged?.());

  await act(() => request.reject(new Error("The metering operation has been canceled!")));

  expect(mockResetFocus).toHaveBeenCalledTimes(1);
  expect(reportError).not.toHaveBeenCalled();
});

it("ignores a pending timeout after the camera stops and restarts", async () => {
  const request = pendingFocus();
  const { rerender } = await render(<TapToFocusCamera device="back" isActive />);
  await tap(120, 340);
  await rerender(<TapToFocusCamera device="back" isActive={false} />);
  await rerender(<TapToFocusCamera device="back" isActive />);

  await act(() => request.reject(new Error("The metering operation has timeouted!")));

  expect(mockResetFocus).not.toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
});

it("ignores a pending failure after unmounting", async () => {
  const request = pendingFocus();
  const { unmount } = await render(<TapToFocusCamera device="back" isActive />);
  await tap(120, 340);
  await unmount();

  await act(() => request.reject(new Error("Camera is not yet ready!")));

  expect(mockResetFocus).not.toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
});

it("reports unexpected metering errors and restores automatic focus", async () => {
  const error = new Error("Could not lock camera configuration");
  mockFocusTo.mockRejectedValueOnce(error);
  await render(<TapToFocusCamera device="back" isActive />);

  await tap(120, 340);

  expect(reportError).toHaveBeenCalledWith(error, "camera.focus");
  expect(mockResetFocus).toHaveBeenCalledTimes(1);
});

it("reports a failed automatic-focus reset without rejecting the interaction", async () => {
  const error = new Error("Could not reset focus");
  mockFocusTo.mockRejectedValueOnce(new Error("The metering operation has timeouted!"));
  mockResetFocus.mockRejectedValueOnce(error);
  await render(<TapToFocusCamera device="back" isActive />);

  await tap(120, 340);

  expect(reportError).toHaveBeenCalledWith(error, "camera.reset_focus");
});
