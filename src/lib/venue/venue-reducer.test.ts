import type { Id } from "../../../convex/_generated/dataModel";
import type { VenueCandidate } from "./resolve";
import {
  activeVisit,
  endedToday,
  FIX_MAX_AGE_MS,
  initialVenueState,
  needsFix,
  NOT_HERE_MS,
  planSaveVisit,
  venueContext,
  venueReducer,
  type CurrentVisit,
  type PoiOption,
  type VenueState,
} from "./venue-reducer";

const met = { lat: 40.779444444, lng: -73.963333333 };
const fix = { ...met, at: 1_000_000 };
const DAY = 24 * 60 * 60 * 1000;
/** The museum day of `fix`. */
const today = { visitedOn: "1970-01-01", timeZone: "UTC" };

function candidate(name: string, distanceM: number): VenueCandidate {
  return {
    id: `id-${name}` as Id<"museums">,
    key: `wikidata:${name}`,
    name,
    lat: 0,
    lng: 0,
    website: `https://${name}.example`,
    region: "new-york",
    distanceM,
  };
}

function visitAt(name: string, startedAt: number, remoteVisitId?: string, visitedOn = "1970-01-01"): CurrentVisit {
  return {
    localId: `local-${name}`,
    venueId: `id-${name}` as Id<"museums">,
    venueName: name,
    startedAt,
    visitedOn,
    timeZone: "UTC",
    remoteVisitId: remoteVisitId as Id<"visits"> | undefined,
  };
}

function reduce(events: Parameters<typeof venueReducer>[1][], from: VenueState = initialVenueState): VenueState {
  return events.reduce(venueReducer, from);
}

