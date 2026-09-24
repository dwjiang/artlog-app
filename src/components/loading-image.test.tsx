import { fireEvent, render, screen } from "@testing-library/react-native";
import { LoadingImage } from "./loading-image";
import { reportError } from "@/lib/observability";

jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));

it("keeps the ghost until the image loads and starts a fresh ghost for a changed source", async () => {
  const props = {
    uri: "file:///first.jpg",
    label: "Artwork",
    style: { width: 120, height: 160 },
  };
  const view = await render(<LoadingImage {...props} />);
  expect(
    screen.getByRole("progressbar", { name: "Loading image: Artwork" }),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/Loading/)).toBeNull();
  await fireEvent(screen.getByLabelText("Artwork"), "load", {
    nativeEvent: { source: { width: 120, height: 160 } },
  });
  expect(screen.queryByRole("progressbar")).toBeNull();
  await view.rerender(<LoadingImage {...props} uri="file:///second.jpg" />);
  expect(screen.getByRole("progressbar")).toBeOnTheScreen();
});

it("ends loading on failure, keeps an accessible fallback, and retries a new source", async () => {
  const onError = jest.fn();
  const props = {
    uri: "file:///broken.jpg",
    label: "Artwork",
    style: { width: 120, height: 160 },
    onError,
  };
  const view = await render(<LoadingImage {...props} />);
  await fireEvent(screen.getByLabelText("Artwork"), "error", {
    nativeEvent: { error: "Unavailable" },
  });
  expect(onError).toHaveBeenCalledTimes(1);
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "media.load", {
    level: "warning",
    data: { source: "local" },
  });
  expect(JSON.stringify(jest.mocked(reportError).mock.calls)).not.toContain(
    "file:///broken.jpg",
  );
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(
    screen.getByRole("image", { name: "Artwork: image unavailable" }),
  ).toBeOnTheScreen();
  await view.rerender(
    <LoadingImage {...props} uri="file:///replacement.jpg" />,
  );
  expect(screen.getByRole("progressbar")).toBeOnTheScreen();
});
