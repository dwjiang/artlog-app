import json
import os
import time
from pathlib import Path

import numpy as np
from convex.http_client import ConvexHttpClient

DIMENSIONS = 1536


def client():
    url = os.environ["CONVEX_URL"]
    key = os.environ["CONVEX_DEPLOY_KEY"]
    # The runner is intentionally restricted to a named cloud dev deployment.
    deployment = os.environ["CONVEX_DEPLOYMENT"]
    if not deployment.startswith("dev:") or not url.endswith(".convex.cloud"):
        raise ValueError("Expected a cloud dev deployment")
    if url != f"https://{deployment.removeprefix('dev:')}.convex.cloud":
        raise ValueError("Deployment and URL disagree")
    result = ConvexHttpClient(url)
    result.set_admin_auth(key)
    return result


def unit_vector(seed, index, stream=0):
    vector = np.random.default_rng(np.random.SeedSequence([seed, index, stream])).normal(size=DIMENSIONS)
    return vector / np.linalg.norm(vector)


def row(seed, index, version):
    duplicate = index % 100 == 99
    base = index - 1 if duplicate else index
    vector = unit_vector(seed, base)
    if duplicate:
        vector = vector + 0.01 * unit_vector(seed, index, 1)
        vector /= np.linalg.norm(vector)
    return {"objectId": f"object-{base:09d}", "modelVersion": version,
            "source": "alternate" if duplicate else "primary", "vector": vector.tolist()}


def percentiles(values):
    if not values:
        return None
    return dict(zip(["p50", "p95", "p99"], np.percentile(values, [50, 95, 99]).tolist()))


def log(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as output:
        output.write(json.dumps(value, allow_nan=False) + "\n")


def stats(connection):
    return connection.query("bench:stats", {"versions": ["v1", "v2"]})


def size_rejection(error):
    message = str(error).lower()
    return any(text in message for text in [
        "request body too large", "request entity too large", "413",
        "arguments too large", "argument size", "too many bytes written",
        "exceeded maximum size", "exceeds the maximum size",
        "length limit exceeded",
    ])


def seed_rows(connection, target, version, seed, batch_size, output):
    progress = next(s for s in stats(connection) if s["modelVersion"] == version)
    if progress["deleting"] or (progress["seed"] is not None and progress["seed"] != seed):
        raise ValueError("Cannot resume a deleted version or change its seed")
    start = int(progress["nextRow"])
    if target < start:
        raise ValueError("Target is smaller than existing data")
    initial = start
    requested_batch = batch_size
    began = time.perf_counter()
    while start < target:
        rows = [row(seed, i, version) for i in range(start, min(start + batch_size, target))]
        call_start = time.perf_counter()
        try:
            response = connection.mutation("bench:insertBatch", {
                "modelVersion": version, "seed": seed, "start": start, "rows": rows,
            })
        except Exception as error:
            log(output, {"kind": "insert_error", "at": time.time(), "start": start,
                         "version": version, "batch": len(rows), "error": str(error)})
            if not size_rejection(error) or batch_size == 1:
                raise
            batch_size = max(1, batch_size // 2)
            continue
        elapsed = time.perf_counter() - call_start
        log(output, {"kind": "insert", "at": time.time(), "version": version,
                     "start": start, "rows": response["inserted"], "batch": len(rows),
                     "requestedBatch": requested_batch, "rpcSeconds": elapsed})
        start = int(response["nextRow"])
    elapsed = time.perf_counter() - began
    summary = {"kind": "seed_summary", "version": version, "from": initial,
               "target": target, "requestedBatch": requested_batch, "finalBatch": batch_size,
               "wallSeconds": elapsed, "rowsPerSecond": (target - initial) / elapsed}
    log(output, summary)
    print(json.dumps(summary), flush=True)
    return summary


def run_searches(connection, rows, seed, runs, warmup, output):
    configurations = [(versions, limit) for limit in [32, 256]
                      for versions in [["v1"], ["v1", "v2"]]]
    if rows < 100 or runs < 1 or warmup < 0:
        raise ValueError("Need at least 100 v1 rows and positive run count")
    log(output, {"kind": "before", "at": time.time(), "stats": stats(connection),
                 "seed": seed, "runs": runs, "warmup": warmup,
                 "deployment": os.environ.get("CONVEX_DEPLOYMENT")})
    samples = []
    for repeat in range(-warmup, runs):
        clustered = repeat >= 0 and repeat % 2 == 1
        index = ((max(repeat, 0) // 2) % (rows // 100)) * 100 + 98
        vector = row(seed, index, "v1")["vector"] if clustered else unit_vector(seed, max(repeat, 0), 2).tolist()
        # Rotate configuration order to distribute concurrent-ingest effects.
        shift = repeat % len(configurations)
        for versions, limit in configurations[shift:] + configurations[:shift]:
            began = time.perf_counter()
            value = connection.action("bench:search", {"vector": vector, "versions": versions, "limit": limit})
            rpc_ms = (time.perf_counter() - began) * 1000
            if repeat < 0:
                continue
            metadata = value["metadata"]
            sample = {"kind": "search", "at": time.time(), "repeat": repeat,
                      "configuration": f"{'|'.join(versions)}:{limit}",
                      "queryKind": "multiview" if clustered else "random",
                      "searchMs": value["searchMs"], "rpcMs": rpc_ms,
                      "results": len(value["results"]),
                      "uniqueObjects": len({r["objectId"] for r in metadata}),
                      "missingDocuments": len(value["results"]) - len(metadata),
                      "wrongVersions": sum(r["modelVersion"] not in versions for r in metadata),
                      "expectedObjectFound": (any(r["objectId"] == f"object-{index:09d}" for r in metadata)
                                               if clustered else None)}
            samples.append(sample)
            log(output, sample)
    summary = {"kind": "search_summary", "at": time.time(), "stats": stats(connection), "configurations": {}}
    for versions, limit in configurations:
        name = f"{'|'.join(versions)}:{limit}"
        group = [s for s in samples if s["configuration"] == name]
        summary["configurations"][name] = {
            "samples": len(group), "searchMs": percentiles([s["searchMs"] for s in group]),
            "rpcMs": percentiles([s["rpcMs"] for s in group]),
            "uniqueObjects": percentiles([s["uniqueObjects"] for s in group]),
            "missingDocuments": sum(s["missingDocuments"] for s in group),
            "wrongVersions": sum(s["wrongVersions"] for s in group),
            "missedExpectedObjects": sum(s["expectedObjectFound"] is False for s in group),
        }
    log(output, summary)
    print(json.dumps(summary), flush=True)
    return summary


def delete_version(connection, version, output):
    began = time.perf_counter()
    cursor = None
    deleted = scanned = 0
    while True:
        page = connection.mutation("bench:deleteVersion", {
            "modelVersion": version, "paginationOpts": {"cursor": cursor, "numItems": 250},
        })
        deleted += page["deleted"]
        scanned += page["scanned"]
        log(output, {"kind": "delete_page", "at": time.time(), "version": version, **page})
        if page["isDone"]:
            break
        cursor = page["continueCursor"]
    remaining = next(s["count"] for s in stats(connection) if s["modelVersion"] == version)
    if remaining != 0:
        raise RuntimeError(f"Deletion incomplete: {remaining} rows remain")
    summary = {"kind": "delete_summary", "version": version, "deleted": deleted,
               "scanned": scanned, "wallSeconds": time.perf_counter() - began}
    log(output, summary)
    print(json.dumps(summary), flush=True)
    return summary
