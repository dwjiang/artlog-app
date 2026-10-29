import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";

import { db } from "@/db/client";
import { getVisit } from "@/db/repos/visits";
import { visits } from "@/db/schema";
import { switchOwner } from "@/lib/account/owner-store";
import type { VisitSummary } from "@/lib/journal/visit-summaries";
import { SyncUnavailableError } from "@/lib/network-error";

import { VisitWrapUpSheet } from "./visit-wrap-up-sheet";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockClearWrapUp = jest.fn();
const mockToast = jest.fn();
const mockSaveNotes = jest.fn();
const mockFlush = jest.fn();
let mockVisits: VisitSummary[] = [];
let mockLoading = false;
jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
jest.mock("@/lib/account/collection-sync", () => ({ flushJournal: () => mockFlush() }));
// Like Expo Router's removal prevention: a blocked removal goes to the screen's callback, whose `repeat` performs it.
let mockGuard: { prevented: boolean; onPrevented?: (event: { repeat: () => void }) => void } = { prevented: false };
const mockRemove = (remove: () => void) =>
  mockGuard.prevented ? mockGuard.onPrevented?.({ repeat: remove }) : remove();
jest.mock("expo-router", () => ({
  router: {
    back: () => mockRemove(mockBack),
    replace: (to: unknown) => mockRemove(() => mockReplace(to)),
  },
  usePreventRemove: (prevented: boolean, onPrevented: (event: { repeat: () => void }) => void) => {
    mockGuard = { prevented, onPrevented };
    return () => {
      mockGuard.prevented = false;
    };
  },
  useLocalSearchParams: () => ({ visitId: "550e8400-e29b-41d4-a716-446655440000" }),
}));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/ui/toast", () => ({ showToast: (message: string) => mockToast(message) }));
jest.mock("@/lib/journal/wrap-up", () => ({
  clearWrapUp: (owner: string, visitId: string) => mockClearWrapUp(owner, visitId),
}));
jest.mock("@/lib/journal/use-visits", () => ({
  useVisits: () => ({
    owner: mockVisits[0]?.owner ?? "device:test",
    visits: mockVisits,
    loading: mockLoading,
    error: undefined,
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("./visit-ui", () => ({
  ArtworkPreviews: ({ works }: { works: unknown[] }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{`${works.length} previews`}</Text>;
  },
}));
jest.mock("./visit-notes", () => {
  const { useImperativeHandle } = jest.requireActual<typeof import("react")>("react");
  const { TextInput } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    useNoteEdited: jest.requireActual("./visit-notes").useNoteEdited,
    VisitNotes: ({
      ref,
      onDraftChange,
    }: {
      ref: React.Ref<{ save: () => Promise<boolean> }>;
      onDraftChange: (text: string) => void;
    }) => {
      useImperativeHandle(ref, () => ({ save: () => mockSaveNotes() }));
      return <TextInput accessibilityLabel="Notes" onChangeText={onDraftChange} />;
    },
  };
});

const started = Date.UTC(2026, 8, 30, 17, 42);
beforeEach(async () => {
  jest.clearAllMocks();
  mockGuard = { prevented: false };
  jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 1, 13, 0));
  mockClearWrapUp.mockResolvedValue(undefined);
  mockSaveNotes.mockResolvedValue(true);
  mockFlush.mockReset().mockResolvedValue(undefined);
  mockLoading = false;
  mockVisits = [
    {
      owner: "device:test",
      localId: "550e8400-e29b-41d4-a716-446655440000",
      venueId: "id-met" as never,
      venueName: "The Metropolitan Museum of Art",
      visibility: "private",
      visitedOn: "2026-09-30",
      timeZone: "America/New_York",
      reflection: null,
      startedAt: started,
      endedAt: started + 148 * 60_000,
      remoteVisitId: null,
      syncedAt: null,
      syncedBy: null,
      revision: 0,
      deletedAt: null,
      location: "New York",
      works: [{ localId: "a" }, { localId: "b" }, { localId: "c" }] as VisitSummary["works"],
    },
  ];
  await seedVisit({});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function seedVisit(patch: Partial<VisitSummary>) {
  mockVisits[0] = { ...mockVisits[0], ...patch };
  switchOwner(mockVisits[0].owner);
  await db.delete(visits);
  await db.insert(visits).values(mockVisits[0]);
}

it("summarizes yesterday's visit and keeps it private after saving the note", async () => {
  await render(<VisitWrapUpSheet />);
  expect(screen.getByRole("header", { name: "Wrap up your visit?" })).toBeOnTheScreen();
  expect(screen.getByText("The Metropolitan Museum of Art")).toBeOnTheScreen();
  expect(screen.getByText("Yesterday · 3 artworks · 2h 28m")).toBeOnTheScreen();
  expect(screen.getByText("3 previews")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Keep it private" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(mockSaveNotes).toHaveBeenCalledTimes(1);
  expect(mockClearWrapUp).toHaveBeenCalledWith("device:test", "550e8400-e29b-41d4-a716-446655440000");
  expect(mockToast).toHaveBeenCalledWith("Visit saved.");
  expect(mockFlush).not.toHaveBeenCalled();
});

it.each(["public", "friends"] as const)(
  "makes a %s visit private and waits for sync before closing",
  async (visibility) => {
    await seedVisit({ owner: "account:test", visibility });
    let finishSync!: () => void;
    mockFlush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSync = resolve;
        }),
    );
    await render(<VisitWrapUpSheet />);
    await fireEvent.press(screen.getByRole("button", { name: "Keep it private" }));
    await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(1));
    expect((await getVisit("550e8400-e29b-41d4-a716-446655440000", "account:test"))?.visibility).toBe("private");
    expect(mockClearWrapUp).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    await act(() => finishSync());
    expect(mockClearWrapUp).toHaveBeenCalledWith("account:test", "550e8400-e29b-41d4-a716-446655440000");
    expect(mockBack).toHaveBeenCalledTimes(1);
  },
);

it("keeps a failed privacy change pending and retries even after the local visibility is private", async () => {
  await seedVisit({ owner: "account:test", visibility: "public" });
  mockFlush.mockRejectedValueOnce(new SyncUnavailableError());
  const view = await render(<VisitWrapUpSheet />);
  await fireEvent.press(screen.getByRole("button", { name: "Keep it private" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/A published visit may keep its previous visibility/);
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockClearWrapUp).not.toHaveBeenCalled();
  expect(mockToast).not.toHaveBeenCalled();
  mockVisits[0] = { ...mockVisits[0], ...(await getVisit("550e8400-e29b-41d4-a716-446655440000", "account:test")) };
  await view.rerender(<VisitWrapUpSheet />);
  await fireEvent.press(screen.getByRole("button", { name: "Keep it private" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(mockFlush).toHaveBeenCalledTimes(2);
});

it("allows a retry when privacy sync does not finish", async () => {
  jest.useFakeTimers();
  await seedVisit({ owner: "account:test", visibility: "public" });
  mockFlush.mockImplementationOnce(() => new Promise<void>(() => {}));
  await render(<VisitWrapUpSheet />);
  await fireEvent.press(screen.getByRole("button", { name: "Keep it private" }));
  await act(() => jest.advanceTimersByTime(30_000));
  expect(screen.getByRole("alert")).toHaveTextContent(/A published visit may keep its previous visibility/);
  expect(screen.getByRole("button", { name: "Keep it private" })).toBeEnabled();
  expect(mockClearWrapUp).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
});

it("does not navigate or report success after the owner changes during privacy sync", async () => {
  await seedVisit({ owner: "account:test", visibility: "public" });
  let finishSync!: () => void;
  mockFlush.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSync = resolve;
      }),
  );
  await render(<VisitWrapUpSheet />);
  await fireEvent.press(screen.getByRole("button", { name: "Keep it private" }));
  await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(1));
  await act(() => {
    switchOwner("account:other");
    finishSync();
  });
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockToast).not.toHaveBeenCalled();
  expect(mockClearWrapUp).not.toHaveBeenCalled();
});