describe("resolving a fix", () => {
  it("resolves automatically and lists the venue as the only option", () => {
    const state = reduce([
      { type: "locating" },
      {
        type: "resolved",
        fix,
        resolution: {
          kind: "auto",
          venue: candidate("Met", 40),
          options: [candidate("Met", 40)],
        },
      },
    ]);
    expect(state.status).toBe("resolved");
    expect(state.venue).toEqual({
      kind: "seeded",
      venueId: "id-Met",
      name: "Met",
      distanceM: 40,
      website: "https://Met.example",
    });
    expect(state.options).toHaveLength(1);
    expect(state.prompt).toBe(0);
    expect(state.fix).toEqual(fix);
  });

  it("asks between two seeded venues and raises the prompt once", () => {
    const state = reduce([
      {
        type: "resolved",
        fix,
        resolution: {
          kind: "choose",
          options: [candidate("Met", 90), candidate("Neue", 300)],
        },
      },
    ]);
    expect(state.status).toBe("choose");
    expect(state.venue).toBeUndefined();
    expect(state.options.map((option) => option.name)).toEqual(["Met", "Neue"]);
    expect(state.prompt).toBe(1);
  });

  it("keeps a same-day visit at one of the ambiguous venues instead of asking again", () => {
    const state = reduce([
      {
        type: "hydrated",
        at: fix.at,
        visit: visitAt("Neue", fix.at - 60_000, "remote-neue"),
      },
      {
        type: "resolved",
        fix,
        resolution: {
          kind: "choose",
          options: [candidate("Met", 90), candidate("Neue", 300)],
        },
      },
    ]);
    expect(state.status).toBe("resolved");
    expect(state.venue?.name).toBe("Neue");
    expect(state.prompt).toBe(0);
    expect(venueContext(state)).toEqual({
      venueId: "id-Neue",
      visitLocalId: "local-Neue",
      visitId: "remote-neue",
    });
  });

  it("keeps a museum picked from the list whenever a fix lists it that day, then asks again the next day", () => {
    const choose = {
      type: "resolved" as const,
      fix,
      resolution: {
        kind: "choose" as const,
        options: [candidate("Met", 90), candidate("Neue", 300)],
      },
    };
    const neue = {
      kind: "seeded" as const,
      venueId: "id-Neue" as Id<"museums">,
      name: "Neue",
    };
    const picked = reduce([
      choose,
      { type: "chosen", option: neue, replaces: neue, day: today },
      { type: "backgrounded" },
      { ...choose, fix: { ...fix, at: fix.at + 60_000 } },
    ]);
    expect(picked).toMatchObject({ status: "resolved", prompt: 1 });
    expect(venueContext(picked)).toEqual({ venueId: "id-Neue" });
    const tomorrow = venueReducer(picked, {
      ...choose,
      fix: { ...fix, at: fix.at + DAY },
    });
    expect(tomorrow).toMatchObject({
      status: "choose",
      venue: undefined,
      prompt: 2,
    });
  });

  it("keeps a museum picked over today's visit elsewhere until a later visit starts at another museum", () => {
    const choose = (at: number) => ({
      type: "resolved" as const,
      fix: { ...fix, at },
      resolution: {
        kind: "choose" as const,
        options: [candidate("Met", 90), candidate("Neue", 300)],
      },
    });
    const neue = {
      kind: "seeded" as const,
      venueId: "id-Neue" as Id<"museums">,
      name: "Neue",
    };
    const changed = reduce([
      { type: "hydrated", at: fix.at, visit: visitAt("Met", fix.at - 60_000) },
      choose(fix.at),
      { type: "chosen", option: neue, replaces: neue, day: today },
      { type: "backgrounded" },
      choose(fix.at + 60_000),
    ]);
    expect(venueContext(changed)).toEqual({ venueId: "id-Neue" });
    const backdated = reduce(
      [{ type: "visitStarted", visit: visitAt("Met", fix.at - 120_000) }, choose(fix.at + 120_000)],
      changed,
    );
    expect(venueContext(backdated)).toEqual({ venueId: "id-Neue" });
    const later = {
      ...visitAt("Met", fix.at + 180_000),
      localId: "local-Met-2",
    };
    const tookOver = reduce([{ type: "visitStarted", visit: later }, choose(fix.at + 240_000)], changed);
    expect(tookOver.picked).toBeUndefined();
    expect(venueContext(tookOver)).toEqual({
      venueId: "id-Met",
      visitLocalId: "local-Met-2",
    });
  });

  it("never raises the prompt for a scan's resolution", () => {
    const state = reduce([
      {
        type: "resolved",
        fix,
        quiet: true,
        resolution: {
          kind: "choose",
          options: [candidate("Met", 90), candidate("Neue", 300)],
        },
      },
    ]);
    expect(state).toMatchObject({ status: "choose", prompt: 0 });
  });

  it("asks again when the visit at an ambiguous venue is from an earlier day", () => {
    const state = reduce([
      {
        type: "hydrated",
        at: fix.at,
        visit: visitAt("Neue", fix.at - 60_000, undefined, "1969-12-31"),
      },
      {
        type: "resolved",
        fix,
        resolution: {
          kind: "choose",
          options: [candidate("Met", 90), candidate("Neue", 300)],
        },
      },
    ]);
    expect(state.status).toBe("choose");
    expect(state.prompt).toBe(1);
  });

  it("pauses the visit when nothing seeded is nearby: no venue for scans, but the visit stays open", () => {
    const state = reduce([
      { type: "hydrated", at: fix.at, visit: visitAt("Met", fix.at - 1000) },
      { type: "resolved", fix, resolution: { kind: "none" } },
    ]);
    expect(state).toMatchObject({
      status: "none",
      venue: undefined,
      options: [],
      prompt: 0,
    });
    expect(state.visit?.localId).toBe("local-Met");
    expect(venueContext(state)).toEqual({});
    const back = venueReducer(state, {
      type: "resolved",
      fix: { ...fix, at: fix.at + FIX_MAX_AGE_MS },
      resolution: {
        kind: "auto",
        venue: candidate("Met", 40),
        options: [candidate("Met", 40)],
      },
    });
    expect(venueContext(back)).toEqual({
      venueId: "id-Met",
      visitLocalId: "local-Met",
    });
  });

  it("keeps the last venue after a failed fix but reports the error", () => {
    const resolved = reduce([
      {
        type: "resolved",
        fix,
        resolution: {
          kind: "auto",
          venue: candidate("Met", 40),
          options: [candidate("Met", 40)],
        },
      },
    ]);
    const failed = reduce([{ type: "locating" }, { type: "failed", error: "Location unavailable" }], resolved);
    expect(failed.status).toBe("resolved");
    expect(failed.venue?.name).toBe("Met");
    expect(failed.error).toBe("Location unavailable");
    expect(reduce([{ type: "failed", error: "x" }]).status).toBe("none");
  });

  it("drops the venue and fix when location access is denied, pausing the visit rather than ending it", () => {
    const state = reduce([
      { type: "hydrated", at: fix.at, visit: visitAt("Met", fix.at) },
      { type: "denied", at: fix.at },
    ]);
    expect(state).toMatchObject({
      status: "denied",
      venue: undefined,
      visit: { localId: "local-Met" },
      fix: undefined,
    });
    expect(venueContext(state)).toEqual({});
  });

  it("keeps a museum picked by hand through denied location only on its visit's day", () => {
    const picked = reduce([{ type: "hydrated", at: fix.at, visit: { ...visitAt("Met", fix.at), manual: true } }]);
    expect(venueContext(venueReducer(picked, { type: "denied", at: fix.at }))).toEqual({
      venueId: "id-Met",
      visitLocalId: "local-Met",
    });
    const nextDay = venueReducer(picked, { type: "denied", at: fix.at + DAY });
    expect(nextDay).toMatchObject({ status: "denied", venue: undefined, visit: { localId: "local-Met" } });
    expect(venueContext(nextDay)).toEqual({});
  });
});

