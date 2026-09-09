import json

import pytest
from convex import ConvexError
from convex.values import convex_to_json

from artlog_jobs.config import Settings
from artlog_jobs.convex_writer import MAX_BATCH_ROWS, ConvexWriter


class FakeClient:
    def __init__(self, failures=()):
        self.calls: list[tuple[str, dict]] = []
        self.failures = list(failures)

    def mutation(self, name, args=None):
        self.calls.append((name, args))
        if self.failures:
            raise self.failures.pop(0)
        return {"ids": {row["key"]: f"id-{row['key']}" for row in args["rows"]}}

    def query(self, name, args=None):
        self.calls.append((name, args))
        if self.failures:
            raise self.failures.pop(0)
        return {"museums": 3}


def writer(client) -> ConvexWriter:
    return ConvexWriter(Settings(_env_file=None), client, attempts=3, wait_max=0)


def rows(n: int) -> list[dict]:
    return [{"key": f"k{i}"} for i in range(n)]


def test_upsert_splits_rows_into_batches_and_merges_ids():
    client = FakeClient()
    ids = writer(client).upsert("ingest:upsertMuseums", rows(7), batch_size=3)

    assert [len(args["rows"]) for _, args in client.calls] == [3, 3, 1]
    assert all(name == "ingest:upsertMuseums" for name, _ in client.calls)
    assert ids == {f"k{i}": f"id-k{i}" for i in range(7)}


def test_on_batch_receives_each_batch_and_its_ids():
    seen = []
    writer(FakeClient()).upsert(
        "ingest:upsertArtworks",
        rows(4),
        batch_size=2,
        on_batch=lambda batch, ids: seen.append(([r["key"] for r in batch], ids)),
    )
    assert seen == [
        (["k0", "k1"], {"k0": "id-k0", "k1": "id-k1"}),
        (["k2", "k3"], {"k2": "id-k2", "k3": "id-k3"}),
    ]


def test_transient_errors_are_retried():
    client = FakeClient(failures=[RuntimeError("websocket closed")])
    ids = writer(client).upsert("ingest:upsertMuseums", rows(1))
    assert len(client.calls) == 2
    assert ids == {"k0": "id-k0"}


def test_convex_errors_are_not_retried():
    client = FakeClient(failures=[ConvexError("unknown key", {"code": "unknown_key"})])
    with pytest.raises(ConvexError) as raised:
        writer(client).upsert("ingest:upsertObjects", rows(1))
    assert raised.value.data == {"code": "unknown_key"}
    assert len(client.calls) == 1


@pytest.mark.parametrize("error_type", [KeyboardInterrupt, SystemExit])
@pytest.mark.parametrize("operation", ["query", "upsert"])
def test_cancellation_stops_without_retrying_or_checkpointing(error_type, operation):
    client = FakeClient(failures=[error_type()])
    checkpoints = []
    with pytest.raises(error_type):
        if operation == "query":
            writer(client).query("ingest:counts")
        else:
            writer(client).upsert(
                "ingest:upsertMuseums",
                rows(2),
                batch_size=1,
                on_batch=lambda batch, ids: checkpoints.append(ids),
            )
    assert len(client.calls) == 1
    assert checkpoints == []


def test_gives_up_after_the_configured_attempts():
    client = FakeClient(failures=[RuntimeError("down")] * 3)
    with pytest.raises(RuntimeError):
        writer(client).query("ingest:counts")
    assert len(client.calls) == 3


def test_rejects_batches_over_the_mutation_limit():
    with pytest.raises(ValueError):
        writer(FakeClient()).upsert("ingest:upsertMuseums", rows(1), batch_size=MAX_BATCH_ROWS + 1)


def test_requires_credentials_without_an_injected_client():
    with pytest.raises(ValueError):
        ConvexWriter(Settings(_env_file=None, convex_url="", convex_deploy_key=""))


@pytest.mark.parametrize("batch_size", [50, 500])
def test_maximum_descriptor_sets_fit_the_payload_limit_and_checkpoint_every_row(batch_size):
    class DescriptorClient(FakeClient):
        def mutation(self, name, args=None):
            self.calls.append((name, args))
            encoded = json.dumps(convex_to_json(args)).encode()
            assert len(encoded) < 16 * 1024 * 1024
            assert (
                sum(len(row["descriptors"]) + len(row["keypoints"]) for row in args["rows"])
                < 16 * 1024 * 1024
            )
            return {"ids": {row["objectKey"]: f"id-{row['objectKey']}" for row in args["rows"]}}

    client = DescriptorClient()
    descriptor_rows = [
        {
            "objectKey": f"met:{i}",
            "descriptors": bytes(1000 * 32),
            "keypoints": bytes(1000 * 16),
            "keypointCount": 1000,
            "inputSize": 512,
            "extractedFrom": "https://museum.example/image.jpg",
        }
        for i in range(501)
    ]
    checkpoints = []
    ids = writer(client).upsert(
        "ingest:upsertDescriptors",
        descriptor_rows,
        batch_size=batch_size,
        on_batch=lambda batch, ids: checkpoints.append(([row["objectKey"] for row in batch], ids)),
    )
    assert [key for keys, _ in checkpoints for key in keys] == [f"met:{i}" for i in range(501)]
    assert ids == {f"met:{i}": f"id-met:{i}" for i in range(501)}
    assert len(checkpoints) == len(client.calls)
    assert all(len(args["rows"]) <= batch_size for _, args in client.calls)
    assert all(set(keys) == set(batch_ids) for keys, batch_ids in checkpoints)
