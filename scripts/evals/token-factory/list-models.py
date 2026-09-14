import argparse
from datetime import datetime, timezone
from pathlib import Path

from evaluation import client, write_json

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Save the Token Factory model catalog")
    parser.add_argument("--results-dir", type=Path, required=True)
    args = parser.parse_args()
    api = client()
    response = api.models.list()
    models = [model.model_dump(mode="json") for model in response]
    write_json(
        args.results_dir / "models.json",
        {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "base_url": str(api.base_url),
            "data": models,
        },
    )
    print("MODEL ID")
    for model in models:
        print(model["id"])
