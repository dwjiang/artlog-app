# Shared domains

Code and data consumed across the iOS app (`src/`), Convex backend (`convex/`),
and Python tooling (`scripts/data/`, `scripts/model/`). Each domain owns its fixtures.

| Domain | Contents | Consumers |
| --- | --- | --- |
| `attestation/` | Signed payload formats and canonical JSON serialization | iOS, Convex |
| `calibrator/` | Feature parity fixtures and training-output contract | Convex, Python jobs |
| `collection/` | Saved-collection limits | iOS, Convex |
| `docent/` | Prose validation parity fixtures | Convex, Python jobs |
| `model/` | Embedding model metadata, calibration URLs, letterbox reference | iOS, Convex, Python tooling |
| `orb/` | Matching algorithms, wire format, and parity fixtures | iOS, Convex, Python jobs |
| `sources/` | Source scores, regions, and checklist fixtures | Convex, Python jobs |

Shared TypeScript has no dependency on app or backend internals. Code reused only
within one runtime stays with that runtime.
