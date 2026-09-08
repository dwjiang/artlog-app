from datetime import datetime, timezone

from evaluation import ROOT, client, write_json

if __name__ == "__main__":
    api = client()
    response = api.models.list()
    models = [model.model_dump(mode="json") for model in response]
    write_json(
        ROOT / "results" / "models.json",
        {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "base_url": str(api.base_url),
            "data": models,
        },
    )
    print("MODEL ID")
    for model in models:
        print(model["id"])
