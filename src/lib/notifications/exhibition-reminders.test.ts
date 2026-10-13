import type { Exhibition } from "@/lib/explore/types";

import { exhibitionReminders } from "./exhibition-reminders";

const orchard: Exhibition = {
  id: "orchard",
  title: "Orchard Light",
  museumId: "bampfa",
  startsOn: "2026-10-23",
  endsOn: "2027-01-24",
  sourceUrl: "https://bampfa.org/orchard",
  friends: [],
};
const now = new Date(2026, 9, 12, 14).getTime();
const data = { url: "/exhibition/orchard" };

it("reminds at 9 AM on opening day and a week before the last day, naming the museum", () => {
  expect(exhibitionReminders({ ...orchard, museum: "Berkeley Art Museum" }, now)).toEqual([
    {
      identifier: "exhibition-opening:orchard",
      content: { body: "Orchard Light opens today at Berkeley Art Museum.", data },
      trigger: { type: "date", date: new Date(2026, 9, 23, 9) },
    },
    {
      identifier: "exhibition-closing:orchard",
      content: { body: "Orchard Light closes Sunday, Jan 24, at Berkeley Art Museum.", data },
      trigger: { type: "date", date: new Date(2027, 0, 17, 9) },
    },
  ]);
});

it("keeps only the closing reminder for a show that is already open", () => {
  const open = { ...orchard, startsOn: "2026-09-01" };
  expect(exhibitionReminders(open, now).map((request) => request.content.body)).toEqual([
    "Orchard Light closes Sunday, Jan 24.",
  ]);
  expect(exhibitionReminders({ ...open, startsOn: undefined }, now)).toHaveLength(1);
});

it("skips reminders already past and a closing notice that would come before the opening", () => {
  expect(exhibitionReminders({ ...orchard, startsOn: "2026-09-01", endsOn: "2026-10-15" }, now)).toEqual([]);
  expect(exhibitionReminders({ ...orchard, endsOn: "2026-10-29" }, now).map((request) => request.identifier)).toEqual([
    "exhibition-opening:orchard",
  ]);
});
