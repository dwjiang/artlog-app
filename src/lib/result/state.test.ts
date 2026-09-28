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
  expect(view.rightNow).toBe(confidentScan.rightNow);
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
  expect(view.rightNow).toBeUndefined();
});

it("leaves a miss unidentified with every candidate offered as a suggestion", () => {
  const view = toResultViewState(missScan);
  expect(view.kind).toBe("unidentified");
  expect(view.primary).toBeUndefined();
  expect(view.runnerUps.map((candidate) => candidate.objectId)).toEqual([haystacks.objectId, bridge.objectId]);
  expect(view.editable).toBe(true);
});

it("promotes a chosen runner-up to a maybe and restores the original match among the suggestions", () => {
  const view = toResultViewState(confidentScan, {
    chosenObjectId: bridge.objectId,
  });
  expect(view).toMatchObject({
    kind: "soft",
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
  expect(toResultViewState(softScan, { chosenObjectId: "obj-unknown" as never })).toMatchObject({
    kind: "soft",
    primary: softScan.best,
  });
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
