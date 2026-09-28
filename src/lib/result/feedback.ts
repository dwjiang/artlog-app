import type { ConvexReactClient } from "convex/react";

import { signPayload } from "@/lib/attested-write";
import { reportError } from "@/lib/observability";
import { rejectionPayload } from "@/shared/attestation/attested-payloads";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export type Rejection = { pending: Promise<Id<"feedback"> | null>; consumed: boolean };

const labelRejections = new Map<Id<"scans">, Rejection>();

export function consumeRejection(rejection: Rejection | undefined) {
  if (!rejection || rejection.consumed) return;
  rejection.consumed = true;
  return rejection.pending;
}

export function handOffLabelRejection(scanId: Id<"scans">, rejection: Rejection): void {
  labelRejections.set(scanId, rejection);
}

export function resolveWithLabel(
  client: Pick<ConvexReactClient, "mutation">,
  scanId: Id<"scans">,
  contributionId: Id<"contributions">,
): void {
  const pending = consumeRejection(labelRejections.get(scanId));
  labelRejections.delete(scanId);
  // Feedback may still be waiting for signal; neither navigation nor sharing waits on it.
  void pending
    ?.then(
      (feedbackId) =>
        feedbackId
        && client.mutation(api.feedback.resolveRejection, {
          feedbackId,
          resolution: { kind: "label", contributionId },
        }),
    )
    .catch((error: unknown) => {
      reportError(error, "result.resolve_label_feedback");
      console.warn("Could not resolve the rejection with this contribution", error);
    });
}

/** Records "Not right?" as an attested rejection; `null` when this device cannot attest. */
export async function rejectMatch(
  client: Pick<ConvexReactClient, "mutation">,
  scanId: Id<"scans">,
  objectId: Id<"objects">,
) {
  const signed = await signPayload(rejectionPayload(scanId, objectId));
  if (!signed) return null;
  return client.mutation(api.feedback.rejectMatch, {
    scanId,
    objectId,
    nonce: signed.nonce,
    assertionBase64: signed.assertionBase64,
  });
}

export function resolveWithRunnerUp(
  client: Pick<ConvexReactClient, "mutation">,
  feedbackId: Id<"feedback">,
  objectId: Id<"objects">,
): Promise<null> {
  return client.mutation(api.feedback.resolveRejection, {
    feedbackId,
    resolution: { kind: "runner_up", objectId },
  });
}
