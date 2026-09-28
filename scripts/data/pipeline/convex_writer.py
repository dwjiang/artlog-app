import base64
import hashlib
import logging
import math
import struct
from collections import deque
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Protocol

import httpx
from convex import ConvexError
from convex.http_client import ConvexExecutionError, ConvexHttpClient
from tenacity import (
    Retrying,
    before_sleep_log,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from .config import Settings
from .model_version import EMBEDDING_DIM, INPUT_SIZE
from .orb import DESCRIPTOR_BYTES, KEYPOINT_BYTES, MAX_KEYPOINTS

log = logging.getLogger(__name__)

MAX_BATCH_ROWS = 500
# Bound local memory and the number of uncommitted direct uploads.
MAX_DESCRIPTOR_BATCH_ROWS = 400
UPLOAD_BATCH_ROWS = 100
FEATURE_BATCH_WORKERS = 4
UPLOAD_WORKERS = 32
VECTOR_CONTENT_TYPE = "application/vnd.artlog.embedding"
ORB_CONTENT_TYPE = "application/octet-stream"

Row = Mapping[str, Any]
BatchCallback = Callable[[Sequence[Row], dict[str, str]], None]


class Client(Protocol):
    def action(self, name: str, args: dict[str, Any] | None = None) -> Any: ...

    def mutation(self, name: str, args: dict[str, Any] | None = None) -> Any: ...

    def query(self, name: str, args: dict[str, Any] | None = None) -> Any: ...


class UploadError(RuntimeError):
    def __init__(self, status: int | None = None):
        self.status = status
        super().__init__(
            f"R2 upload failed ({status})" if status else "R2 upload connection failed"
        )


def feature_payload(fn: str, row: Row) -> tuple[bytes, dict, str]:
    metadata = dict(row)
    if fn == "ingest:upsertVectors":
        vector = metadata.pop("vector")
        if (
            len(vector) != EMBEDDING_DIM
            or not all(math.isfinite(v) for v in vector)
            or not any(vector)
        ):
            raise ValueError("Invalid embedding dimensions or values")
        return struct.pack(f"<{EMBEDDING_DIM}d", *vector), metadata, VECTOR_CONTENT_TYPE
    if fn != "ingest:upsertDescriptors":
        raise ValueError("Unknown feature import")
    descriptors, keypoints = metadata.pop("descriptors"), metadata.pop("keypoints")
    count = metadata["keypointCount"]
    if (
        type(count) is not int
        or not 0 <= count <= MAX_KEYPOINTS
        or metadata["inputSize"] != INPUT_SIZE
        or len(descriptors) != count * DESCRIPTOR_BYTES
        or len(keypoints) != count * KEYPOINT_BYTES
        or not all(math.isfinite(value[0]) for value in struct.iter_unpack("<f", keypoints))
    ):
        raise ValueError("Invalid ORB features")
    return descriptors + keypoints, metadata, ORB_CONTENT_TYPE


def pack_features(fn: str, rows: Sequence[Row]) -> list[tuple[bytes, dict, str]]:
    packed = [feature_payload(fn, row) for row in rows]
    identities = [
        row["viewKey"] if fn == "ingest:upsertVectors" else row["objectKey"] for row in rows
    ]
    if len(set(identities)) != len(identities):
        raise ValueError("Duplicate feature identities")
    return packed


def is_transient(error: BaseException) -> bool:
    # Application errors are permanent; ordinary client exceptions may be transient.
    return (
        isinstance(error, Exception)
        and not isinstance(error, ConvexError | ConvexExecutionError)
        and not is_size_rejection(error)
    )


def is_size_rejection(error: BaseException) -> bool:
    return any(
        message in str(error).lower()
        for message in (
            "request body too large",
            "request entity too large",
            "413",
            "arguments too large",
            "argument size",
            "too many bytes written",
            "length limit exceeded",
            "exceeded maximum size",
            "exceeds the maximum size",
        )
    )


class ConvexWriter:
    def __init__(
        self,
        settings: Settings,
        client: Client | None = None,
        *,
        attempts: int = 5,
        wait_max: float = 30.0,
        upload_client: httpx.Client | None = None,
        feature_workers: int = FEATURE_BATCH_WORKERS,
        upload_workers: int = UPLOAD_WORKERS,
    ):
        if not 1 <= feature_workers <= 4 or not 1 <= upload_workers <= 32:
            raise ValueError("Feature workers must be within 1..4 and upload workers within 1..32")
        if client is None:
            if not settings.convex_url or not settings.convex_deploy_key:
                raise ValueError("CONVEX_URL and CONVEX_DEPLOY_KEY must be set")
            convex = ConvexHttpClient(settings.convex_url)
            convex.set_admin_auth(settings.convex_deploy_key)
            client = convex
        self.client = client
        self.upload_client = upload_client
        self._owns_upload_client = upload_client is None
        self.feature_workers = feature_workers
        self.upload_workers = upload_workers
        self._retrying = Retrying(
            stop=stop_after_attempt(attempts),
            wait=wait_exponential(multiplier=1, max=wait_max),
            retry=retry_if_exception(is_transient),
            before_sleep=before_sleep_log(log, logging.WARNING),
            reraise=True,
        )
        self._upload_retrying = Retrying(
            stop=stop_after_attempt(attempts),
            wait=wait_exponential(multiplier=1, max=wait_max),
            retry=retry_if_exception(
                lambda error: (
                    isinstance(error, UploadError)
                    and (error.status is None or error.status in (408, 429) or error.status >= 500)
                )
            ),
            reraise=True,
        )

    def query(self, fn: str, args: dict[str, Any] | None = None) -> Any:
        return self._retrying(self.client.query, fn, args or {})

    def mutation(self, fn: str, args: dict[str, Any] | None = None) -> Any:
        return self._retrying(self.client.mutation, fn, args or {})

    def action(self, fn: str, args: dict[str, Any] | None = None) -> Any:
        def send():
            try:
                return self.client.action(fn, args or {})
            except ConvexExecutionError as error:
                message = str(error)
                if (
                    fn in {"ingestFiles:complete", "ingest:readSample", "vectorSync:verifyCorpus"}
                    and "error sending request for url" in message
                    and "peer closed connection without sending TLS close_notify" in message
                ):
                    # Verification is idempotent; omit the signed URL from retry logs.
                    raise RuntimeError("R2 verification connection failed") from None
                raise

        return self._retrying(send)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        if self._owns_upload_client and self.upload_client is not None:
            self.upload_client.close()
            self.upload_client = None

    def _upload(self, http: httpx.Client, body: bytes, spec: dict, target: dict):
        if not target["url"]:
            return

        def send():
            try:
                response = http.put(
                    target["url"],
                    content=body,
                    headers={
                        "Content-Type": spec["contentType"],
                        "Content-Length": str(spec["size"]),
                        "Content-MD5": spec["md5"],
                        "x-amz-meta-sha256": spec["sha256"],
                        "If-None-Match": "*",
                    },
                )
            except httpx.TransportError:
                raise UploadError() from None
            # A lost response can replay an immutable PUT; HEAD still verifies it before commit.
            if response.status_code == 412:
                return
            if not response.is_success:
                raise UploadError(response.status_code)

        self._upload_retrying(send)

    def _prepare_features(
        self, fn: str, batch: list, http: httpx.Client, uploads: ThreadPoolExecutor
    ):
        metadata = [entry[1] for entry in batch]
        vectors = fn == "ingest:upsertVectors"
        existing = self.query(
            "ingest:existingVectors" if vectors else "ingest:existingDescriptors",
            {
                "rows": [
                    {"modelVersion": row["modelVersion"], "viewKey": row["viewKey"]}
                    for row in metadata
                ]
            }
            if vectors
            else {"objectKeys": [row["objectKey"] for row in metadata]},
        )
        if len(existing) != len(batch):
            raise RuntimeError("Feature lookup did not return every requested row")
        specs = []
        for (body, _, content_type), old in zip(batch, existing, strict=True):
            spec = {
                "contentType": content_type,
                "size": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
                "md5": base64.b64encode(hashlib.md5(body, usedforsecurity=False).digest()).decode(),
            }
            if old and old.get("contentHash" if vectors else "sha256") == spec["sha256"]:
                spec["existingId"] = old["archiveId" if vectors else "storageId"]
            specs.append(spec)
        prepared = self.action("ingestFiles:prepare", {"rows": specs})
        if len(prepared) != len(batch):
            raise RuntimeError("Upload preparation did not return every requested file")
        futures = [
            uploads.submit(self._upload, http, body, spec, target)
            for (body, _, _), spec, target in zip(batch, specs, prepared, strict=True)
        ]
        for future in futures:
            future.result()
        pending = [target["id"] for target in prepared if target["url"]]
        if pending:
            self.action("ingestFiles:complete", {"ids": pending})
        return [
            {
                **row,
                **(
                    {"archiveId": target["id"], "contentHash": spec["sha256"]}
                    if vectors
                    else {"storageId": target["id"], "sha256": spec["sha256"]}
                ),
            }
            for row, target, spec in zip(metadata, prepared, specs, strict=True)
        ]

    def ingest_features(self, fn: str, args: dict[str, Any]) -> dict:
        packed = pack_features(fn, args["rows"])
        batches = (
            packed[start : start + UPLOAD_BATCH_ROWS]
            for start in range(0, len(packed), UPLOAD_BATCH_ROWS)
        )
        ids = {}
        for _, result in self._ingest_packed_batches(fn, batches):
            ids.update(result["ids"])
        return {"ids": ids}

    def ingest_feature_batches(
        self, fn: str, batches: Iterable[Sequence[Row]]
    ) -> Iterator[tuple[int, dict]]:
        yield from self._ingest_packed_batches(fn, (pack_features(fn, rows) for rows in batches))

    def _ingest_packed_batches(
        self, fn: str, batches: Iterable[list]
    ) -> Iterator[tuple[int, dict]]:
        # HTTP request logging would disclose the temporary signed upload URLs.
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        if self.upload_client is None:
            self.upload_client = httpx.Client(
                timeout=60,
                limits=httpx.Limits(
                    max_connections=self.upload_workers,
                    max_keepalive_connections=self.upload_workers,
                ),
            )
        batches = iter(batches)
        pending = deque()
        with (
            ThreadPoolExecutor(max_workers=self.upload_workers) as uploads,
            ThreadPoolExecutor(max_workers=self.feature_workers) as preparation,
        ):

            def submit_next():
                batch = next(batches, None)
                if batch is None:
                    return
                if not 1 <= len(batch) <= UPLOAD_BATCH_ROWS:
                    raise ValueError(f"Feature batches must contain 1..{UPLOAD_BATCH_ROWS} rows")
                pending.append(
                    preparation.submit(
                        self._prepare_features, fn, batch, self.upload_client, uploads
                    )
                )

            try:
                for _ in range(self.feature_workers):
                    submit_next()
                while pending:
                    references = pending.popleft().result()
                    # Refill before committing so uploads continue during ordered database writes.
                    # At most four prepared batches plus the committing batch are held in memory.
                    submit_next()
                    result = self.action(fn, {"rows": references})
                    if len(result["ids"]) != len(references):
                        raise RuntimeError("Feature import did not acknowledge every row")
                    yield len(references), result
            finally:
                for future in pending:
                    future.cancel()

    def upsert(
        self,
        fn: str,
        rows: Sequence[Row],
        batch_size: int = MAX_BATCH_ROWS,
        on_batch: BatchCallback | None = None,
    ) -> dict[str, str]:
        if not 1 <= batch_size <= MAX_BATCH_ROWS:
            raise ValueError(f"batch_size must be within 1..{MAX_BATCH_ROWS}")
        if fn == "ingest:upsertDescriptors":
            batch_size = min(batch_size, MAX_DESCRIPTOR_BATCH_ROWS)
        ids: dict[str, str] = {}
        for start in range(0, len(rows), batch_size):
            batch = rows[start : start + batch_size]
            call = (
                self.ingest_features
                if fn in {"ingest:upsertDescriptors", "ingest:upsertVectors"}
                else self.mutation
            )
            result = call(fn, {"rows": list(batch)})
            batch_ids = dict(result.get("ids", {})) if isinstance(result, Mapping) else {}
            ids.update(batch_ids)
            if on_batch is not None:
                on_batch(batch, batch_ids)
            log.info("%s: %d/%d rows", fn, min(start + batch_size, len(rows)), len(rows))
        return ids
