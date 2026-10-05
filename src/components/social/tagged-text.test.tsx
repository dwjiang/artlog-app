import { fireEvent, render, screen } from "@testing-library/react-native";

import { TaggedText } from "./tagged-text";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

beforeEach(() => mockPush.mockClear());

it("links each tag to its page and leaves the rest as text", async () => {
  await render(<TaggedText>{"First #SketchSunday of the fall. #monet"}</TaggedText>);
  expect(screen.getAllByRole("link").map((link) => link.props.children)).toEqual(["#SketchSunday", "#monet"]);
  expect(screen.getByText(/of the fall\./)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("link", { name: "#SketchSunday" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/tag/[tag]", params: { tag: "sketchsunday" } });
});

it("runs the host's close step before opening the tag", async () => {
  const order: string[] = [];
  mockPush.mockImplementation(() => order.push("push"));
  await render(<TaggedText onOpenTag={() => order.push("close")}>{"#monet"}</TaggedText>);
  await fireEvent.press(screen.getByRole("link", { name: "#monet" }));
  expect(order).toEqual(["close", "push"]);
});

it("leaves a long press to text selection instead of opening the tag", async () => {
  await render(<TaggedText>{"#monet"}</TaggedText>);
  await fireEvent(screen.getByRole("link", { name: "#monet" }), "longPress");
  expect(mockPush).not.toHaveBeenCalled();
});

it("adds no links to text without tags", async () => {
  await render(<TaggedText>{"Gallery #243 and a#b"}</TaggedText>);
  expect(screen.queryAllByRole("link")).toEqual([]);
  expect(screen.getByText("Gallery #243 and a#b")).toBeOnTheScreen();
});