it("hands the visit to the share flow after saving the note", async () => {
  await render(<VisitWrapUpSheet />);
  await fireEvent.press(screen.getByRole("button", { name: "Share with friends" }));
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/visit-share/[visitId]",
      params: { visitId: "550e8400-e29b-41d4-a716-446655440000", audience: "friends" },
    }),
  );
  expect(mockClearWrapUp).toHaveBeenCalledTimes(1);
  expect(mockBack).not.toHaveBeenCalled();
});

it("keeps an already-synced private visit usable without a connection", async () => {
  await seedVisit({ owner: "account:test", syncedAt: Date.now() });
  mockFlush.mockRejectedValue(new SyncUnavailableError());
  await render(<VisitWrapUpSheet />);
  await fireEvent.press(screen.getByRole("button", { name: "Keep it private" }));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(mockFlush).not.toHaveBeenCalled();
});

it("does not dismiss another screen when the sheet is swiped away during sync", async () => {
  await seedVisit({ owner: "account:test", visibility: "public" });
  let finishSync!: () => void;
  mockFlush.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSync = resolve;
      }),
  );
  const view = await render(<VisitWrapUpSheet />);
  await fireEvent.press(screen.getByRole("button", { name: "Keep it private" }));
  await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(1));
  await view.unmount();
  await act(() => finishSync());
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockToast).not.toHaveBeenCalled();
});

