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
# Retry after repairing the provider/configuration problem:
npx convex run vectorSync:retryFailed
cd scripts/data && uv run python -m pipeline.vector_sync
```

Each vector mutation appends an outbox job; producers never read the outbox, so
import batches cannot conflict with worker claims. A transaction that queues jobs
schedules one drain; a drain examines up to 100 jobs and chains the next page even
when every job on its page is waiting on a lease. A job syncs its remote record to
the current `vectors` row, so a vector deleted before its job runs turns into a delete.
Workers hold one lease per record and drop duplicate jobs for a record they claim;
a job behind a lease for the same record drains when that lease is acknowledged.
Failed writes schedule their retry for when the lease ends, 31 minutes later, longer
than a Convex action can remain alive. An hourly cron recovers jobs whose drain
died before acknowledging. After eight failed attempts, jobs remain in `failed`
state for operator repair. Errors use the shared Sentry helper without
sending vectors, credentials, or provider bodies.

Pinecone is eventually consistent. A successful queue drain means writes were
acknowledged; sampled import readback retries briefly for visibility. Recognition
may briefly miss a newly added vector. Deleted, changed, banned, opted-out, or
otherwise ineligible vectors are rejected against current Convex records even if
Pinecone still returns them. Immutable remote IDs prevent delayed upserts from
overwriting a newer vector or partition.

Pinecone holds searchable embeddings. Private R2 archives hold the exact float64
payloads for offline museum packages, training exports, and rebuilding the index.
Convex keeps vector identities, hashes, archive references, and sync state.
Corpus imports upload directly from the Python job to R2, reserving and completing
100 files per batch. Signed MD5 and SHA-256 metadata headers bind each upload;
Convex checks HEAD metadata before committing references. Scan captures also
upload to R2 before committing their metadata.
Contributions, feedback promotions, and placement approvals reuse the scan's archive
when publishing a searchable vector and a reference-only sync job. Failed or
superseded commits expire unreferenced uploads after a 31-minute reader grace period.
Workers read archives to sync Pinecone; the outbox never contains embedding bytes.
Private scan, rejection, contribution, and saved-artwork recognition payloads also
live in R2, with ownership and lifecycle references in Convex. They enter Pinecone
only when explicitly published for shared recognition.

Remote IDs encode vector-row identity, content hash, and partition. Corpus
replacement requires a fresh index and a matching import checkpoint; unrelated
remote records are not removed by rebuild. [Corpus imports](operations/corpus-imports.md)
owns target selection, verification, and recovery.

## Benchmark

The [development benchmark](experiments/pinecone.md) records retrieval
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