describe("nearby places", () => {
  const poi: PoiOption = {
    kind: "poi",
    name: "Small Gallery",
    lat: met.lat,
    lng: met.lng,
    distanceM: 80,
    category: "unknown",
  };

  it("prompts with MapKit places only after a fix found nothing seeded", () => {
    const none = reduce([{ type: "resolved", fix, resolution: { kind: "none" } }]);
    const state = venueReducer(none, { type: "poiOptions", options: [poi] });
    expect(state.options).toEqual([poi]);
    expect(state.prompt).toBe(1);
    expect(venueReducer(none, { type: "poiOptions", options: [] }).prompt).toBe(0);
  });

  it("ignores a search result that arrives after a newer fix resolved a venue", () => {
    const resolved = reduce([
      {
        type: "resolved",
        fix,
        resolution: {
          kind: "auto",
          venue: candidate("Met", 40),
          options: [candidate("Met", 40)],
        },
      },
    ]);
    expect(venueReducer(resolved, { type: "poiOptions", options: [poi] })).toBe(resolved);
  });

  it("lists MapKit places for a scan without raising the prompt", () => {
    const none = reduce([{ type: "resolved", fix, quiet: true, resolution: { kind: "none" } }]);
    const state = venueReducer(none, {
      type: "poiOptions",
      options: [poi],
      quiet: true,
    });
    expect(state.options).toEqual([poi]);
    expect(state.prompt).toBe(0);
  });

  it("replaces a confirmed place with its seeded venue and lifts its dismissal", () => {
    const none = reduce([
      { type: "resolved", fix, resolution: { kind: "none" } },
      { type: "poiOptions", options: [poi] },
      { type: "dismissed", at: fix.at },
    ]);
    const state = venueReducer(none, {
      type: "chosen",
      replaces: poi,
      option: {
        kind: "seeded",
        venueId: "id-gallery" as Id<"museums">,
        name: "Small Gallery",
        distanceM: 80,
      },
      day: today,
    });
    expect(state.status).toBe("resolved");
    expect(state.venue?.venueId).toBe("id-gallery");
    expect(state.options).toEqual([state.venue]);
    expect(state.notHere).toEqual({});
    expect(state.picked).toEqual({ venueId: "id-gallery", ...today });
  });
});

