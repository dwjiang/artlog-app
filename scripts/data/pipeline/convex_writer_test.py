import hashlib
import struct
from contextlib import closing
from threading import Barrier, Event, Lock

import httpx
import pytest
from convex import ConvexError
from convex.http_client import ConvexExecutionError

from pipeline.config import Settings
from pipeline.convex_writer import MAX_BATCH_ROWS, ConvexWriter
from pipeline.model_version import EMBEDDING_DIM, INPUT_SIZE, MODEL_VERSION


class UploadClient:
    def __init__(self):
        self.calls = []
        self.lock = Lock()
        self.files = {}
        self.uploads = {}
        self.stored = {}
        self.requests = 0
        self.lose_put_response = False
        self.lose_commit_response = False
        self.http_status = None
        self.verification_failures = []

    def query(self, name, args):
        self.calls.append((name, args))
        keys = (
            [row["viewKey"] for row in args["rows"]]
            if name.endswith("existingVectors")
            else args["objectKeys"]
        )
        return [self.stored.get(key) for key in keys]

    def action(self, name, args):
        with self.lock:
            return self._action(name, args)

    def _action(self, name, args):
        self.calls.append((name, args))
        if name == "ingestFiles:prepare":
            result = []
            for row in args["rows"]:
                if row.get("existingId"):
                    result.append({"id": row["existingId"], "url": None})
                else:
                    key = f"file-{len(self.files)}"
                    self.files[key] = row
                    result.append({"id": key, "url": f"https://r2.test/{key}?token=secret"})
            return result
        if name == "ingestFiles:complete":
            if self.verification_failures:
                raise self.verification_failures.pop(0)
            for key in args["ids"]:
                assert hashlib.sha256(self.uploads[key]).hexdigest() == self.files[key]["sha256"]
            return None
        assert name in {"ingest:upsertVectors", "ingest:upsertDescriptors"}
        result = {}
        for row in args["rows"]:
            assert "vector" not in row and "descriptors" not in row and "keypoints" not in row
            key = row.get("viewKey", row["objectKey"])
            self.stored[key] = row
            result[key] = f"id-{key}"
        if self.lose_commit_response:
            self.lose_commit_response = False
            raise RuntimeError("response lost after commit")
        return {"ids": result}

    def put(self, request):
        self.requests += 1
        if self.http_status:
            return httpx.Response(self.http_status)
        key = request.url.path.removeprefix("/")
        if key in self.uploads:
            return httpx.Response(412)
        assert request.headers["Content-MD5"] == self.files[key]["md5"]
        assert request.headers["x-amz-meta-sha256"] == self.files[key]["sha256"]
        assert request.headers["If-None-Match"] == "*"
        assert int(request.headers["Content-Length"]) == len(request.content)
        self.uploads[key] = request.content
        if self.lose_put_response:
            self.lose_put_response = False
            raise httpx.ReadError("https://r2.test/?token=secret")
        return httpx.Response(200)


def feature_rows(stage, count=1):
    if stage == "vectors":
        return [
            {
                "objectKey": "met:1",
                "source": "corpus",
                "viewKey": f"met:{i}",
                "modelVersion": MODEL_VERSION,
                "vector": [1.0] + [0.0] * (EMBEDDING_DIM - 1),
            }
            for i in range(count)
        ]
    return [
        {
            "objectKey": f"met:{i}",
            "descriptors": bytes(range(32)),
            "keypoints": struct.pack("<4f", 1, 2, 3, 4),
            "keypointCount": 1,
            "inputSize": INPUT_SIZE,
            "extractedFrom": "museum",
        }
        for i in range(count)
    ]


def upload_writer(client):
    return ConvexWriter(
        Settings(_env_file=None),
        client,
        attempts=3,
        wait_max=0,
        upload_client=httpx.Client(transport=httpx.MockTransport(client.put)),
    )


