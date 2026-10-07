# Corpus artifacts

Local data lives outside the repository under
`/Users/dwjiang/Documents/Artlog Data/`. The `jobs/scratch/` directory holds source
metadata, images, feature shards, merged corpora, and derived index packages;
`jobs/out/` holds audits, training outputs, and import reports.

Do not commit corpus data or workspace symlinks. Pass absolute `--in` and
`--checkpoint` paths to jobs in other checkouts. Read `stats.json`, manifests,
hashes, and import reports for the selected package rather than treating a
recorded inventory as live deployment counts.

## Package contracts

The model-version manifest binds embeddings to the on-device export. PCA512
packages contain projected vectors compatible with the bundled model; metadata,
ORB features, and unchanged source files can be shared through hard links.
Changing a model or preprocessing contract requires matching corpus features,
calibrator inputs, and museum packages.

Retain metadata-only objects when source images or feature extraction fail.
Never invent missing features. Alternate embedding views remain separate vector
rows; each indexed object has a selected ORB reference. Raw shards can retain
additional ORB views for local evaluation.

A merged corpus records aliases and canonical survivors. Add-only packages must
be deduplicated against the imported package and every preceding addition; see
[the pipeline guide](../../scripts/data/README.md#add-sources-to-an-imported-corpus).
Source snapshots, rights metadata, object identities, and feature hashes must
remain attributable.

## Import and evaluation

[Corpus imports](corpus-imports.md) defines target selection, checkpoints,
readback, and recovery. Query `ingest:counts` on the selected deployment for live
counts, and export venue IDs from that deployment before building the venue asset.

[Recognition findings](../experiments/README.md) distinguishes augmented reference
queries from independent camera photos. Training rows, fitted weights, manifests,
and reviewed real-photo sets belong in durable local storage; active calibrator
weights live in [weights.ts](../../convex/lib/calibrator/weights.ts).
