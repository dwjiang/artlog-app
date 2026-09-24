import { anonymousOwner, switchOwner } from "@/lib/account/owner-store";
import { claimLocalJournal } from "@/db/repos/journal-claim";
import type { Id } from "../../../convex/_generated/dataModel";
import { clearLabelDraft, loadLabelDraft, saveLabelDraft } from "./draft";
import { formStateFromFlow, toSubmittedFields, unlockField } from "./fields";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

it("persists edit provenance per scan and clears it for a new label", async () => {
  const first = "scan-first" as Id<"scans">;
  const second = "scan-second" as Id<"scans">;
  const draft = unlockField(
    formStateFromFlow({
      stage: "verified",
      moderation: "clear",
      evidence: ["wikidata"],
      warnings: [],
      updatedAt: 1,
      fields: {
        title: { value: "Water Lilies", evidence: "wikidata", locked: true },
        artist: { value: "Claude Monet", evidence: "wikidata", locked: true },
      },
    }),
    "title",
  );
  expect(await loadLabelDraft(first)).toBeUndefined();
  await saveLabelDraft(first, draft);
  await saveLabelDraft(second, draft);
  const restored = await loadLabelDraft(first);
  expect(restored).toEqual(draft);
  expect(toSubmittedFields(restored!)?.title.edited).toBe(true);
  await clearLabelDraft(first);
  expect(await loadLabelDraft(first)).toBeUndefined();
  expect(await loadLabelDraft(second)).toEqual(draft);
});

it("restores a sharing draft only for the label or museum confirmation it belongs to", async () => {
  const scanId = "draft-origin" as Id<"scans">;
  const state = formStateFromFlow({
    stage: "verified",
    moderation: "clear",
    evidence: [],
    warnings: [],
    updatedAt: 1,
    fields: { title: { value: "My title", evidence: "ocr", locked: false } },
  });
  await saveLabelDraft(scanId, state);
  expect(await loadLabelDraft(scanId, 2)).toBeUndefined();
  await saveLabelDraft(scanId, state, 2);
  expect(await loadLabelDraft(scanId, 2)).toEqual(state);
  expect(await loadLabelDraft(scanId)).toBeUndefined();
  expect(await loadLabelDraft(scanId, 3)).toBeUndefined();
  await clearLabelDraft(scanId);
  expect(await loadLabelDraft(scanId, 2)).toBeUndefined();
});

it("claims anonymous label edits and hides account drafts after sign-out", async () => {
  const scanId = "scoped-draft" as Id<"scans">;
  const state = formStateFromFlow({
    stage: "verified",
    moderation: "clear",
    evidence: [],
    warnings: [],
    updatedAt: 1,
    fields: {
      title: { value: "Private title", evidence: "ocr", locked: false },
    },
  });
  await saveLabelDraft(scanId, state);
  await claimLocalJournal(anonymousOwner(), "account:a", "claim-draft");
  expect(await loadLabelDraft(scanId)).toBeUndefined();
  switchOwner("account:a");
  expect(await loadLabelDraft(scanId)).toEqual(state);
  switchOwner(anonymousOwner());
  expect(await loadLabelDraft(scanId)).toBeUndefined();
});
