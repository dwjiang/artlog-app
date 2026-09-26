"""Rebuild Pinecone from R2 vector archives and wait for durable sync."""

import argparse
import json
import time

from .config import get_settings
from .convex_writer import ConvexWriter


def wait_for_sync(writer: ConvexWriter, timeout: float = 1200) -> None:
    deadline = time.monotonic() + timeout
    while True:
        status = writer.query("vectorSync:status")
        if status["failed"]:
            raise RuntimeError(
                "Pinecone sync has failed jobs; fix the provider error and run vectorSync:retryFailed"
            )
        if status["ready"]:
            return
        if time.monotonic() >= deadline:
            raise TimeoutError("Pinecone sync is still pending; the checkpoint can be resumed")
        processed = writer.action("vectorSync:drain", {})
        if not processed:
            time.sleep(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild", action="store_true", help="enqueue every archived vector")
    args = parser.parse_args()
    writer = ConvexWriter(get_settings())
    print(json.dumps(writer.action("vectorSync:configuration", {})))
    if args.rebuild:
        cursor = None
        queued = 0
        while True:
            page = writer.mutation("vectorSync:rebuild", {"cursor": cursor})
            queued += page["queued"]
            cursor = page["cursor"]
            if cursor is None:
                break
        print(f"Queued {queued} vectors")
    wait_for_sync(writer)
    print("Pinecone sync complete")


if __name__ == "__main__":
    main()
