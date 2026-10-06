import { exhibitionStatus, exhibitionsByTiming, friendNames } from "./exhibition-timing";
import type { Exhibition, ExploreFriend } from "./types";

const TODAY = "2026-10-04";

function show(id: string, startsOn: string, endsOn: string): Exhibition {
  return { id, title: id, museumId: "aic", startsOn, endsOn, image: { uri: "", label: id }, friends: [] };
}

describe("exhibition status", () => {
  it.each([
    ["2026-10-04", "Ends today"],
    ["2026-10-05", "Ends tomorrow"],
    ["2026-10-12", "Ends in 8 days"],
    ["2026-10-18", "Ends in 2 weeks"],
    ["2026-10-24", "Ends in 2 weeks"],
    ["2026-10-25", "Ends in 3 weeks"],
    ["2026-11-03", "Ends in 4 weeks"],
  ])("counts down the last 30 days to a closing on %s", (endsOn, label) => {
    expect(exhibitionStatus(show("a", "2026-07-03", endsOn), TODAY)).toEqual({ tone: "warning", label });
  });

  it("names the opening day of a show that has not opened", () => {
    expect(exhibitionStatus(show("a", "2026-10-17", "2027-02-28"), TODAY)).toEqual({
      tone: "accent",
      label: "Opens Oct 17",
    });
    expect(exhibitionStatus(show("a", "2026-10-05", "2027-02-28"), TODAY).label).toBe("Opens tomorrow");
  });

  it("calls a show that opened in the last two weeks just opened", () => {
    expect(exhibitionStatus(show("a", "2026-09-25", "2026-12-12"), TODAY)).toEqual({
      tone: "muted",
      label: "Just opened",
    });
  });

  it("gives the closing date of a show that is on view for a while", () => {
    expect(exhibitionStatus(show("a", "2026-09-12", "2027-01-18"), TODAY)).toEqual({
      tone: "muted",
      label: "Until Jan 18",
    });
  });

  it("prefers the countdown for a short show that opened recently", () => {
    expect(exhibitionStatus(show("a", "2026-10-01", "2026-10-10"), TODAY).label).toBe("Ends in 6 days");
  });
});

describe("exhibitions by timing", () => {
  const closed = show("closed", "2026-06-01", "2026-10-03");
  const endingLater = show("ending-later", "2026-08-27", "2026-10-18");
  const endingFirst = show("ending-first", "2026-07-03", "2026-10-12");
  const openedEarlier = show("opened-earlier", "2026-09-12", "2027-01-18");
  const openedLater = show("opened-later", "2026-09-25", "2026-12-12");
  const longRunning = show("long-running", "2026-03-01", "2027-03-01");
  const opensLater = show("opens-later", "2026-10-24", "2027-02-07");
  const opensFirst = show("opens-first", "2026-10-17", "2027-02-28");
  const all = [closed, endingLater, endingFirst, openedEarlier, openedLater, longRunning, opensLater, opensFirst];
  const ids = (timing: Parameters<typeof exhibitionsByTiming>[1]) =>
    exhibitionsByTiming(all, timing, TODAY).map((exhibition) => exhibition.id);

  it("lists shows closing within 30 days, soonest first", () => {
    expect(ids("ending")).toEqual(["ending-first", "ending-later"]);
  });

  it("lists shows that opened within 30 days, newest first", () => {
    expect(ids("opened")).toEqual(["opened-later", "opened-earlier"]);
  });

  it("lists shows that have not opened yet, soonest first", () => {
    expect(ids("upcoming")).toEqual(["opens-first", "opens-later"]);
  });
});

describe("friend names", () => {
  const friend = (name: string): ExploreFriend => ({ profileId: name, name, avatar: "klee" });

  it.each([
    [["Maya"], "Maya"],
    [["Maya", "Sam"], "Maya and Sam"],
    [["Maya", "Priya", "Sam"], "Maya, Priya and Sam"],
    [["Maya", "Jonah", "Priya", "Sam"], "Maya, Jonah and 2 others"],
  ])("names %j as %s", (names, text) => {
    expect(friendNames(names.map(friend))).toBe(text);
  });
});