it("skips without touching the visit and does not ask again", async () => {
  await render(<VisitWrapUpSheet />);
  await fireEvent.press(screen.getByRole("button", { name: "Skip" }));
  expect(mockSaveNotes).not.toHaveBeenCalled();
  expect(mockClearWrapUp).toHaveBeenCalledWith("device:test", "550e8400-e29b-41d4-a716-446655440000");
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("stays open when the note cannot be saved", async () => {
  mockSaveNotes.mockResolvedValue(false);
  await render(<VisitWrapUpSheet />);
  await fireEvent.press(screen.getByRole("button", { name: "Keep it private" }));
  await waitFor(() => expect(mockSaveNotes).toHaveBeenCalledTimes(1));
  expect(mockClearWrapUp).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
});

it("explains a visit that is gone and clears the wrap-up on Done", async () => {
  mockVisits = [];
  await render(<VisitWrapUpSheet />);
  expect(screen.getByText("This visit is unavailable.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(mockClearWrapUp).toHaveBeenCalledTimes(1);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("clears the displayed wrap-up when the native sheet is swiped away", async () => {
  const view = await render(<VisitWrapUpSheet />);
  await view.unmount();
  expect(mockClearWrapUp).toHaveBeenCalledWith("device:test", "550e8400-e29b-41d4-a716-446655440000");
  expect(mockSaveNotes).not.toHaveBeenCalled();
});

describe("a typed note", () => {
  let alert: jest.SpyInstance;
  const alertButton = (text: string) =>
    (alert.mock.lastCall as [string, undefined, AlertButton[]])[2].find((button) => button.text === text)!;
  beforeEach(() => {
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("makes Skip or a swipe ask before throwing the note away", async () => {
    await render(<VisitWrapUpSheet />);
    await fireEvent.changeText(screen.getByLabelText("Notes"), "The blue room.");
    await fireEvent.press(screen.getByRole("button", { name: "Skip" }));
    expect(alert).toHaveBeenCalledWith("Discard your edits?", undefined, expect.any(Array));
    await act(() => alertButton("Keep Editing").onPress?.());
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockSaveNotes).not.toHaveBeenCalled();
    await act(() => alertButton("Discard Edits").onPress?.());
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Keep it private", () => expect(mockBack).toHaveBeenCalledTimes(1)],
    ["Share with friends", () => expect(mockReplace).toHaveBeenCalledTimes(1)],
  ])("closes after %s saves it, without asking", async (label, closed) => {
    await render(<VisitWrapUpSheet />);
    await fireEvent.changeText(screen.getByLabelText("Notes"), "The blue room.");
    await fireEvent.press(screen.getByRole("button", { name: label }));
    await waitFor(closed);
    expect(mockSaveNotes).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });
});
