import logging
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Protocol

from convex import ConvexClient, ConvexError
from tenacity import (
    Retrying,
    before_sleep_log,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from .config import Settings

log = logging.getLogger(__name__)

MAX_BATCH_ROWS = 500

Row = Mapping[str, Any]
BatchCallback = Callable[[Sequence[Row], dict[str, str]], None]


class Client(Protocol):
    def mutation(self, name: str, args: dict[str, Any] | None = None) -> Any: ...

    def query(self, name: str, args: dict[str, Any] | None = None) -> Any: ...


def is_transient(error: BaseException) -> bool:
    # ConvexError carries an application verdict (unknown key, bad batch); everything
    # else from the client is transport or backend trouble worth another attempt.
    return not isinstance(error, ConvexError)


class ConvexWriter:
    def __init__(
        self,
        settings: Settings,
        client: Client | None = None,
        *,
        attempts: int = 5,
        wait_max: float = 30.0,
    ):
        if client is None:
            if not settings.convex_url or not settings.convex_deploy_key:
                raise ValueError("CONVEX_URL and CONVEX_DEPLOY_KEY must be set")
            convex = ConvexClient(settings.convex_url)
            convex.set_admin_auth(settings.convex_deploy_key)
            client = convex
        self.client = client
        self._retrying = Retrying(
            stop=stop_after_attempt(attempts),
            wait=wait_exponential(multiplier=1, max=wait_max),
            retry=retry_if_exception(is_transient),
            before_sleep=before_sleep_log(log, logging.WARNING),
            reraise=True,
        )

    def query(self, fn: str, args: dict[str, Any] | None = None) -> Any:
        return self._retrying(self.client.query, fn, args or {})

    def mutation(self, fn: str, args: dict[str, Any] | None = None) -> Any:
        return self._retrying(self.client.mutation, fn, args or {})

    def upsert(
        self,
        fn: str,
        rows: Sequence[Row],
        batch_size: int = MAX_BATCH_ROWS,
        on_batch: BatchCallback | None = None,
    ) -> dict[str, str]:
        if not 1 <= batch_size <= MAX_BATCH_ROWS:
            raise ValueError(f"batch_size must be within 1..{MAX_BATCH_ROWS}")
        ids: dict[str, str] = {}
        for start in range(0, len(rows), batch_size):
            batch = rows[start : start + batch_size]
            result = self.mutation(fn, {"rows": list(batch)})
            batch_ids = dict(result.get("ids", {})) if isinstance(result, Mapping) else {}
            ids.update(batch_ids)
            if on_batch is not None:
                on_batch(batch, batch_ids)
            log.info("%s: %d/%d rows", fn, min(start + batch_size, len(rows)), len(rows))
        return ids
