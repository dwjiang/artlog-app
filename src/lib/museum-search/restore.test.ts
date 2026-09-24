import * as drafts from "@/lib/label/draft";
import { formStateFromFlow, setFieldValue, unlockField } from "@/lib/label/fields";

import type { Id } from "../../../convex/_generated/dataModel";
import { confirmed, verified } from "./__fixtures__/search";
import { restoreConfirmedMuseumFlow } from "./restore";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
const scan = {
  scanId: "scan-1" as Id<"scans">,
  museumSearch: confirmed,
  labelFlow: verified,
};

beforeEach(async () => {
  await drafts.clearLabelDraft(scan.scanId);
});
afterEach(() => jest.restoreAllMocks());

it("restores an unchanged museum confirmation without requiring a local draft", async () => {
  jest.spyOn(drafts, "loadLabelDraft");
  expect(await restoreConfirmedMuseumFlow(scan)).toEqual(verified);
  expect(drafts.loadLabelDraft).not.toHaveBeenCalled();
});

it.each([undefined, verified.sourceUrl, "https://museum.example/another-page"])(
  "restores a sharing edit with source %s",
  async (sourceUrl) => {
    const draft = setFieldValue(unlockField(formStateFromFlow(verified), "title"), "title", "My title");
    await drafts.saveLabelDraft(scan.scanId, draft, confirmed.updatedAt);
    const flow = {
      ...verified,
      updatedAt: 3,
      sourceUrl,
      fields: {
        ...verified.fields,
        title: { value: "My title", evidence: "ocr" as const, locked: false },
      },
    };
    expect(await restoreConfirmedMuseumFlow({ ...scan, labelFlow: flow })).toEqual(flow);
  },
);

it.each([undefined, verified.sourceUrl])(
  "does not restore a replacement label even when its source is %s",
  async (sourceUrl) => {
    const labelFlow = { ...verified, updatedAt: 3, sourceUrl };
    expect(await restoreConfirmedMuseumFlow({ ...scan, labelFlow })).toBeUndefined();
    await drafts.saveLabelDraft(scan.scanId, formStateFromFlow(verified));
    expect(await restoreConfirmedMuseumFlow({ ...scan, labelFlow })).toBeUndefined();
  },
);

it("does not use a draft from an earlier museum confirmation", async () => {
  await drafts.saveLabelDraft(scan.scanId, formStateFromFlow(verified), confirmed.updatedAt - 1);
  expect(
    await restoreConfirmedMuseumFlow({
      ...scan,
      labelFlow: { ...verified, updatedAt: 3 },
    }),
  ).toBeUndefined();
});

it("never restores a result whose fields failed moderation, even with a draft", async () => {
  await drafts.saveLabelDraft(scan.scanId, formStateFromFlow(verified), confirmed.updatedAt);
  expect(
    await restoreConfirmedMuseumFlow({
      ...scan,
      labelFlow: { ...verified, moderation: "flagged", fields: {} },
    }),
  ).toBeUndefined();
});

it("surfaces draft storage failures instead of treating edits as absent", async () => {
  jest.spyOn(drafts, "loadLabelDraft").mockRejectedValue(new Error("Disk read failed"));
  await expect(
    restoreConfirmedMuseumFlow({
      ...scan,
      labelFlow: { ...verified, sourceUrl: undefined },
    }),
  ).rejects.toThrow("Disk read failed");
});