@pytest.mark.parametrize("stage", ["vectors", "descriptors"])
def test_direct_upload_batches_file_registration_and_never_relays_feature_bytes(stage):
    client = UploadClient()
    job = upload_writer(client)
    rows = feature_rows(stage, 101)
    fn = "ingest:upsertVectors" if stage == "vectors" else "ingest:upsertDescriptors"
    result = job.ingest_features(fn, {"rows": rows})
    assert len(result["ids"]) == len(client.uploads) == 101
    assert sorted(
        len(args["rows"]) for name, args in client.calls if name == "ingestFiles:prepare"
    ) == [1, 100]
    expected = (
        struct.pack(f"<{EMBEDDING_DIM}d", *rows[0]["vector"])
        if stage == "vectors"
        else rows[0]["descriptors"] + rows[0]["keypoints"]
    )
    assert client.uploads["file-0"] == expected
    assert job.ingest_features(fn, {"rows": rows}) == result
    assert client.requests == 101


@pytest.mark.parametrize("lost", ["put", "commit"])
def test_lost_responses_resume_idempotently_without_replacing_uploaded_files(lost):
    client = UploadClient()
    client.lose_put_response = lost == "put"
    client.lose_commit_response = lost == "commit"
    result = upload_writer(client).ingest_features(
        "ingest:upsertVectors", {"rows": feature_rows("vectors")}
    )
    assert len(result["ids"]) == len(client.files) == len(client.uploads) == 1
    assert any(name == "ingestFiles:complete" for name, _ in client.calls)


@pytest.mark.parametrize("status,attempts", [(403, 1), (429, 3), (503, 3)])
def test_failed_uploads_never_commit_or_log_signed_urls(status, attempts, caplog):
    client = UploadClient()
    client.http_status = status
    with pytest.raises(RuntimeError) as error:
        upload_writer(client).ingest_features(
            "ingest:upsertDescriptors", {"rows": feature_rows("descriptors")}
        )
    assert client.requests == attempts
    assert not any(
        name in {"ingestFiles:complete", "ingest:upsertDescriptors"} for name, _ in client.calls
    )
    assert "secret" not in str(error.value) + caplog.text


def verification_connection_error():
    return ConvexExecutionError(
        "Uncaught TypeError: error sending request for url "
        "(https://r2.test/file?token=secret): client error (SendRequest): "
        "connection error: peer closed connection without sending TLS close_notify"
    )


@pytest.mark.parametrize("stage", ["vectors", "descriptors"])
def test_verification_connection_failure_retries_same_files_without_reuploading(stage, caplog):
    client = UploadClient()
    client.verification_failures = [verification_connection_error()]
    result = upload_writer(client).ingest_features(
        "ingest:upsertVectors" if stage == "vectors" else "ingest:upsertDescriptors",
        {"rows": feature_rows(stage)},
    )
    completed = [args for name, args in client.calls if name == "ingestFiles:complete"]
    assert len(result["ids"]) == client.requests == len(client.files) == 1
    assert completed == [{"ids": ["file-0"]}] * 2
    assert "verification connection failed" in caplog.text
    assert "secret" not in caplog.text


def test_verification_connection_retry_exhaustion_stops_before_commit_and_redacts_urls(caplog):
    client = UploadClient()
    client.verification_failures = [verification_connection_error() for _ in range(3)]
    with pytest.raises(RuntimeError, match="verification connection failed") as error:
        upload_writer(client).ingest_features(
            "ingest:upsertVectors", {"rows": feature_rows("vectors")}
        )
    assert sum(name == "ingestFiles:complete" for name, _ in client.calls) == 3
    assert client.requests == 1
    assert not client.stored
    assert "secret" not in str(error.value) + caplog.text


@pytest.mark.parametrize(
    "error",
    [
        ConvexError("mismatch", {"code": "import_upload_mismatch"}),
        ConvexExecutionError("Unexpected verification error"),
    ],
)
def test_permanent_verification_failures_do_not_retry_or_commit(error):
    client = UploadClient()
    client.verification_failures = [error]
    with pytest.raises(type(error)):
        upload_writer(client).ingest_features(
            "ingest:upsertVectors", {"rows": feature_rows("vectors")}
        )
    assert sum(name == "ingestFiles:complete" for name, _ in client.calls) == 1
    assert not client.stored


