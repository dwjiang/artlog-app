import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { db } from "@/db/client";
import { linkArtworkVisit, selectArtworkEncounters } from "@/db/repos/artwork-album";
import { insertSavedWork } from "@/db/repos/saved-works";
import { getSetting } from "@/db/repos/settings";
import { upsertVisit } from "@/db/repos/visits";
import { artworkEncounters, savedWorks, settings } from "@/db/schema";
import { getLocalOwner } from "@/lib/account/owner-store";
import { showToast } from "@/lib/ui/toast";

import { VisitlessSavesCard } from "./visitless-saves-card";

jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/ui/toast", () => ({ showToast: jest.fn(), showErrorToast: jest.fn() }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockVisitForSave = jest.fn();
jest.mock("@/lib/venue/use-venue", () => ({
  visitForSave: (...args: unknown[]) => mockVisitForSave(...args),
}));
jest.mock("@/components/collection/saved-work-image", () => ({ SavedWorkImage: () => null }));

// Mid-afternoon on the phone's own clock, whatever its time zone.
const now = new Date(2026, 9, 7, 15).getTime();
const HOUR = 60 * 60 * 1000;
const visit = {
  localId: "00000000-0000-4000-8000-0000000000a1",
  venueId: "id-aic" as never,
  venueName: "Art Institute of Chicago",
  visitedOn: "2026-10-07",
  timeZone: "America/Chicago",
  visibility: "private" as const,
};

async function save(localId: string, savedAt: number, venue?: { venueId: never; venueName: string }) {
  await insertSavedWork({ localId, title: localId, artist: "Artist", savedAt, cropPath: null, ...venue });
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(now);
  db.delete(artworkEncounters).run();
  db.delete(savedWorks).run();
  db.delete(settings).run();
});
afterEach(() => jest.restoreAllMocks());

it("gathers today’s saves that missed a visit and files them under their museum’s visit", async () => {
  const aic = { venueId: "id-aic" as never, venueName: "Art Institute of Chicago" };
  await save("first", now - 2 * HOUR, aic);
  await save("second", now - HOUR, aic);
  await save("yesterday", now - 24 * HOUR, aic);
  mockVisitForSave.mockImplementation(async () => {
    await upsertVisit(visit);
    return { ...visit, startedAt: now - 2 * HOUR };
  });
  await render(<VisitlessSavesCard />);
  expect(screen.getByRole("header", { name: "Today" })).toBeOnTheScreen();
  expect(screen.getByText("2 artworks saved today")).toBeOnTheScreen();
  expect(screen.getByText("Not in a visit · near Art Institute of Chicago")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Make it a visit" }));
  await waitFor(() => expect(showToast).toHaveBeenCalledWith("Added to your Art Institute of Chicago visit."));
  expect(mockVisitForSave.mock.calls).toEqual([
    ["id-aic", now - 2 * HOUR, { past: true }],
    ["id-aic", now - HOUR, { past: true }],
  ]);
  expect(
    selectArtworkEncounters()
      .all()
      .map((row) => row.savedLocalId)
      .sort(),
  ).toEqual(["first", "second"]);
});

it("asks for the museum when the saves name none", async () => {
  await save("a", now - 2 * HOUR);
  await save("b", now - HOUR);
  await render(<VisitlessSavesCard />);
  expect(screen.getByText("Not in a visit")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Make it a visit" }));
  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/add-to-visit", params: { savedIds: "b,a" } }),
  );
  expect(mockVisitForSave).not.toHaveBeenCalled();
});

it("sets today’s saves aside with “Not a visit”, so only a later save brings the card back", async () => {
  await save("a", now - HOUR);
  const first = await render(<VisitlessSavesCard />);
  await fireEvent.press(screen.getByRole("button", { name: "Not a visit" }));
  await waitFor(async () => expect(await getSetting(`notAVisit:${getLocalOwner()}`)).toBe('["a"]'));
  await first.unmount();
  const second = await render(<VisitlessSavesCard />);
  expect(screen.queryByRole("header", { name: "Today" })).toBeNull();
  await second.unmount();
  await save("b", now - 10 * 60 * 1000);
  await render(<VisitlessSavesCard />);
  expect(screen.getByText("1 artwork saved today")).toBeOnTheScreen();
});

it("stays off Home once every save today is in a visit", async () => {
  await save("a", now - HOUR);
  await upsertVisit(visit);
  linkArtworkVisit("a", visit.localId);
  await render(<VisitlessSavesCard />);
  expect(screen.queryByRole("header", { name: "Today" })).toBeNull();
});
