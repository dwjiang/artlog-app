import { fireEvent, render, screen } from "@testing-library/react-native";

import { RightNowSection } from "./right-now-section";
import { rightNow } from "./__fixtures__/scan";

const mockOpenBrowser = jest.fn();
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (url: string) => mockOpenBrowser(url),
}));

beforeEach(() => mockOpenBrowser.mockReset().mockResolvedValue(undefined));

it("labels the line as from the web and links its source", async () => {
  await render(<RightNowSection rightNow={rightNow} />);
  expect(screen.getByText("From the web")).toBeOnTheScreen();
  expect(screen.getByText(rightNow.text)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("link", { name: "Example News" }));
  expect(mockOpenBrowser).toHaveBeenCalledWith("https://news.example/monet");
});

it("renders nothing without a card", async () => {
  expect((await render(<RightNowSection />)).toJSON()).toBeNull();
});
