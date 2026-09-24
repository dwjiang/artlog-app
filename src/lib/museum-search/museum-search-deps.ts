import { getPendingScan } from "@/db/repos/pending-scans";
import { convex } from "@/lib/convex-client";
import { imageCheckDeps } from "@/lib/label/label-deps";
import model from "@/shared/model/model-version.json";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MuseumSearchDisplay } from "../../../convex/lib/validators";
import { runMuseumSearch, type MuseumSearchStage } from "./flow";
import { restoreConfirmedMuseumFlow } from "./restore";

const running = new Map<Id<"scans">, ReturnType<typeof runMuseumSearch>>();

export function runMuseumSearchForScan(input: {
  scanId: Id<"scans">;
  localId: string;
  stored?: MuseumSearchDisplay;
  canContinue: () => boolean;
  onStage: (stage: MuseumSearchStage) => void;
}) {
  const existing = running.get(input.scanId);
  if (existing) return existing;
  // Navigating away and back while the server searches must not dispatch a second paid request.
  const task = (async () => {
    // The public subscription can lag an action finishing during navigation.
    const latest = input.stored ? undefined : await convex.query(api.scans.get, { scanId: input.scanId });
    if (latest?.museumSearch?.stage === "none") {
      return { stage: "none" as const, reason: latest.museumSearch.reason };
    }
    if (latest?.museumSearch?.stage === "confirmed") {
      const flow = await restoreConfirmedMuseumFlow(latest);
      return flow
        ? {
            stage: "done" as const,
            flow,
            confirmedAt: latest.museumSearch.updatedAt,
          }
        : { stage: "none" as const, reason: "model_error" };
    }
    return runMuseumSearch({
      ...input,
      stored: input.stored ?? (latest?.museumSearch?.stage === "exhibitions" ? latest.museumSearch : undefined),
      api: {
        searchExhibitions: (args) => convex.action(api.museumSearch.searchExhibitions, args),
        confirmSearchCandidate: (args) => convex.action(api.museumSearch.confirmSearchCandidate, args),
      },
      images: imageCheckDeps,
      inputSize: model.inputSize,
      getCapture: getPendingScan,
    });
  })().finally(() => {
    running.delete(input.scanId);
  });
  running.set(input.scanId, task);
  return task;
}