describe('"Not here"', () => {
  const choose = reduce([
    { type: "hydrated", at: fix.at, visit: visitAt("Old", fix.at - 1000) },
    {
      type: "resolved",
      fix,
      resolution: {
        kind: "choose",
        options: [candidate("Met", 90), candidate("Neue", 300)],
      },
    },
  ]);

  it("keeps a visit paused elsewhere and stops asking about the listed museums for two hours", () => {
    const dismissed = venueReducer(choose, { type: "dismissed", at: fix.at });
    expect(dismissed.visit?.localId).toBe("local-Old");
    const later = (ms: number, names: string[]) =>
      venueReducer(dismissed, {
        type: "resolved",
        fix: { ...fix, at: fix.at + ms },
        resolution: {
          kind: "choose",
          options: names.map((name, index) => candidate(name, 90 + index * 100)),
        },
      });
    const again = later(FIX_MAX_AGE_MS, ["Met", "Neue"]);
    expect(again).toMatchObject({ status: "choose", prompt: dismissed.prompt });
    expect(later(FIX_MAX_AGE_MS, ["Neue", "Guggenheim"]).prompt).toBe(dismissed.prompt);
    expect(later(FIX_MAX_AGE_MS, ["A", "B"]).prompt).toBe(dismissed.prompt + 1);
    expect(later(NOT_HERE_MS, ["Met", "Neue"]).prompt).toBe(dismissed.prompt + 1);
    const metAlone = (ms: number) =>
      venueReducer(dismissed, {
        type: "resolved",
        fix: { ...fix, at: fix.at + ms },
        resolution: {
          kind: "auto",
          venue: candidate("Met", 40),
          options: [candidate("Met", 40)],
        },
      });
    expect(metAlone(NOT_HERE_MS - 1)).toMatchObject({
      status: "none",
      venue: undefined,
    });
    expect(metAlone(NOT_HERE_MS).venue?.name).toBe("Met");
    const home = venueReducer(dismissed, {
      type: "resolved",
      fix: { ...fix, at: fix.at + FIX_MAX_AGE_MS },
      resolution: {
        kind: "auto",
        venue: candidate("Old", 40),
        options: [candidate("Old", 40)],
      },
    });
    expect(activeVisit(home)?.localId).toBe("local-Old");
  });

  it("drops a museum picked earlier once it is turned down", () => {
    const met = {
      kind: "seeded" as const,
      venueId: "id-Met" as Id<"museums">,
      name: "Met",
    };
    const picked = venueReducer(choose, {
      type: "chosen",
      option: met,
      replaces: met,
      day: today,
    });
    const dismissed = venueReducer(picked, { type: "dismissed", at: fix.at });
    expect(dismissed.picked).toBeUndefined();
    expect(Object.keys(dismissed.notHere).sort()).toEqual(["id-Met", "id-Neue"]);
  });

  it("drops the venue when tapped over a resolved venue, keeping the options and pausing its visit", () => {
    const resolved = reduce([
      {
        type: "resolved",
        fix,
        resolution: {
          kind: "auto",
          venue: candidate("Met", 40),
          options: [candidate("Met", 40)],
        },
      },
      { type: "visitStarted", visit: visitAt("Met", fix.at) },
    ]);
    const dismissed = venueReducer(resolved, { type: "dismissed", at: fix.at });
    expect(dismissed).toMatchObject({
      status: "none",
      venue: undefined,
      visit: { localId: "local-Met" },
      notHere: { "id-Met": fix.at + NOT_HERE_MS },
    });
    expect(dismissed.options.map((option) => option.name)).toEqual(["Met"]);
    expect(venueContext(dismissed)).toEqual({});
  });
});

