import json
from pathlib import Path
from uuid import uuid4


def probe(directory):
    path = directory / f"artlog-0008-{uuid4()}.txt"
    payload = b"artlog plan 00.08 scratch mount probe\n"
    # Close the writer before opening the reader so the S3 mount can finish upload.
    path.write_bytes(payload)
    if path.read_bytes() != payload:
        raise RuntimeError("Scratch object did not round-trip")
    return {"object_key": path.name, "bytes": len(payload), "round_trip": True}


if __name__ == "__main__":
    print(json.dumps(probe(Path("/mnt/scratch"))))
