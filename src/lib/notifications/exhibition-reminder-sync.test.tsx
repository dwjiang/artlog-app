import { act, render, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import { db } from "@/db/client";
import { settings } from "@/db/schema";
import type { ExploreCatalog } from "@/lib/explore/types";
import { reportError } from "@/lib/observability";

import { ExhibitionReminderSync } from "./exhibition-reminder-sync";
import { notificationPermission } from "./permission";
import { setNotificationPreference } from "./preferences";

let mockCatalog: ExploreCatalog | undefined;
let mockSavedReady: boolean;
jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
jest.mock("@/lib/observability", () => ({ reportError: jest.fn() }));
jest.mock("@/lib/explore/want-to-see", () => ({
  useWantToSee: () => ({ saved: new Set(["orchard"]), ready: mockSavedReady }),
}));
jest.mock("@/lib/explore/use-explore", () => ({
  ...jest.requireActual("@/lib/explore/use-explore"),
  useExhibitions: () => ({ data: mockCatalog }),
}));

const permission = (status: number) => ({ status: "", granted: status === 2, ios: { status } }) as never;
const pending = (identifier: string) => ({ identifier }) as Notifications.NotificationRequest;
const catalog: ExploreCatalog = {
  today: "2026-10-12",
  museums: [{ id: "bampfa", name: "Berkeley Art Museum", lat: 0, lng: 0 }],
  exhibitions: [
    {
      id: "orchard",
      title: "Orchard Light",
      museumId: "bampfa",
      startsOn: "2026-10-23",
      endsOn: "2027-01-24",
      sourceUrl: "https://bampfa.org/orchard",
      friends: [],
    },
  ],
};

// The permission module remembers its last answer, so each test sets it before rendering.
beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(new Date(2026, 9, 12, 14).getTime());
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(2));
  // Like iOS, the pending list holds whatever was scheduled since.
  const scheduled = new Map([
    ["exhibition-closing:closed-show", pending("exhibition-closing:closed-show")],
    ["open-visit-reminder", pending("open-visit-reminder")],
  ]);
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockImplementation(async () => [...scheduled.values()]);
  jest.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementation(async (identifier) => {
    scheduled.delete(identifier);
  });
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request) => {
    scheduled.set(request.identifier!, pending(request.identifier!));
    return request.identifier!;
  });
  mockCatalog = catalog;
  mockSavedReady = true;
  await db.delete(settings);
  await notificationPermission();
});

afterEach(() => jest.restoreAllMocks());

it("schedules saved shows' reminders and drops those for shows no longer saved", async () => {
  await render(<ExhibitionReminderSync />);

  await waitFor(() =>
    expect(
      jest.mocked(Notifications.scheduleNotificationAsync).mock.calls.map(([request]) => request.identifier),
    ).toEqual(["exhibition-opening:orchard", "exhibition-closing:orchard"]),
  );
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({ body: "Orchard Light opens today at Berkeley Art Museum." }),
    }),
  );
  expect(jest.mocked(Notifications.cancelScheduledNotificationAsync).mock.calls).toEqual([
    ["exhibition-closing:closed-show"],
  ]);
});

it("cancels every exhibition reminder once notifications are turned off", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(1));
  await notificationPermission();
  await render(<ExhibitionReminderSync />);

  await waitFor(() =>
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("exhibition-closing:closed-show"),
  );
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith("open-visit-reminder");
});

it("cancels every exhibition reminder when they are switched off in Settings", async () => {
  await act(() => setNotificationPreference("exhibitionReminders", false));
  await render(<ExhibitionReminderSync />);

  await waitFor(() =>
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("exhibition-closing:closed-show"),
  );
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it("leaves scheduled reminders alone while saved shows cannot load", async () => {
  mockCatalog = undefined;
  await render(<ExhibitionReminderSync />);
  await act(async () => {});

  expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it.each(["saved list", "catalog"])("cancels reminders switched off while the %s cannot load", async (unavailable) => {
  mockSavedReady = unavailable !== "saved list";
  mockCatalog = undefined;
  await render(<ExhibitionReminderSync />);
  await act(async () => {});
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();

  await act(() => setNotificationPreference("exhibitionReminders", false));

  await waitFor(() =>
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("exhibition-closing:closed-show"),
  );
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith("open-visit-reminder");
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it("reports reminders iOS did not keep, and stays quiet when it kept them all", async () => {
  await render(<ExhibitionReminderSync />);
  await waitFor(() => expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(reportError).not.toHaveBeenCalled();

  jest.clearAllMocks();
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(2));
  jest
    .mocked(Notifications.getAllScheduledNotificationsAsync)
    .mockResolvedValue([pending("exhibition-opening:orchard")]);
  mockCatalog = { ...catalog, exhibitions: [{ ...catalog.exhibitions[0], title: "Orchard Light, extended" }] };
  await render(<ExhibitionReminderSync />);
  await waitFor(() =>
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), "explore.reminders_dropped", {
      level: "warning",
      data: { requested: 2, pending: 1 },
    }),
  );
});

it("reports which reminder step failed", async () => {
  const failure = new Error("Notification scheduling failed");
  jest.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(failure);
  await render(<ExhibitionReminderSync />);
  await waitFor(() =>
    expect(reportError).toHaveBeenCalledWith(failure, "explore.reminders", {
      level: "warning",
      data: { step: "schedule", requested: 2, cancelled: 1 },
    }),
  );
});
