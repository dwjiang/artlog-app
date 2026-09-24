import type { FunctionReturnType } from "convex/server";
import { File, UploadType } from "expo-file-system";

import type { PendingScan } from "@/db/schema";
import { signPayload } from "@/lib/attested-write";
import { isLabelCapture } from "@/lib/capture/photo-draft";
import { convex } from "@/lib/convex-client";
import { captureFileUri } from "@/lib/files/photos";
import { errorMessage, isNetworkError } from "@/lib/network-error";
import { resolveWithLabel } from "@/lib/result/feedback";
import { contributionPayload } from "@/shared/attestation/attested-payloads";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { removeFile, resizeCropForContribution } from "./crop";
import { saveLabelDraft } from "./draft";
import { differsFromFlow, toSubmittedFields, toVerifyInput, type LabelFormState } from "./fields";
import { labelApi } from "./label-deps";

export type ContributionOutcome = FunctionReturnType<typeof api.contributions.contribute>;

export type ContributeInput = {
  scanId: Id<"scans">;
  capture: Pick<PendingScan, "localId" | "owner" | "photoPath" | "cropPath" | "descriptors" | "keypoints">;
  state: LabelFormState;
  museumSearchUpdatedAt?: number;
};

export async function uploadCrop(uploadUrl: string, uri: string): Promise<Id<"_storage">> {
  const response = await new File(uri).upload(uploadUrl, {
    httpMethod: "POST",
    uploadType: UploadType.BINARY_CONTENT,
    headers: { "Content-Type": "image/jpeg" },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Crop upload failed with HTTP ${response.status}`);
  }
  const { storageId } = JSON.parse(response.body) as {
    storageId: Id<"_storage">;
  };
  return storageId;
}

// The shared index receives the fingerprint, label fields, and a small crop, never the full photo.
export async function contributeLabel({
  scanId,
  capture,
  state,
  museumSearchUpdatedAt,
}: ContributeInput): Promise<ContributionOutcome> {
  if (isLabelCapture(capture)) {
    throw new Error("An artwork photo is required to contribute to the shared index");
  }
  const fields = toSubmittedFields(state);
  if (!fields) throw new Error("A title and an artist are required to share");
  await saveLabelDraft(scanId, state, museumSearchUpdatedAt);
  // A previous attempt may have verified edits before its upload failed.
  const scan = await convex.query(api.scans.get, { scanId });
  if (scan?.labelFlow?.stage !== "verified" || differsFromFlow(state, scan.labelFlow)) {
    await labelApi.verifyLabel({ scanId, fields: toVerifyInput(state) });
  }
  const crop = await resizeCropForContribution(captureFileUri(capture.cropPath));
  try {
    const { uploadUrl } = await convex.mutation(api.contributions.requestCropUpload, {});
    const cropStorageId = await uploadCrop(uploadUrl, crop.uri);
    const signed = await signPayload(contributionPayload({ scanId, cropStorageId, fields }));
    if (!signed) throw new Error("This device can’t share contributions yet");
    const result = await convex.action(api.contributions.contribute, {
      scanId,
      descriptors: capture.descriptors,
      keypoints: capture.keypoints,
      fields,
      cropStorageId,
      nonce: signed.nonce,
      assertionBase64: signed.assertionBase64,
    });
    resolveWithLabel(convex, scanId, result.contributionId);
    return result;
  } finally {
    removeFile(crop.uri);
  }
}

export function contributionErrorMessage(error: unknown): string {
  if (isNetworkError(error)) {
    return "No connection — it will be saved to the shared index when you’re back online";
  }
  switch (errorMessage(error)) {
    case "rate_limited":
      return "Try again in a minute";
    case "label_unverified":
    case "field_mismatch":
      return "Verify the label again to save it to the shared index";
    case "invalid_scan":
      return "This scan isn’t tied to a museum, so it can’t be saved to the shared index";
    case "This device can’t share contributions yet":
      return "This device can’t save to the shared index yet";
    default:
      return "Couldn’t save to the shared index right now";
  }
}
