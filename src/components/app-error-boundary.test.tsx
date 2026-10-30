import { fireEvent, render, screen } from "@testing-library/react-native";

import { reportError } from "@/lib/observability";

import { AppErrorBoundary } from "./app-error-boundary";

jest.mock("@/lib/observability", () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock("@/components/collection/gallery-button", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    GalleryButton: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

it("reports a screen crash and lets the visitor retry without exposing raw error details", async () => {
  const error = new Error("internal query and private arguments");
  const retry = jest.fn().mockResolvedValue(undefined);
  const view = await render(<AppErrorBoundary error={error} retry={retry} />);
  expect(reportError).toHaveBeenCalledWith(error, "app.render", { alwaysReport: "all" });
  expect(screen.getByRole("alert")).toHaveTextContent("Artlog could not open this screen");
  expect(screen.queryByText(error.message)).toBeNull();
  await view.rerender(<AppErrorBoundary error={error} retry={retry} />);
  expect(reportError).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