describe("visits and the scan context", () => {
  const resolved = reduce([
    {
      type: "resolved",
      fix,
      resolution: {
        kind: "auto",
        venue: candidate("Met", 40),
        options: [candidate("Met", 40)],
      },
    },
  ]);

  it("keeps the local visit link before its remote ID is available", () => {
    expect(venueContext(resolved)).toEqual({ venueId: "id-Met" });
    const started = venueReducer(resolved, {
      type: "visitStarted",
      visit: visitAt("Met", fix.at),
    });
    expect(venueContext(started)).toEqual({
      venueId: "id-Met",
      visitLocalId: "local-Met",
    });
    const remote = venueReducer(started, {
      type: "visitStarted",
      visit: visitAt("Met", fix.at, "remote-1"),
    });
    expect(venueContext(remote)).toEqual({
      venueId: "id-Met",
      visitLocalId: "local-Met",
      visitId: "remote-1",
    });
  });

  it("never attaches a visit from another venue", () => {
    const state = venueReducer(resolved, {
      type: "visitStarted",
      visit: visitAt("Old", fix.at, "remote-old"),
    });
    expect(venueContext(state)).toEqual({ venueId: "id-Met" });
    expect(venueContext(initialVenueState)).toEqual({});
  });

  it("is active only while the phone is at the visit museum, so the bar and pill stay quiet elsewhere", () => {
    const visit = visitAt("Met", fix.at);
    expect(activeVisit(venueReducer(resolved, { type: "visitStarted", visit }))).toEqual(visit);
    const away = reduce(
      [
        { type: "visitStarted", visit },
        {
          type: "resolved",
          fix: { ...fix, at: fix.at + FIX_MAX_AGE_MS },
          resolution: { kind: "none" },
        },
      ],
      resolved,
    );
    expect(away.visit).toEqual(visit);
    expect(activeVisit(away)).toBeUndefined();
    const elsewhere = venueReducer(away, {
      type: "resolved",
      fix: { ...fix, at: fix.at + 2 * FIX_MAX_AGE_MS },
      resolution: {
        kind: "auto",
        venue: candidate("Neue", 30),
        options: [candidate("Neue", 30)],
      },
    });
    expect(activeVisit(elsewhere)).toBeUndefined();
    expect(venueContext(elsewhere)).toEqual({ venueId: "id-Neue" });
  });

  it("restores a visit from an earlier day paused, with no venue until a fix finds its museum", () => {
    const restored = reduce([{ type: "hydrated", at: fix.at + DAY, visit: visitAt("Met", fix.at) }]);
    expect(restored.visit?.localId).toBe("local-Met");
    expect(venueContext(restored)).toEqual({});
    const back = venueReducer(restored, {
      type: "resolved",
      fix: { ...fix, at: fix.at + DAY },
      resolution: { kind: "auto", venue: candidate("Met", 40), options: [candidate("Met", 40)] },
    });
    expect(venueContext(back)).toEqual({ venueId: "id-Met", visitLocalId: "local-Met" });
  });

  it("shows the hydrated visit as the venue before the first fix", () => {
    const state = reduce([{ type: "hydrated", at: fix.at, visit: visitAt("Met", fix.at, "remote-1") }]);
    expect(state.status).toBe("idle");
    expect(venueContext(state)).toEqual({
      venueId: "id-Met",
      visitLocalId: "local-Met",
      visitId: "remote-1",
    });
  });
});

describe("fix reuse", () => {
  it("reuses a fix for three minutes unless the app was backgrounded", () => {
    const resolved = reduce([{ type: "resolved", fix, resolution: { kind: "none" } }]);
    expect(needsFix(initialVenueState, fix.at)).toBe(true);
    expect(needsFix(resolved, fix.at + FIX_MAX_AGE_MS - 1)).toBe(false);
    expect(needsFix(resolved, fix.at + FIX_MAX_AGE_MS)).toBe(true);
    expect(needsFix(venueReducer(resolved, { type: "backgrounded" }), fix.at + 1)).toBe(true);
  });
});

