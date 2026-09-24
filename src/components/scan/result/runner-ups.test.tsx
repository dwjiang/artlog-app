import { fireEvent, render, screen } from "@testing-library/react-native";

import { RunnerUps } from "./runner-ups";
import { bridge, haystacks } from "./__fixtures__/scan";

it("lists title, artist and institution per row and reports the tapped candidate", async () => {
  const onPick = jest.fn();
  await render(<RunnerUps candidates={[bridge, haystacks]} onPick={onPick} />);
  expect(screen.getByText("The Japanese Footbridge")).toBeOnTheScreen();
  expect(
    screen.getByText("Claude Monet · National Gallery of Art"),
  ).toBeOnTheScreen();
  expect(
    screen.getByText("Claude Monet · Art Institute of Chicago"),
  ).toBeOnTheScreen();
  expect(screen.getByText("31% confidence")).toBeOnTheScreen();
  expect(screen.getByText("12% confidence")).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole("button", {
      name: "Haystacks, Claude Monet, 12% confidence",
    }),
  );
  expect(onPick).toHaveBeenCalledWith(haystacks);
});

it("shows a museum thumbnail only when the server hotlinked one", async () => {
  await render(
    <RunnerUps candidates={[bridge, haystacks]} onPick={jest.fn()} />,
  );
  expect(
    screen.getByLabelText("Museum image of The Japanese Footbridge").props
      .source,
  ).toEqual([{ uri: "https://images.example/bridge.jpg" }]);
  expect(screen.queryByLabelText("Museum image of Haystacks")).toBeNull();
});
