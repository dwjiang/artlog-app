import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";

import type { PhotoSessionDraft } from "@/lib/capture/photo-draft";
import { formatVisitDate } from "@/lib/journal/history";
import { dismissToast, useToast } from "@/lib/ui/toast";
import { calendarDate } from "@/shared/journal/limits";

import { CaptureContextScreen } from "./capture-context-screen";

const mockBack = jest.fn();
const mockUpdateSession = jest.fn();
let mockParams: {
  draftId?: string;
  visitId?: string;
  venueId?: string;
  capturedAt?: string;
} = {};
let mockSession: PhotoSessionDraft = { photos: [] };
let mockOpenVisit:
  | { localId: string; venueId: string; visitedOn: string; timeZone: string; startedAt: number }
  | undefined;
const mockVisitByDefault = jest.fn();
let mockQuery = {
  data: [] as {
    localId: string;
    owner: string;
    venueId: string;
    venueName: string;
    visitedOn: string;
    endedAt: number | null;
  }[],
  updatedAt: undefined as Date | undefined,
  error: undefined as Error | undefined,
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
  router: { back: () => mockBack(), push: jest.fn() },
}));
jest.mock("drizzle-orm/expo-sqlite", () => ({ useLiveQuery: () => mockQuery }));
jest.mock("@/db/repos/visits", () => ({
  listVisits: jest.fn(),
  getVisit: jest.fn(),
}));
jest.mock("@/lib/account/owner-store", () => ({
  useLocalOwner: () => "owner",
}));
jest.mock("@/lib/venue/use-venue", () => ({
  useVenue: () => ({ visit: mockOpenVisit }),
  visitByDefault: (...args: unknown[]) => mockVisitByDefault(...args),
}));
jest.mock("@/lib/venue/venue-db", () => ({
  venueMetadataForIds: async (ids: string[]) =>
    ids[0] === "id-met"
      ? [
          {
            id: "id-met",
            key: "k",
            name: "The Met",
            lat: 40.78,
            lng: -73.96,
            website: null,
            region: "new-york",
          },
        ]
      : [],
}));
jest.mock("@/lib/capture/photo-draft", () => ({
  readPhotoSession: () => mockSession,
  updatePhotoSession: (...args: unknown[]) => mockUpdateSession(...args),
}));

const museum = {
  localId: "captured-visit",
  owner: "owner",
  venueId: "id-met",
  venueName: "Museum",
  visitedOn: "2024-02-29",
  endedAt: null,
};
const other = {
  localId: "other-visit",
  owner: "owner",
  venueId: "id-other",
  venueName: "Other museum",
  visitedOn: "2024-03-01",
  endedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  dismissToast();
  mockParams = { draftId: "capture.jpg" };
  mockSession = { photos: [] };
  mockOpenVisit = undefined;
  mockVisitByDefault.mockReturnValue(true);
  mockQuery = { data: [], updatedAt: undefined, error: undefined };
});

it("marks the capture’s own visit until the draft overrides it", async () => {
  mockParams = { draftId: "capture.jpg", visitId: "captured-visit" };
  mockQuery = {
    data: [museum, other],
    updatedAt: new Date(),
    error: undefined,
  };
  const view = await render(<CaptureContextScreen />);
  expect(
    screen.getByRole("button", {
      name: "Museum · Feb 29, 2024",
      selected: true,
    }),
  ).toBeOnTheScreen();
  mockSession = { photos: [], visit: { kind: "none" } };
  mockParams = { draftId: "other.jpg", visitId: "captured-visit" };
  await view.rerender(<CaptureContextScreen />);
  expect(screen.getByRole("button", { name: "Artwork only", selected: true })).toBeOnTheScreen();
});

