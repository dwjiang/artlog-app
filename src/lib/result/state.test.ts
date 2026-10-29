import { ConvexError } from "convex/values";

import {
  bridge,
  confidentScan,
  failedScan,
  haystacks,
  lilies,
  missScan,
  pendingScan,
  softScan,
  unsupportedScan,
} from "@/components/scan/result/__fixtures__/scan";

import { toResultViewState } from "./state";

it("is loading until the subscription answers or while the server is still identifying", () => {
  expect(toResultViewState(undefined)).toEqual({
    kind: "loading",
    runnerUps: [],
    editable: false,
  });
  expect(toResultViewState(pendingScan).kind).toBe("loading");
});

it("names a confident match and carries its prose, sources and news", () => {
  const view = toResultViewState(confidentScan);
  expect(view).toMatchObject({
    kind: "confident",
    primary: lilies,
    runnerUps: [bridge, haystacks],
    editable: true,
  });
  expect(view.docent).toBe(confidentScan.docent);
  expect(view.factSheet).toBe(confidentScan.factSheet);
});

it("shows a soft match as a maybe without prose", () => {
  const view = toResultViewState(softScan);
  expect(view).toMatchObject({
    kind: "soft",
    primary: softScan.best,
    runnerUps: [haystacks],
    editable: true,
  });
  expect(view.docent).toBeUndefined();
  expect(view.picked).toBeUndefined();
});

it("leaves a miss unidentified with every candidate offered as a suggestion", () => {
  const view = toResultViewState(missScan);
  expect(view.kind).toBe("unidentified");
  expect(view.primary).toBeUndefined();
  expect(view.runnerUps.map((candidate) => candidate.objectId)).toEqual([haystacks.objectId, bridge.objectId]);
  expect(view.editable).toBe(true);
});

it("names a chosen runner-up as the owner's pick, saved as a maybe, and restores the original match among the suggestions", () => {
  const view = toResultViewState(confidentScan, {
    chosenObjectId: bridge.objectId,
  });
  expect(view).toMatchObject({
    kind: "soft",
    picked: true,
    primary: bridge,
    runnerUps: [lilies, haystacks],
  });
  expect(view.docent).toBeUndefined();
});

it("keeps every other candidate in its original order across repeated selections", () => {
  for (const chosen of [bridge, haystacks, lilies, bridge]) {
    const view = toResultViewState(confidentScan, { chosenObjectId: chosen.objectId });
    expect(view.primary).toEqual(chosen);
    expect(view.runnerUps).toEqual([lilies, bridge, haystacks].filter((candidate) => candidate !== chosen));
  }
});

it("shows each candidate once even when the primary also appears in the runner-ups", () => {
  const scan = { ...confidentScan, runnerUps: [{ ...lilies }, bridge, { ...bridge }, haystacks] };
  expect(toResultViewState(scan).runnerUps).toEqual([bridge, haystacks]);
  expect(toResultViewState(scan, { chosenObjectId: bridge.objectId }).runnerUps).toEqual([lilies, haystacks]);
});

it("ignores a chosen id that is not among the candidates", () => {
  const view = toResultViewState(softScan, { chosenObjectId: "obj-unknown" as never });
  expect(view).toMatchObject({
    kind: "soft",
    primary: softScan.best,
  });
  expect(view.picked).toBeUndefined();
});

it("passes unsupported and failed scans through with their errors", () => {
  expect(toResultViewState(unsupportedScan)).toEqual({
    kind: "unsupported",
    runnerUps: [],
    editable: false,
    error: "Update the app to identify.",
  });
  expect(toResultViewState(failedScan)).toEqual({
    kind: "failed",
    runnerUps: [],
    editable: false,
    error: "bad_features",
  });
  expect(toResultViewState(null)).toMatchObject({
    kind: "failed",
    error: "scan_not_found",
  });
  expect(toResultViewState(new ConvexError({ code: "invalid_scan" }))).toMatchObject({
    kind: "failed",
    error: "invalid_scan",
  });
});

it("names the owner's confirmed work instead of the scan's candidates, with its own background", () => {
  const confirmed = {
    source: "label" as const,
    fields: { title: "Pond at dusk", artist: "Unknown painter" },
    confirmedAt: 5,
  };
  const view = toResultViewState(
    { ...missScan, confirmed, docentStatus: "writing" },
    {
      chosenObjectId: missScan.runnerUps?.[0]?.objectId,
    },
  );
  expect(view).toEqual({
    kind: "confirmed",
    confirmed,
    runnerUps: [],
    editable: true,
    docent: undefined,
    docentStatus: "writing",
    factSheet: undefined,
  });
});

it.each(["unsupported_version", "failed"] as const)("shows confirmed details after recognition is %s", (status) => {
  const confirmed = { source: "manual" as const, fields: { title: "Pond" }, confirmedAt: 1 };
  expect(toResultViewState({ ...missScan, status, confirmed })).toMatchObject({
    kind: "confirmed",
    confirmed,
    editable: true,
  });
});

it.each(["identified", "unsupported_version", "failed"] as const)(
  "names a linked catalogue work even when recognition is %s",
  (status) => {
    const { probability: _, ...terrace } = bridge;
    const view = toResultViewState({
      ...missScan,
      status,
      outcome: "confident",
      best: terrace,
      runnerUps: [],
      linked: { source: "label" },
      docent: confidentScan.docent,
    });
    expect(view).toMatchObject({ kind: "confident", primary: terrace, linked: "label", docent: confidentScan.docent });
  },
);

it("ignores an earlier runner-up selection after the owner links that work", () => {
  const view = toResultViewState(
    { ...confidentScan, linked: { source: "label" }, runnerUps: [] },
    { chosenObjectId: lilies.objectId },
  );
  expect(view).toMatchObject({ kind: "confident", primary: lilies, linked: "label", runnerUps: [], editable: true });
  expect(view.docent).toBe(confidentScan.docent);
  expect(view.factSheet).toBe(confidentScan.factSheet);
});
