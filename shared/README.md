# Shared domains

Code and data consumed across the iOS app (`src/`), Convex backend (`convex/`),
and Python tooling (`scripts/data/`, `scripts/model/`). Each domain owns its fixtures.

| Domain         | Contents                                                        | Consumers                   |
| -------------- | --------------------------------------------------------------- | --------------------------- |
| `attestation/` | Signed payload formats and canonical JSON serialization         | iOS, Convex                 |
| `calibrator/`  | Feature parity fixtures and training-output contract            | Convex, Python jobs         |
| `capture/`     | Crop candidate bounds; the judges' demo files and narration     | iOS, Convex, `www/` demo    |
| `catalog/`     | Catalog text normalization and artist keys                      | iOS, Convex                 |
| `collection/`  | Saved-collection limits                                         | iOS, Convex                 |
| `docent/`      | Prose validation parity fixtures                                | Convex, Python jobs         |
| `label/`       | Wall-label OCR payload bounds                                   | iOS, Convex                 |
| `model/`       | Embedding model metadata, calibration URLs, letterbox reference | iOS, Convex, Python tooling |
| `orb/`         | Matching algorithms, wire format, and parity fixtures           | iOS, Convex, Python jobs    |
| `sources/`     | Source scores, regions, and checklist fixtures                  | Convex, Python jobs         |

Shared TypeScript has no dependency on app or backend internals. Code reused only
within one runtime stays with that runtime.
