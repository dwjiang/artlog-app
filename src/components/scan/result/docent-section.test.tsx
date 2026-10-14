import { act, fireEvent, render, screen, within } from "@testing-library/react-native";

import { DOCENT_FAILED, DOCENT_RETRY, DOCENT_WAIT_MS, DocentSection } from "./docent-section";

const mockOpenBrowser = jest.fn();
const mockReportError = jest.fn();
const mockToast = jest.fn();
let mockActive = true;

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (url: string) => mockOpenBrowser(url),
}));
jest.mock("@/hooks/use-screen-active", () => ({ useScreenActive: () => mockActive }));
jest.mock("@/lib/ui/toast", () => ({
  showErrorToast: (...args: unknown[]) => mockToast(...args),
}));
jest.mock("@/lib/observability", () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

const docent = [
  {
    sentence: "Monet painted this pond at Giverny in 1916.",
    factIds: ["f1", "f2", "f3"],
  },
  { sentence: "It entered the collection in 1959.", factIds: ["missing"] },
];
const factSheet = [
  {
    id: "f1",
    sourceUrl: "https://www.wikidata.org/wiki/Q1",
    sourceLabel: "Wikidata",
  },
  {
    id: "f2",
    sourceUrl: "https://museum.example/lilies",
    sourceLabel: "Test Museum",
  },
  {
    id: "f3",
    sourceUrl: "https://museum.example/lilies",
    sourceLabel: "Test Museum",
  },
];

beforeEach(() => {
  mockOpenBrowser.mockReset();
  mockOpenBrowser.mockResolvedValue(undefined);
  mockReportError.mockReset();
  mockToast.mockReset();
  mockActive = true;
});

it("lists each cited page once, in citation order, and opens it on tap", async () => {
  await render(<DocentSection docent={docent} factSheet={factSheet} />);
  expect(screen.getByText("Monet painted this pond at Giverny in 1916.")).toBeOnTheScreen();
  expect(screen.getByText("It entered the collection in 1959.")).toBeOnTheScreen();
  expect(screen.getAllByRole("link").map((link) => link.props.accessibilityLabel)).toEqual(["Wikidata", "Test Museum"]);
  await fireEvent.press(screen.getByRole("link", { name: "Test Museum" }));
  expect(mockOpenBrowser).toHaveBeenCalledWith("https://museum.example/lilies");
});

it("names the open licence of adapted Wikipedia text and links to it", async () => {
  const wikipedia = { id: "w1", sourceUrl: "https://en.wikipedia.org/wiki/Water_Lilies", sourceLabel: "Wikipedia" };
  await render(
    <DocentSection docent={[{ sentence: "Monet painted it at Giverny.", factIds: ["w1"] }]} factSheet={[wikipedia]} />,
  );
  expect(screen.getByText("Adapted with AI from Wikipedia · CC BY-SA 4.0")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("link", { name: "Adapted with AI from Wikipedia, licensed CC BY-SA 4.0" }));
  expect(mockOpenBrowser).toHaveBeenCalledWith("https://creativecommons.org/licenses/by-sa/4.0/");
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
  expect(screen.getAllByRole("link").map((link) => link.props.accessibilityLabel)).toEqual(["Test Museum", "Wikidata"]);
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
    const view = await render(<DocentSection title="About this work" status="writing" />);
    expect(screen.getByText("About this work")).toBeOnTheScreen();
    expect(screen.getByLabelText("Loading artwork information…")).toBeOnTheScreen();
    await view.rerender(<DocentSection title="About this work" status="ready" docent={docent} factSheet={factSheet} />);
    expect(screen.queryByLabelText("Loading artwork information…")).toBeNull();
    expect(screen.getByText("Monet painted this pond at Giverny in 1916.")).toBeOnTheScreen();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("offers a retry once a run has stalled for a minute, then waits again", async () => {
    const onRetry = jest.fn(async () => {});
    await render(<DocentSection title="About this work" status="writing" onRetry={onRetry} />);
    await act(() => {
      jest.advanceTimersByTime(DOCENT_WAIT_MS - 1);
    });
    expect(screen.getByLabelText("Loading artwork information…")).toBeOnTheScreen();
    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByText("Couldn’t load background information for this work.")).toBeOnTheScreen();
    expect(mockToast).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: DOCENT_RETRY }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Loading artwork information…")).toBeOnTheScreen();
  });

  it("keeps writing past a minute when the backend ends stale runs itself", async () => {
    const view = await render(<DocentSection title="About this work" status="writing" waitWhileWriting />);
    await act(() => {
      jest.advanceTimersByTime(DOCENT_WAIT_MS * 5);
    });
    expect(screen.getByLabelText("Loading artwork information…")).toBeOnTheScreen();
    expect(mockToast).not.toHaveBeenCalled();
    const onRetry = jest.fn(async () => {});
    await view.rerender(<DocentSection title="About this work" status="failed" onRetry={onRetry} waitWhileWriting />);
    expect(screen.getByText("Couldn’t load background information for this work.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: DOCENT_RETRY }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps one toast when a stalled run then fails on the server", async () => {
    const onRetry = jest.fn(async () => {});
    const view = await render(<DocentSection title="About this work" status="writing" onRetry={onRetry} />);
    await act(() => {
      jest.advanceTimersByTime(DOCENT_WAIT_MS);
    });
    expect(mockToast).toHaveBeenCalledTimes(1);
    await view.rerender(<DocentSection title="About this work" status="failed" onRetry={onRetry} />);
    expect(screen.getByText("Couldn’t load background information for this work.")).toBeOnTheScreen();
    expect(mockToast).toHaveBeenCalledTimes(1);
  });
});

describe("after a failed run", () => {
  it("explains the failure in place and in one toast, and retries from either", async () => {
    let finish = () => {};
    const onRetry = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = await render(<DocentSection title="About this work" status="failed" onRetry={onRetry} />);
    expect(screen.getByText("Couldn’t load background information for this work.")).toBeOnTheScreen();
    expect(mockToast).toHaveBeenCalledTimes(1);
    const [message, retryFromToast] = mockToast.mock.calls[0];
    expect(message).toBe(DOCENT_FAILED);

    await act(() => retryFromToast());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: DOCENT_RETRY })).toBeDisabled();
    await view.rerender(<DocentSection title="About this work" status="writing" onRetry={onRetry} />);
    await act(async () => finish());
    expect(screen.getByLabelText("Loading artwork information…")).toBeOnTheScreen();

    await view.rerender(<DocentSection title="About this work" status="failed" onRetry={onRetry} />);
    expect(mockToast).toHaveBeenCalledTimes(2);
    await fireEvent.press(screen.getByRole("button", { name: DOCENT_RETRY }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("keeps the retry available when the request cannot reach the server", async () => {
    const onRetry = jest.fn().mockRejectedValueOnce(new Error("Network request failed"));
    await render(<DocentSection title="About this work" status="failed" onRetry={onRetry} />);
    await fireEvent.press(screen.getByRole("button", { name: DOCENT_RETRY }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t reach Artlog. Check your connection and try again.",
    );
    expect(screen.getByRole("button", { name: DOCENT_RETRY })).toBeEnabled();
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("waits to show the toast until the card is on screen", async () => {
    mockActive = false;
    const view = await render(<DocentSection title="About this work" status="failed" onRetry={jest.fn()} />);
    expect(mockToast).not.toHaveBeenCalled();
    mockActive = true;
    await view.rerender(<DocentSection title="About this work" status="failed" onRetry={jest.fn()} />);
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it("says plainly when a work has no background information, without a toast", async () => {
    await render(<DocentSection title="About this work" status="unavailable" docent={[]} />);
    expect(screen.getByText("Background information isn’t available for this work.")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Loading artwork information…")).toBeNull();
    expect(mockToast).not.toHaveBeenCalled();
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

it("offers Report at the end of the title only while there are sentences to report", async () => {
  const report = { kind: "docent" as const, artworkId: "artwork-1" as never };
  const { rerender } = await render(
    <DocentSection title="About this work" docent={docent} factSheet={factSheet} report={report} />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Report description" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/report", params: { kind: "docent", id: "artwork-1" } });
  await rerender(<DocentSection title="About this work" status="writing" report={report} />);
  expect(screen.getByRole("header", { name: "About this work" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Report description" })).toBeNull();
});
