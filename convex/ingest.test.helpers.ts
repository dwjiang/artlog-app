import { createHash } from "node:crypto";

import type { FunctionArgs } from "convex/server";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fileHash } from "./lib/fileStorage";
import { ORB_CONTENT_TYPE, packOrb } from "./lib/orbStorage";
import { r2 } from "./lib/r2";
import { packVector } from "./lib/vectorStore";
import type { Harness } from "./test.helpers";

export async function uploadTestFiles(t: Harness, bodies: Blob[], existing: (Id<"files"> | undefined)[] = []) {
  const specs = await Promise.all(
    bodies.map(async (body, i) => ({
      contentType: body.type as "application/octet-stream" | "application/vnd.artlog.embedding",
      size: body.size,
      sha256: await fileHash(body),
      md5: createHash("md5")
        .update(new Uint8Array(await body.arrayBuffer()))
        .digest("base64"),
      existingId: existing[i],
    })),
  );
  const files = await t.action(internal.ingestFiles.prepare, { rows: specs });
  for (const [i, file] of files.entries()) if (file.url) await r2.put(file.id, bodies[i]);
  await t.action(internal.ingestFiles.complete, { ids: files.map((file) => file.id) });
  return files.map((file, i) => ({ id: file.id, sha256: specs[i].sha256 }));
}

type VectorRow = Omit<
  FunctionArgs<typeof internal.ingest.upsertVectors>["rows"][number],
  "archiveId" | "contentHash"
> & { vector: number[] };
export async function importTestVectors(t: Harness, { rows }: { rows: VectorRow[] }) {
  const ids: Record<string, Id<"vectors">> = {};
  for (let start = 0; start < rows.length; start += 100) {
    const batch = rows.slice(start, start + 100);
    const existing = await t.query(internal.ingest.existingVectors, {
      rows: batch.map(({ modelVersion, viewKey }) => ({ modelVersion, viewKey })),
    });
    const files = await uploadTestFiles(
      t,
      batch.map((row) => packVector(row.vector)),
      existing.map((row) => row?.archiveId),
    );
    const result = await t.action(internal.ingest.upsertVectors, {
      rows: batch.map(({ vector: _vector, ...row }, i) => ({
        ...row,
        archiveId: files[i].id,
        contentHash: files[i].sha256,
      })),
    });
    Object.assign(ids, result.ids);
  }
  return { ids };
}

type OrbRow = Omit<FunctionArgs<typeof internal.ingest.upsertDescriptors>["rows"][number], "storageId" | "sha256"> & {
  descriptors: ArrayBuffer;
  keypoints: ArrayBuffer;
};
export async function importTestDescriptors(t: Harness, { rows }: { rows: OrbRow[] }) {
  const existing = await t.query(internal.ingest.existingDescriptors, { objectKeys: rows.map((row) => row.objectKey) });
  const files = await uploadTestFiles(
    t,
    rows.map((row) => new Blob([packOrb(row.descriptors, row.keypoints)], { type: ORB_CONTENT_TYPE })),
    existing.map((row) => row?.storageId),
  );
  return t.action(internal.ingest.upsertDescriptors, {
    rows: rows.map(({ descriptors: _descriptors, keypoints: _keypoints, ...row }, i) => ({
      ...row,
      storageId: files[i].id,
      sha256: files[i].sha256,
    })),
  });
}
