import { act, fireEvent, render, screen, within } from "@testing-library/react-native";

import { DocentSection } from "./docent-section";

const mockOpenBrowser = jest.fn();

jest.mock("expo-web-browser", () => ({ openBrowserAsync: (url: string) => mockOpenBrowser(url) }));

const docent = [
  { sentence: "Monet painted this pond at Giverny in 1916.", factIds: ["f1", "f2", "f3"] },
  { sentence: "It entered the collection in 1959.", factIds: ["missing"] },
];
const factSheet = [
  { id: "f1", sourceUrl: "https://www.wikidata.org/wiki/Q1", sourceLabel: "Wikidata" },
  { id: "f2", sourceUrl: "https://museum.example/lilies", sourceLabel: "Test Museum" },
  { id: "f3", sourceUrl: "https://museum.example/lilies", sourceLabel: "Test Museum" },
];

beforeEach(() => {
  mockOpenBrowser.mockReset();
  mockOpenBrowser.mockResolvedValue(undefined);
});

it("lists each cited page once, in citation order, and opens it on tap", async () => {
  await render(<DocentSection docent={docent} factSheet={factSheet} />);
  expect(screen.getByText("Monet painted this pond at Giverny in 1916.")).toBeOnTheScreen();
  expect(screen.getByText("It entered the collection in 1959.")).toBeOnTheScreen();
  expect(screen.getAllByRole("link").map((link) => link.props.accessibilityLabel)).toEqual([
    "Wikidata",
    "Test Museum",
  ]);
  await fireEvent.press(screen.getByRole("link", { name: "Test Museum" }));
  expect(mockOpenBrowser).toHaveBeenCalledWith("https://museum.example/lilies");
});

it("marks only the last sentence of each run that rests on the same pages", async () => {
  const sentences = ["One.", "Two.", "Three.", "Four."];
  await render(
    <DocentSection
      docent={[
        { sentence: "One.", factIds: ["f2"] },
        { sentence: "Two.", factIds: ["f3"] },
        { sentence: "Three.", factIds: ["f1"] },
        { sentence: "Four.", factIds: ["f2"] },
      ]}
      factSheet={factSheet}
    />,
  );
  const paragraph = screen.getByLabelText(
    "One. Two. Source: Test Museum. Three. Source: Wikidata. Four. Source: Test Museum.",
  );
  for (const sentence of sentences) {
    expect(within(paragraph).getByText(sentence)).toBeOnTheScreen();
  }
  const markers = within(paragraph)
    .getAllByText(/^\d+$/, { includeHiddenElements: true })
    .map((marker) => marker.props.children);
  expect(markers).toEqual([1, 2, 1]);
  expect(screen.getAllByRole("link").map((link) => link.props.accessibilityLabel)).toEqual([
    "Test Museum",
    "Wikidata",
  ]);
});

it("renders nothing without sentences", async () => {
  const empty = await render(<DocentSection docent={[]} factSheet={factSheet} />);
  expect(empty.toJSON()).toBeNull();
  const pending = await render(<DocentSection />);
  expect(pending.toJSON()).toBeNull();
});

describe("while the backend is still writing", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows the writing line under the title until the sentences arrive", async () => {
    const view = await render(<DocentSection title="About this work" pending />);
    expect(screen.getByText("About this work")).toBeOnTheScreen();
    expect(screen.getByLabelText("Loading artwork information…")).toBeOnTheScreen();
    await view.rerender(
      <DocentSection
        title="About this work"
        pending={false}
        docent={docent}
        factSheet={factSheet}
      />,
    );
    expect(screen.queryByLabelText("Loading artwork information…")).toBeNull();
    expect(screen.getByText("Monet painted this pond at Giverny in 1916.")).toBeOnTheScreen();
  });

  it("explains unavailable background information after ten seconds", async () => {
    await render(<DocentSection title="About this work" pending />);
    await act(() => {
      jest.advanceTimersByTime(9_999);
    });
    expect(screen.getByLabelText("Loading artwork information…")).toBeOnTheScreen();
    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByLabelText("Loading artwork information…")).toBeNull();
    expect(
      screen.getByText("Background information isn’t available for this work yet."),
    ).toBeOnTheScreen();
  });
});

it("keeps the source visible and explains a browser failure", async () => {
  mockOpenBrowser.mockRejectedValueOnce(new Error("Unavailable"));
  await render(<DocentSection docent={docent} factSheet={factSheet} />);
  await fireEvent.press(screen.getByRole("link", { name: "Test Museum" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn’t open this source\./);
  await fireEvent.press(screen.getByRole("link", { name: "Test Museum" }));
  expect(screen.queryByRole("alert")).toBeNull();
});
