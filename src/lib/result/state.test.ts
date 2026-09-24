import { ConvexError } from "convex/values";

import { toResultViewState } from "./state";
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

it("promotes a chosen runner-up to a maybe and drops rejected works from the suggestions", () => {
  const view = toResultViewState(confidentScan, {
    chosenObjectId: bridge.objectId,
    rejectedObjectIds: [lilies.objectId],
  });
  expect(view).toMatchObject({
    kind: "soft",
    primary: bridge,
    runnerUps: [haystacks],
  });
  expect(view.docent).toBeUndefined();
});

it("keeps the primary while a rejection is unresolved and only hides it from the suggestions", () => {
  const view = toResultViewState(confidentScan, {
    rejectedObjectIds: [lilies.objectId, bridge.objectId],
  });
  expect(view.primary).toEqual(lilies);
  expect(view.runnerUps).toEqual([haystacks]);
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