def test_server_connection_errors_in_other_actions_are_not_retried():
    client = FakeClient(failures=[verification_connection_error()])
    with pytest.raises(ConvexExecutionError):
        writer(client).action("ingest:upsertVectors", {"rows": rows(1)})
    assert len(client.calls) == 1


@pytest.mark.parametrize("fn", ["ingest:readSample", "vectorSync:verifyCorpus"])
def test_readback_retries_interrupted_connections_without_logging_signed_urls(fn, caplog):
    class ReadbackClient:
        def __init__(self):
            self.calls = []

        def action(self, name, args):
            self.calls.append((name, args))
            if len(self.calls) == 1:
                raise verification_connection_error()
            return {"verified": True}

    client = ReadbackClient()
    args = {"rows": []} if fn == "ingest:readSample" else {"keys": []}
    assert writer(client).action(fn, args) == {"verified": True}
    assert client.calls == [(fn, args)] * 2
    assert "verification connection failed" in caplog.text
    assert "secret" not in caplog.text


@pytest.mark.parametrize("stage", ["vectors", "descriptors"])
def test_malformed_features_fail_before_any_remote_request(stage):
    client = UploadClient()
    rows = feature_rows(stage)
    if stage == "vectors":
        rows[0]["vector"][0] = float("nan")
    else:
        rows[0]["keypoints"] = struct.pack("<4f", float("inf"), 0, 0, 0)
    with pytest.raises(ValueError):
        upload_writer(client).ingest_features(
            "ingest:upsertVectors" if stage == "vectors" else "ingest:upsertDescriptors",
            {"rows": rows},
        )
    assert client.calls == []


def test_feature_checkpoints_only_acknowledge_successful_batches():
    client = UploadClient()
    completed = []
    result = upload_writer(client).upsert(
        "ingest:upsertVectors",
        feature_rows("vectors", 3),
        batch_size=2,
        on_batch=lambda _, ids: completed.extend(ids),
    )
    assert set(completed) == set(result)


class FakeClient:
    def __init__(self, failures=()):
        self.calls: list[tuple[str, dict]] = []
        self.failures = list(failures)

    def mutation(self, name, args=None):
        self.calls.append((name, args))
        if self.failures:
            raise self.failures.pop(0)
        return {"ids": {row["key"]: f"id-{row['key']}" for row in args["rows"]}}

    def action(self, name, args=None):
        assert name in {"ingest:upsertVectors", "ingest:upsertDescriptors"}
        return self.mutation(name, args)

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


def test_size_rejections_are_not_retried_as_transient_errors():
    client = FakeClient(failures=[RuntimeError("BadJsonBody: length limit exceeded")])
    with pytest.raises(RuntimeError, match="length limit exceeded"):
        writer(client).upsert("ingest:upsertArtworks", rows(1))
    assert len(client.calls) == 1