it("writes the choice to the draft only and closes", async () => {
  mockQuery = {
    data: [museum, other],
    updatedAt: new Date(),
    error: undefined,
  };
  await render(<CaptureContextScreen />);
  expect(screen.getByRole("button", { name: "Artwork only", selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Other museum · Mar 1, 2024" }));
  expect(mockUpdateSession).toHaveBeenCalledWith("owner", "capture.jpg", {
    visit: { kind: "visit", localId: "other-visit" },
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Artwork only" }));
  expect(mockUpdateSession).toHaveBeenLastCalledWith("owner", "capture.jpg", {
    visit: { kind: "none" },
  });
});

describe("a capture scanned at a museum with no visit yet", () => {
  beforeEach(() => {
    mockParams = {
      draftId: "capture.jpg",
      venueId: "id-met",
      capturedAt: String(Date.now()),
    };
    mockQuery = { data: [other], updatedAt: new Date(), error: undefined };
  });

  it("offers the museum, selected by default, and a save there starts its visit", async () => {
    await render(<CaptureContextScreen />);
    const option = await screen.findByRole("button", {
      name: "The Met · Today · Starts with this artwork",
      selected: true,
    });
    expect(screen.getByRole("button", { name: "Artwork only", selected: false })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Artwork only" }));
    expect(mockUpdateSession).toHaveBeenLastCalledWith("owner", "capture.jpg", {
      visit: { kind: "none" },
    });
    await fireEvent.press(option);
    expect(mockUpdateSession).toHaveBeenLastCalledWith("owner", "capture.jpg", {
      visit: { kind: "venue", venueId: "id-met" },
    });
  });

  it("defaults to no visit after the visit there was ended on the capture day, with the museum one tap away", async () => {
    mockVisitByDefault.mockReturnValue(false);
    await render(<CaptureContextScreen />);
    expect(mockVisitByDefault).toHaveBeenCalledWith("id-met", Number(mockParams.capturedAt));
    expect(
      await screen.findByRole("button", {
        name: "The Met · Today · Starts with this artwork",
        selected: false,
      }),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Artwork only", selected: true })).toBeOnTheScreen();
  });

  it("marks the visit already open at that museum instead of offering the museum again", async () => {
    mockParams.capturedAt = String(Date.UTC(2024, 1, 29, 18));
    mockOpenVisit = {
      localId: "captured-visit",
      venueId: "id-met",
      visitedOn: "2024-02-29",
      timeZone: "America/New_York",
      startedAt: Date.UTC(2024, 1, 29, 17),
    };
    mockQuery = {
      data: [museum, other],
      updatedAt: new Date(),
      error: undefined,
    };
    await render(<CaptureContextScreen />);
    expect(
      await screen.findByRole("button", {
        name: "Museum · Since Feb 29, 2024",
        selected: true,
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Starts with this artwork/)).toBeNull();
  });

  it("marks the visit already on the books for an earlier capture day, even one that has ended, instead of offering the museum", async () => {
    mockParams.capturedAt = String(Date.UTC(2024, 1, 29, 18));
    mockQuery = {
      data: [{ ...museum, endedAt: Date.UTC(2024, 1, 29, 20) }, other],
      updatedAt: new Date(),
      error: undefined,
    };
    await render(<CaptureContextScreen />);
    expect(
      await screen.findByRole("button", {
        name: "Museum · Feb 29, 2024",
        selected: true,
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Starts with this artwork/)).toBeNull();
  });

  it("still offers the museum today after the visit there ended, since the save starts a fresh one", async () => {
    const today = calendarDate(Date.now(), "America/New_York");
    mockQuery = {
      data: [{ ...museum, visitedOn: today, endedAt: Date.now() - 1000 }],
      updatedAt: new Date(),
      error: undefined,
    };
    await render(<CaptureContextScreen />);
    expect(
      await screen.findByRole("button", {
        name: "The Met · Today · Starts with this artwork",
        selected: true,
      }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", {
        name: `Museum · ${formatVisitDate(today)}`,
        selected: false,
      }),
    ).toBeOnTheScreen();
  });

  it("marks that day's visit for a capture from before the visit open elsewhere began", async () => {
    const today = calendarDate(Date.now(), "America/New_York");
    mockParams.capturedAt = String(Date.now() - 60_000);
    mockOpenVisit = {
      localId: "other-visit",
      venueId: "id-other",
      visitedOn: today,
      timeZone: "America/New_York",
      startedAt: Date.now(),
    };
    mockQuery = {
      data: [
        { ...museum, visitedOn: today, endedAt: Date.now() - 120_000 },
        { ...other, visitedOn: today },
      ],
      updatedAt: new Date(),
      error: undefined,
    };
    await render(<CaptureContextScreen />);
    expect(
      await screen.findByRole("button", {
        name: `Museum · ${formatVisitDate(today)}`,
        selected: true,
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Starts with this artwork/)).toBeNull();
  });

  it("dates the museum visit by the capture, not by today", async () => {
    mockParams = {
      draftId: "capture.jpg",
      venueId: "id-met",
      capturedAt: String(Date.UTC(2024, 1, 29, 18)),
    };
    await render(<CaptureContextScreen />);
    expect(
      await screen.findByRole("button", {
        name: "The Met · Feb 29, 2024 · Starts with this artwork",
        selected: true,
      }),
    ).toBeOnTheScreen();
  });

  it("keeps an older capture on its own day when another visit is open at the same museum", async () => {
    mockParams.capturedAt = String(Date.UTC(2024, 1, 29, 18));
    mockOpenVisit = {
      localId: "captured-visit",
      venueId: "id-met",
      visitedOn: "2024-03-01",
      timeZone: "America/New_York",
      startedAt: Date.UTC(2024, 2, 1, 15),
    };
    mockQuery = {
      data: [{ ...museum, visitedOn: "2024-03-01" }],
      updatedAt: new Date(),
      error: undefined,
    };
    await render(<CaptureContextScreen />);
    const option = await screen.findByRole("button", {
      name: "The Met · Feb 29, 2024 · Starts with this artwork",
      selected: true,
    });
    expect(
      screen.getByRole("button", {
        name: "Museum · Since Mar 1, 2024",
        selected: false,
      }),
    ).toBeOnTheScreen();
    await fireEvent.press(option);
    expect(mockUpdateSession).toHaveBeenLastCalledWith("owner", "capture.jpg", {
      visit: { kind: "venue", venueId: "id-met" },
    });
  });

  it("offers the resolved museum without asking the user to create it manually", async () => {
    mockQuery = { data: [], updatedAt: new Date(), error: undefined };
    await render(<CaptureContextScreen />);
    await screen.findByRole("button", {
      name: "The Met · Today · Starts with this artwork",
      selected: true,
    });
    expect(screen.queryByText("Keep the day, too.")).toBeNull();
    expect(screen.getByRole("button", { name: "Create a visit" })).toBeOnTheScreen();
  });
});

it("places artwork only before museum visits and creation after them", async () => {
  mockQuery = {
    data: [museum, other],
    updatedAt: new Date(),
    error: undefined,
  };
  await render(<CaptureContextScreen />);
  const choices = screen.getAllByRole("button").map((button) => button.props.accessibilityLabel);
  expect(choices.indexOf("Artwork only")).toBeLessThan(choices.indexOf("Museum · Feb 29, 2024"));
  expect(screen.getByRole("button", { name: "Create a visit" })).toBeOnTheScreen();
});

it("names the open visit by when it began", async () => {
  mockOpenVisit = {
    localId: "captured-visit",
    venueId: "id-met",
    visitedOn: "2024-02-29",
    timeZone: "America/New_York",
    startedAt: Date.UTC(2024, 1, 29, 17),
  };
  mockQuery = { data: [museum], updatedAt: new Date(), error: undefined };
  await render(<CaptureContextScreen />);
  expect(screen.getByRole("button", { name: "Museum · Since Feb 29, 2024" })).toBeOnTheScreen();
});

it("distinguishes loading visits from an empty collection", async () => {
  const view = await render(<CaptureContextScreen />);
  expect(screen.getByLabelText("Loading visits…")).toBeOnTheScreen();
  expect(screen.queryByText("No visits yet.")).toBeNull();
  mockQuery = { ...mockQuery, updatedAt: new Date() };
  await view.rerender(<CaptureContextScreen />);
  expect(screen.getByText("No visits yet.")).toBeOnTheScreen();
});

it("preserves the current choice when saving the new choice fails", async () => {
  const toast = await renderHook(useToast);
  mockQuery = { data: [museum], updatedAt: new Date(), error: undefined };
  mockUpdateSession.mockImplementationOnce(() => {
    throw new Error("Write failed");
  });
  await render(<CaptureContextScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Museum · Feb 29, 2024" }));
  expect(toast.result.current).toMatchObject({
    message: "Couldn’t save this visit choice. Your previous selection is unchanged.",
    action: { label: "Retry" },
  });
  expect(screen.getByRole("button", { name: "Artwork only", selected: true })).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
  await act(() => toast.result.current?.action?.onPress());
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("shows a query failure without claiming there are no visits, and still offers a new visit", async () => {
  mockQuery.error = new Error("Read failed");
  await render(<CaptureContextScreen />);
  expect(screen.getByRole("alert")).toHaveTextContent(/Couldn’t load your visits\./);
  expect(screen.queryByText("No visits yet.")).toBeNull();
  expect(screen.getByRole("button", { name: "Create a visit" })).toBeOnTheScreen();
});
