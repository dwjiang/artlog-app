# Corpus inventory and import baseline

This snapshot was recorded on 2026-09-13 while planning the
[deferred production upload](../todos/production-upload/README.md). Paths,
counts, code excerpts, and fingerprints have not been revalidated during
documentation cleanup. Follow the upload plan to revalidate them before use.

## Local artifacts

The data relocation is complete: all 7,290 files retained their original
inodes, sizes, and timestamps, and the full corpus passed a local dry-run from
Documents. Production was not contacted or changed during that work.

| Local asset | Durable path under `/Users/dwjiang/Documents/Artlog Data/` |
| --- | --- |
| Complete merged corpus, feature shards, indexes, and hashes | `jobs/scratch/merged/` |
| Original metadata, raw feature shards, source snapshots, samples | `jobs/scratch/` |
| Dedupe provenance and audits | `jobs/out/02-05-2026-09-12-dedupe/` |
| v2 model, training rows, metrics, and development import audits | `jobs/out/02-09-2026-09-12-calibrator/` |
| Completed initial production import and its audits | `jobs/out/06-01-2026-09-13-production/` |
| Full local import plan after relocation | `full-corpus-dry-run-2026-09-13.json` |
| SHA-256 file inventory and relocation result | `relocation-manifest-2026-09-13.json`, `relocation-report-2026-09-13.json` |

The original workspace linked `jobs/scratch` and `jobs/out` to these durable
directories, with links excluded through its local Git exclude file. Existing
directory-only ignore patterns do not cover symlinks. Do not commit links or
data; other checkouts can pass absolute `--in` and `--checkpoint` paths directly.

## Corpus and production counts

| Table/stage | Full corpus input | Last verified production count |
| --- | ---: | ---: |
| museums | 3,924 required keys; not an import stage | 42,452 |
| artworks | 404,653 | 11,721 |
| objects | 409,973 | 15,427 |
| placements | 296,344 | 14,256 |
| vectors | 402,139 | 13,616 |
| descriptors | 397,047 | 10,000 |
| penalties | 409,973 zero assignments; not a table | 15,427 zero assignments verified |

There are 7,019 merged aliases and 402,954 metadata survivors; 397,047 survivors
have recognition features. Keep the metadata-only objects too. Do not invent
features for failed or missing images. Each indexed survivor has one selected
ORB reference; alternate embedding views remain separate vector rows. Raw
feature shards preserve the other extracted views' ORB data locally as well.

The full local dry-run fingerprint is
`ba7aa0f8539903ac1d0933d327875ca3b3db68f9d9b2506cde802f11cee62565`.
It passed all 41 shards, recorded 397,047 indexed survivors, and requires 3,924
museum keys. All those keys occur in the **saved** production mapping; repeat
the check against live production before writing. The last production report
is evidence from the prior import, not a fresh server read for this plan.

Raw payload estimates from the dry-run are 4,941,484,032 bytes for float64
embeddings and 9,336,475,392 bytes for selected ORB payloads. The local float32
embeddings occupy 2,470,742,016 bytes. These are payload sizes, **not billed DB,
search-index, or file-storage measurements**, and exclude metadata and indexes.

## Importer snapshot

Relevant implementation, verified during planning:

- `scripts/data/pipeline/push.py:61`, `Corpus`: checks complete features, stored
  file hashes, model/shard shape, metadata counts, merge targets, identities,
  and thumbnail rights. `--full --dry-run` returns before creating a writer.
- `scripts/data/pipeline/push.py:186`, `run`: computes overlap through
  `ingest:countExisting`, saves the baseline/expected counts, and checkpoints
  each stage. The input fingerprint and deployment URL must match on resume.
- `scripts/data/pipeline/convex_writer.py:73`, `ConvexWriter`: uses
  `ConvexHttpClient.set_admin_auth`; descriptors use an action, not a mutation.
- `convex/ingest.ts:317`: vector identity is
  `(modelVersion, source, viewKey)`, preserving alternate views.
- `convex/ingest.ts:413`: ORB bytes are packed into Convex file storage,
  reused by SHA-256 when unchanged, and referenced by the `descriptors` table.
- `convex/ingest.ts:488`: paginated venue export supplies production IDs.
  `exportVectors` and `exportDescriptors` provide bounded feature readback.
- `scripts/data/pipeline/seed_venues.py:118`: `export_asset` constructs the venue
  SQLite from the selected deployment; `publish_asset` publishes it.
- [Vector search measurements](../experiments/README.md#vector-search-scale): only 30k synthetic vectors were
  measured on Starter. Full-scale storage/latency and Pro remain unverified.
- [Calibrator evaluation](../experiments/README.md#calibrator-v2): `lr-v2` was fitted against the 10k
  index. Its object-penalty coefficient is zero; penalties do not affect its
  scores. Training results do not establish full-index or camera accuracy.

Code excerpts recorded at planning time for drift detection:

```python
# scripts/data/pipeline/push.py:32
BATCH_SIZES = dict.fromkeys(STAGES, 500) | {"vectors": 250, "descriptors": 200}

# scripts/data/pipeline/push.py:186 (inside run)
if state["fingerprint"] != corpus.fingerprint or state["deployment"] != deployment_url:
    raise ValueError(
        "Push checkpoint belongs to different inputs or deployment; use a new checkpoint"
    )
```

```typescript
// convex/ingest.ts:340, vector lookup
.withIndex('by_modelVersion_source_viewKey', (q) =>
  q.eq('modelVersion', row.modelVersion).eq('source', row.source).eq('viewKey', row.viewKey)
)
```

### File fingerprints

SHA-256 fingerprints of the dirty working files at planning time:

```text
a8e946d783564d383bba9118ec142a1f08b905d0660ca4be01b3e2ff662b14fb  scripts/data/pipeline/push.py
7e367ed0fde745f3ef8292bc6b4d601b9fea6d116861503c513ea284628edb4c  scripts/data/pipeline/features.py
1c4f4941b63a7c1ba7ee1142d62c0ea069385177c2af5cfef5ff6d8fdba0351c  scripts/data/pipeline/convex_writer.py
dff9f6bf6ad300c94657d1236ed1bb5d4a5fb28dd18ccb556f0ab11eff76519a  convex/ingest.ts
066f586e7065d23a120590d606b07db4b1ee8f91bf641d3c03c094668b365856  convex/schema.ts
16e247eb57c13e09ef109fb59591649775130e1865256110312e2faedd651a0f  shared/model/model-version.json
```
