import argparse
import os
from datetime import UTC, datetime

import requests

from common import RESULTS, charged_total, write_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("label", choices=["before", "after", "recheck"])
    args = parser.parse_args()
    path = RESULTS / f"usage-{args.label}.json"
    if path.exists():
        raise SystemExit("Snapshot already exists; preserve the original accounting evidence")
    response = requests.get(
        "https://api.tavily.com/usage",
        headers={"Authorization": "Bearer " + os.environ["TAVILY_API_KEY"]},
        timeout=20,
    )
    response.raise_for_status()
    data = response.json()
    data["observed_at"] = datetime.now(UTC).isoformat()
    write_json(path, data)
    print(
        f"Key usage: {data['key']['usage']}; spike budget charged: {charged_total(RESULTS):g}/300"
    )


if __name__ == "__main__":
    main()
