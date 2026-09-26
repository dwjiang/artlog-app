# Pinecone vector search

Create a dense, 512-dimensional **cosine** index. Pinecone Starter uses AWS
`us-east-1`. Give each Convex deployment its own index; never point development
at the production host. The `recognition` namespace contains all models and venues,
using `partition` metadata filters rather than thousands of venue namespaces.

Set `PINECONE_API_KEY` and `PINECONE_INDEX_HOST` on the intended Convex deployment
with `npx convex env set NAME` (paste the value at the prompt). For local tooling,
keep the same variables in the workspace and root checkout's gitignored `.env.local`.
The host is the index's data-plane hostname, not `api.pinecone.io`.

## Deploy and populate

1. Confirm `.env.local` selects the intended deployment, then push the backend.
2. For a fresh corpus, use the normal `pipeline.push` command. It waits for the sync
   queue and checks sampled Pinecone values and partitions before completing.
3. For vectors already archived in R2, run from `scripts/data`:

   ```sh
   uv run python -m pipeline.vector_sync --rebuild
   ```

Rebuild pages Convex vector metadata and queues idempotent upserts from R2 archives. It does not remove
unrelated records from a reused index: create a fresh index when replacing a corpus.
Restarting rebuild is safe but repeats writes, so do not schedule full rebuilds.
A changed index host requires a new import checkpoint and a rebuild of existing vectors.

## Sync and recovery

```sh
npx convex run vectorSync:status
# After fixing a provider/configuration problem:
npx convex run vectorSync:retryFailed
cd scripts/data && uv run python -m pipeline.vector_sync
```

Each vector mutation atomically writes an outbox job. Imports, rebuilds, and new
contributions wake workers once per batch; workers process up to 100 records at a
time. A one-minute cron drains deletions and recovers stranded jobs. Failed/abandoned writes
wait 31 minutes before retry, longer than a Convex action can remain alive; after
eight failed attempts, jobs remain in `failed` state for operator repair. Errors
use the shared Sentry helper without sending vectors, credentials, or provider bodies.

Pinecone is eventually consistent. A successful queue drain means writes were
acknowledged; sampled import readback retries briefly for visibility. Recognition
may briefly miss a newly added vector. Deleted, changed, banned, opted-out, or
otherwise ineligible vectors are rejected against current Convex records even if
Pinecone still returns them. Immutable remote IDs prevent delayed upserts from
overwriting a newer vector or partition.

Pinecone holds searchable embeddings. Private R2 archives hold the exact float64
payloads for offline museum packages, training exports, and rebuilding the index.
Convex keeps vector identities, hashes, archive references, and sync state.
Corpus imports and scan captures upload to R2 before committing their metadata.
Contributions, feedback promotions, and placement approvals reuse the scan's archive
when publishing a searchable vector and a reference-only sync job. Failed or
superseded commits expire unreferenced uploads after a 31-minute reader grace period.
Workers read archives to sync Pinecone; the outbox never contains embedding bytes.
Private scan, rejection, contribution, and saved-artwork recognition payloads also
live in R2, with ownership and lifecycle references in Convex. They enter Pinecone
only when explicitly published for shared recognition.

This schema replaces the old `embeddings` and `tentativeEmbeddings` tables and
changes remote IDs to vector-row IDs plus content hash and partition. Reset and
reseed the pre-release vector data, remove its old Pinecone records, and start a
new import checkpoint; no compatibility path is provided. The full production corpus upload remains
subject to [the production upload checklist](todos/production-upload/README.md).

## Benchmark

The [development benchmark](experiments/pinecone-dev-2026-09-26.md) records retrieval
quality, recognition outcomes, latency, consistency, and Starter usage estimates.

The internal `searchBenchmark:corpusPage` query exports versioned record identities
for matching an exact cosine baseline to local corpus files. The internal
`searchBenchmark:run` action takes a vector, optional venue, optional ORB buffers,
and optional exact top-32 candidate lists. It measures the real Pinecone adapter
and runs both candidate lists through the shared recognition pipeline without
creating scans. Run timed load tests without the optional exact comparison.

Measurements include search and recognition-core time, raw JSON response bytes,
and Pinecone's reported read units and egress bytes. Recognition-core time excludes
on-device work, authentication, scan persistence, and UI rendering. Missing usage
is reported as `null`, never zero. Include unknown artworks and populated venue
partitions when assessing recognition quality and free-tier capacity.

API contracts: Pinecone [query](https://docs.pinecone.io/reference/api/2025-10/data-plane/query),
[upsert](https://docs.pinecone.io/reference/api/2025-10/data-plane/upsert),
[delete](https://docs.pinecone.io/reference/api/2025-10/data-plane/delete), and
[fetch](https://docs.pinecone.io/reference/api/2025-10/data-plane/fetch), pinned to `2025-10`.
