import type { Id } from "../../../convex/_generated/dataModel";
import type { LabelFlowDisplay } from "../../../convex/lib/validators";
import { loadLabelDraft, saveLabelDraft } from "./draft";
import { formStateFromFlow, unlockField } from "./fields";
import { runLabelFlowForScan } from "./label-deps";

const mockAction = jest.fn();
jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
jest.mock("@/lib/convex-client", () => ({
  convex: { action: (...args: unknown[]) => mockAction(...args) },
}));
jest.mock("@/lib/embed/embedder", () => ({ embedder: {} }));
jest.mock("@/lib/orb/extract", () => ({ extractOrb: jest.fn() }));
jest.mock("../../../modules/vision-rect/src", () => ({ getVisionRect: jest.fn() }));

it("clears the previous sharing draft before reading a replacement label", async () => {
  const scanId = "replacement-scan" as Id<"scans">;
  const flow: LabelFlowDisplay = {
    stage: "verified",
    moderation: "clear",
    warnings: [],
    evidence: ["qr"],
    updatedAt: 1,
    fields: { title: { value: "Water Lilies", evidence: "qr", locked: true } },
  };
  await saveLabelDraft(scanId, unlockField(formStateFromFlow(flow), "title"));
  mockAction.mockImplementation(async () => {
    expect(await loadLabelDraft(scanId)).toBeUndefined();
    return flow;
  });
  await expect(
    runLabelFlowForScan(scanId, { qrUrl: "https://museum.example/replacement" }),
  ).resolves.toEqual(flow);
  expect(mockAction).toHaveBeenCalledTimes(2);
});
