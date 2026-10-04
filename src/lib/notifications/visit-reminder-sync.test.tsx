import { act, render, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import * as SQLite from "expo-sqlite";

import { db } from "@/db/client";
import { addArtworkPhoto, editArtworkPhoto, linkArtworkVisit } from "@/db/repos/artwork-album";
import { artworkEncounters, artworkPhotos, savedWorks, settings, visits } from "@/db/schema";
import type { CurrentVisit } from "@/lib/venue/venue-reducer";

import { setNotificationPreference } from "./preferences";
import { VisitReminderSync } from "./visit-reminder-sync";

let mockVisit: CurrentVisit | undefined;
const listeners = new Set<Parameters<typeof SQLite.addDatabaseChangeListener>[0]>();
jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => "device:test" }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ visit: mockVisit, hydrated: true }) }));

const at = (hours: number) => new Date(2026, 9, 3, hours).getTime();
const visit: CurrentVisit = {
  localId: "visit-1",
  venueId: "met" as never,
  venueName: "The Met",
  startedAt: at(11),
  visitedOn: "2026-10-03",
  timeZone: "America/New_York",
};
const permission = (status: number) => ({ status: "", granted: status === 2, ios: { status } }) as never;

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(at(13));
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(2));
  mockVisit = visit;
  listeners.clear();
  jest.spyOn(SQLite, "addDatabaseChangeListener").mockImplementation((listener) => {
    listeners.add(listener);
    return {
      remove: () => {
        listeners.delete(listener);
      },
    };
  });
  await db.delete(settings);
  await db.delete(artworkPhotos);
  await db.delete(artworkEncounters);
  await db.delete(savedWorks);
  await db.delete(visits);
  await db.insert(visits).values({ ...visit, owner: "device:test" });
  await db.insert(savedWorks).values({
    owner: "device:test",
    localId: "art",
    visitLocalId: visit.localId,
    title: "Painting",
    artist: "Artist",
    savedAt: at(12),
  });
  linkArtworkVisit("art", visit.localId, "device:test");
});

afterEach(() => jest.restoreAllMocks());

async function changed(tableName: string) {
  await act(() => {
    for (const listener of listeners) {
      listener({ tableName, databaseName: "artlog.db", databaseFilePath: "", rowId: 1 });
    }
  });
}

it("reminds about an open visit three hours after its latest save", async () => {
  await render(<VisitReminderSync />);

  await waitFor(() =>
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: "open-visit-reminder",
      content: { body: "Still at The Met? Wrap up your visit.", data: { url: "/journal/visit-1?endVisit=true" } },
      trigger: { type: "date", date: at(15) },
    }),
  );
});

it("drops the reminder when the visit ends or reminders are turned off", async () => {
  const view = await render(<VisitReminderSync />);
  await waitFor(() => expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled());

  mockVisit = undefined;
  await view.rerender(<VisitReminderSync />);
  await waitFor(() =>
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("open-visit-reminder"),
  );

  await act(() => setNotificationPreference("visitReminders", false));
  jest.clearAllMocks();
  mockVisit = visit;
  await view.rerender(<VisitReminderSync />);
  await waitFor(() => expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalled());
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it("postpones repeat-visit reminders when another photo is saved, ignoring other visits and deleted photos", async () => {
  await db.update(savedWorks).set({ savedAt: at(12) - 86_400_000, visitLocalId: null });
  const photo = { savedLocalId: "art", visitLocalId: visit.localId, path: "photo.jpg", kind: "full" as const };
  addArtworkPhoto({ ...photo, localId: "noon", capturedAt: at(12) }, "device:test");
  await render(<VisitReminderSync />);
  await waitFor(() =>
    expect(Notifications.scheduleNotificationAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ trigger: { type: "date", date: at(15) } }),
    ),
  );

  addArtworkPhoto({ ...photo, localId: "one", capturedAt: at(13) }, "device:test");
  await changed("artworkPhotos");
  await waitFor(() =>
    expect(Notifications.scheduleNotificationAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ trigger: { type: "date", date: at(16) } }),
    ),
  );

  await db.insert(visits).values({ ...visit, localId: "other", owner: "device:test" });
  addArtworkPhoto({ ...photo, localId: "elsewhere", visitLocalId: "other", capturedAt: at(14) }, "device:test");
  editArtworkPhoto("one", { deletedAt: at(13) }, "device:test");
  await changed("artworkPhotos");
  await waitFor(() =>
    expect(Notifications.scheduleNotificationAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ trigger: { type: "date", date: at(15) } }),
    ),
  );
});
