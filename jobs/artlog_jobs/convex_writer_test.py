import pytest
from convex import ConvexError

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
