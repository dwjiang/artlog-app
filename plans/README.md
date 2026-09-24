# Implementation plans

Created with the improve skill on 2026-09-24. Read each plan's drift check before
execution. These are deferred implementation handoffs, not authorization to run them.

| Plan                                                              | Priority | Effort       | Depends on                                     | Status                  |
| ----------------------------------------------------------------- | -------- | ------------ | ---------------------------------------------- | ----------------------- |
| [001 — Upstash vector migration](001-upstash-vector-migration.md) | P2       | L (3–4 days) | Convex cost fixes 1, 2, 3, 5 in this workspace | TODO — deferred by user |

The migration supersedes the Convex search indexes after its accuracy/deletion
gates pass. It preserves the scan-embedding split and import cleanup fixes.

## Considered and deferred

- PCA/dimension reduction (fix 4): outside the selected work; requires a separate recognition evaluation.
- Production corpus upload: remains governed by `docs/todos/production-upload/README.md`; this plan does not authorize it.

This was a focused migration plan. No general security, dependency, UI, or product
roadmap audit was performed.
