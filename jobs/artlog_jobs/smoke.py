"""Prove the job environment end to end: interpreter, compute device, scratch path and a
Convex round trip. Plan 02.10 runs this same module inside a container."""

import json
import sys

from .config import get_settings, setup_logging
from .convex_writer import ConvexWriter
from .model_version import EMBEDDING_DIM, MODEL_VERSION


def main() -> int:
    settings = get_settings()
    setup_logging(settings)
    print(f"python={sys.version.split()[0]}")
    print(f"device={settings.device}")

    import torch

    print(f"torch={torch.__version__}")
    batch = torch.randn(64, EMBEDDING_DIM, dtype=torch.float16, device=settings.device)
    print(f"matmul_shape={tuple((batch @ batch.T).shape)}")
    print(f"scratch_dir={settings.scratch_dir}")
    print(f"user_agent={settings.user_agent}")
    print(f"model_version={MODEL_VERSION}")

    if not settings.convex_url or not settings.convex_deploy_key:
        print("CONVEX_URL and CONVEX_DEPLOY_KEY are not set; skipping the Convex round trip")
        return 2
    counts = ConvexWriter(settings).query("ingest:counts")
    print(f"counts={json.dumps({k: int(n) for k, n in counts.items()}, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