describe("a visit ended by hand", () => {
  const resolved = reduce([
    {
      type: "resolved",
      fix,
      resolution: {
        kind: "auto",
        venue: candidate("Met", 40),
        options: [candidate("Met", 40)],
      },
    },
    { type: "visitStarted", visit: visitAt("Met", fix.at) },
  ]);

  it("is remembered for the rest of its day at that museum only", () => {
    const ended = venueReducer(resolved, {
      type: "visitEnded",
      localId: "local-Met",
      at: fix.at,
    });
    expect(ended.visit).toBeUndefined();
    expect(endedToday(ended, "id-Met" as Id<"museums">, fix.at + 60_000)).toBe(true);
    expect(endedToday(ended, "id-Neue" as Id<"museums">, fix.at + 60_000)).toBe(false);
    expect(endedToday(ended, "id-Met" as Id<"museums">, fix.at + 24 * 60 * 60 * 1000)).toBe(false);
    expect(
      venueReducer(ended, {
        type: "visitStarted",
        visit: visitAt("Met", fix.at + 1),
      }).ended,
    ).toBeUndefined();
  });

  it("is forgotten when that museum is confirmed again, but not when another one is", () => {
    const ended = venueReducer(resolved, {
      type: "visitEnded",
      localId: "local-Met",
      at: fix.at,
    });
    const met = ended.options[0];
    expect(met.kind === "seeded" && met.venueId).toBe("id-Met");
    const neue = {
      kind: "seeded" as const,
      venueId: "id-Neue" as Id<"museums">,
      name: "Neue",
      distanceM: 300,
    };
    expect(
      endedToday(
        venueReducer(ended, {
          type: "chosen",
          option: neue,
          replaces: neue,
          day: today,
        }),
        "id-Met" as Id<"museums">,
        fix.at,
      ),
    ).toBe(true);
    expect(
      venueReducer(ended, {
        type: "chosen",
        option: met as typeof neue,
        replaces: met,
        day: today,
      }).ended,
    ).toBeUndefined();
  });

  it("counts the day the visit was ended, not the day it started", () => {
    const ended = venueReducer(resolved, { type: "visitEnded", localId: "local-Met", at: fix.at + DAY });
    expect(endedToday(ended, "id-Met" as Id<"museums">, fix.at)).toBe(false);
    expect(endedToday(ended, "id-Met" as Id<"museums">, fix.at + DAY)).toBe(true);
  });

  it("is restored at launch and forgotten when a visit starts there", () => {
    const restored = venueReducer(initialVenueState, {
      type: "hydrated",
      at: fix.at,
      ended: {
        venueId: "id-Met" as Id<"museums">,
        visitedOn: "1970-01-01",
        timeZone: "UTC",
      },
    });
    expect(endedToday(restored, "id-Met" as Id<"museums">, fix.at)).toBe(true);
    expect(
      venueReducer(restored, {
        type: "hydrated",
        at: fix.at,
        visit: visitAt("Met", fix.at),
      }).ended,
    ).toBeUndefined();
  });
});

describe("the visit a save links to", () => {
  const met = "id-Met" as Id<"museums">;
  const neue = "id-Neue" as Id<"museums">;
  const open = visitAt("Met", fix.at);
  const capture = (at: number) => ({ at, visitedOn: new Date(at).toISOString().slice(0, 10), timeZone: "UTC" });

  it("joins the open visit at its museum from its day on, even before its start or days later", () => {
    expect(planSaveVisit(open, met, capture(fix.at + 60_000), fix.at + 60_000)).toBe("join");
    expect(planSaveVisit(open, met, capture(fix.at - 60_000), fix.at)).toBe("join");
    expect(planSaveVisit(open, met, capture(fix.at + 3 * DAY), fix.at + 3 * DAY)).toBe("join");
  });

  it("never starts a second visit today while one is open; the open one has to end first", () => {
    expect(planSaveVisit(open, neue, capture(fix.at + 60_000), fix.at + 60_000)).toBe("endFirst");
    expect(planSaveVisit(open, neue, capture(fix.at + 3 * DAY), fix.at + 3 * DAY)).toBe("endFirst");
    expect(planSaveVisit(undefined, neue, capture(fix.at), fix.at)).toBe("start");
  });

  it("gives a capture from an earlier day, or from before the open visit began, a visit of its own", () => {
    const twoDaysIn = fix.at + 2 * DAY;
    expect(planSaveVisit(open, neue, capture(fix.at + DAY), twoDaysIn)).toBe("past");
    expect(planSaveVisit(undefined, met, capture(fix.at), twoDaysIn)).toBe("past");
    expect(planSaveVisit(open, neue, capture(fix.at - 60_000), fix.at)).toBe("past");
    expect(planSaveVisit({ ...open, visitedOn: "1970-01-03" }, met, capture(fix.at), twoDaysIn)).toBe("past");
  });
});