@pytest.mark.parametrize("stage", ["vectors", "descriptors"])
def test_upload_preparation_overlaps_but_commits_follow_input_order(stage):
    ready = Barrier(4, timeout=3)
    last_completed = Event()

    class ConcurrentClient(UploadClient):
        def query(self, name, args):
            ready.wait()
            return super().query(name, args)

        def action(self, name, args):
            if name == "ingestFiles:complete":
                spec = self.files[args["ids"][0]]
                if spec["sha256"] == last_hash:
                    last_completed.set()
                else:
                    assert last_completed.wait(3), "Preparation was serial"
            return super().action(name, args)

    rows = feature_rows(stage, 400)
    for index, row in enumerate(rows):
        if stage == "vectors":
            row["vector"][0] = index // 100 + 1.0
        else:
            row["descriptors"] = bytes([index // 100]) * 32
    from pipeline.convex_writer import feature_payload

    fn = "ingest:upsertVectors" if stage == "vectors" else "ingest:upsertDescriptors"
    last_hash = hashlib.sha256(feature_payload(fn, rows[-1])[0]).hexdigest()
    client = ConcurrentClient()
    result = upload_writer(client).ingest_features(fn, {"rows": rows})
    committed = [row for name, args in client.calls if name == fn for row in args["rows"]]
    key = "viewKey" if stage == "vectors" else "objectKey"
    assert [row[key] for row in committed] == [row[key] for row in rows]
    assert len(result["ids"]) == 400


def test_later_upload_failure_never_acknowledges_or_commits_past_failed_batch():
    class FailedClient(UploadClient):
        def action(self, name, args):
            if name == "ingestFiles:complete":
                spec = self.files[args["ids"][0]]
                if spec["sha256"] == failed_hash:
                    raise ConvexError("bad upload", {"code": "import_upload_mismatch"})
            return super().action(name, args)

    from pipeline.convex_writer import feature_payload

    rows = feature_rows("vectors", 300)
    for index, row in enumerate(rows):
        row["vector"][0] = index // 100 + 1.0
    failed_hash = hashlib.sha256(feature_payload("ingest:upsertVectors", rows[100])[0]).hexdigest()
    client = FailedClient()
    checkpoints = []
    job = upload_writer(client)
    with pytest.raises(ConvexError):
        job.upsert("ingest:upsertVectors", rows, on_batch=lambda *args: checkpoints.append(args))
    assert list(client.stored) == [row["viewKey"] for row in rows[:100]]
    assert checkpoints == []
    client.action = lambda name, args: UploadClient.action(client, name, args)
    result = job.upsert("ingest:upsertVectors", rows)
    assert len(result) == len(client.stored) == 300


def test_owned_upload_connections_are_reused_across_batches_and_closed(monkeypatch):
    client = UploadClient()
    factory = httpx.Client
    connections = []

    def create_client(**kwargs):
        http = factory(transport=httpx.MockTransport(client.put), **kwargs)
        connections.append(http)
        return http

    monkeypatch.setattr(httpx, "Client", create_client)
    with ConvexWriter(Settings(_env_file=None), client) as job:
        job.ingest_features("ingest:upsertVectors", {"rows": feature_rows("vectors", 1)})
        job.ingest_features("ingest:upsertVectors", {"rows": feature_rows("vectors", 2)})
        assert len(connections) == 1
        assert not connections[0].is_closed
    assert connections[0].is_closed
    assert client.requests == 2


def test_stream_refills_preparation_while_prior_rows_commit_and_bounds_prefetch():
    next_prepared = Event()
    consumed = []

    class StreamingClient(UploadClient):
        def query(self, name, args):
            if args["rows"][0]["viewKey"] == "met:400":
                next_prepared.set()
            return super().query(name, args)

        def action(self, name, args):
            if name == "ingest:upsertVectors" and args["rows"][0]["viewKey"] == "met:0":
                assert next_prepared.wait(3), "Next batch did not prepare during commit"
            return super().action(name, args)

    rows = feature_rows("vectors", 1000)

    def batches():
        for start in range(0, len(rows), 100):
            consumed.append(start)
            yield rows[start : start + 100]

    client = StreamingClient()
    with closing(
        upload_writer(client).ingest_feature_batches("ingest:upsertVectors", batches())
    ) as stream:
        count, result = next(stream)
        assert count == len(result["ids"]) == 100
        assert consumed == [0, 100, 200, 300, 400]
    assert list(client.stored) == [row["viewKey"] for row in rows[:100]]
    assert len(consumed) == 5


def test_stream_failure_acknowledges_only_contiguous_commits_and_can_resume():
    class FailedClient(UploadClient):
        def action(self, name, args):
            if name == "ingest:upsertVectors" and args["rows"][0]["viewKey"] == "met:100":
                raise ConvexError("invalid file", {"code": "file_missing"})
            return super().action(name, args)

    rows = feature_rows("vectors", 600)
    client = FailedClient()
    job = upload_writer(client)
    acknowledged = 0
    with pytest.raises(ConvexError):
        for count, _ in job.ingest_feature_batches(
            "ingest:upsertVectors", (rows[start : start + 100] for start in range(0, 600, 100))
        ):
            acknowledged += count
    assert acknowledged == len(client.stored) == 100
    client.action = lambda name, args: UploadClient.action(client, name, args)
    for count, _ in job.ingest_feature_batches(
        "ingest:upsertVectors",
        (rows[start : start + 100] for start in range(acknowledged, 600, 100)),
    ):
        acknowledged += count
    assert acknowledged == len(client.stored) == 600
