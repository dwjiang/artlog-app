import { fireEvent, render, screen } from "@testing-library/react-native";

import { bridge, haystacks } from "./__fixtures__/scan";
import { RunnerUps } from "./runner-ups";

it("lists title, artist, year and institution per row and opens the tapped candidate", async () => {
  const onOpen = jest.fn();
  await render(<RunnerUps candidates={[bridge, haystacks]} onOpen={onOpen} />);
  expect(screen.getByText("The Japanese Footbridge")).toBeOnTheScreen();
  expect(screen.getByText("Claude Monet · 1899 · National Gallery of Art")).toBeOnTheScreen();
  expect(screen.getByText("Claude Monet · Art Institute of Chicago")).toBeOnTheScreen();
  expect(screen.getByText("31% confidence")).toBeOnTheScreen();
  expect(screen.getByText("12% confidence")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "The Japanese Footbridge, Claude Monet, 1899, 31% confidence" })).toBe(
    screen.getAllByHintText("Opens a preview without choosing it.")[0],
  );
  await fireEvent.press(screen.getByRole("button", { name: "Haystacks, Claude Monet, 12% confidence" }));
  expect(onOpen).toHaveBeenCalledWith(haystacks);
});

it("shows a museum thumbnail only when the server hotlinked one", async () => {
  await render(<RunnerUps candidates={[bridge, haystacks]} onOpen={jest.fn()} />);
  expect(screen.getByLabelText("Museum image of The Japanese Footbridge").props.source).toEqual([
    { uri: "https://images.example/bridge.jpg" },
  ]);
  expect(screen.queryByLabelText("Museum image of Haystacks")).toBeNull();
});

it("announces the pick being saved and blocks every row meanwhile", async () => {
  const onOpen = jest.fn();
  await render(<RunnerUps candidates={[bridge, haystacks]} onOpen={onOpen} busyObjectId={haystacks.objectId} />);
  const saving = screen.getByRole("button", { name: "Haystacks, Claude Monet, 12% confidence" });
  expect(saving).toBeBusy();
  expect(saving).toBeDisabled();
  const other = screen.getByRole("button", { name: /^The Japanese Footbridge/ });
  expect(other).not.toBeBusy();
  await fireEvent.press(other);
  expect(onOpen).not.toHaveBeenCalled();
});
