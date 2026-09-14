import json
import os
from collections.abc import Iterable
from pathlib import Path

from .config import Settings


class Checkpoint:
    """Per-stage `done` key sets and cursors, saved to disk after every change so a job
    resumes where it stopped."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._done: dict[str, set[str]] = {}
        self._cursors: dict[str, str] = {}
        if self.path.exists():
            data = json.loads(self.path.read_text())
            for stage, entry in data.get("stages", {}).items():
                self._done[stage] = set(entry.get("done", []))
                if entry.get("cursor") is not None:
                    self._cursors[stage] = entry["cursor"]

    @classmethod
    def for_job(cls, settings: Settings, job: str) -> "Checkpoint":
        return cls(settings.scratch_dir / "checkpoints" / f"{job}.json")

    def done_keys(self, stage: str) -> frozenset[str]:
        return frozenset(self._done.get(stage, ()))

    def is_done(self, stage: str, key: str) -> bool:
        return key in self._done.get(stage, ())

    def mark_done(self, stage: str, keys: Iterable[str]) -> None:
        self._done.setdefault(stage, set()).update(keys)
        self.save()

    def unmark(self, stage: str, keys: Iterable[str]) -> None:
        self._done.get(stage, set()).difference_update(keys)
        self.save()

    def cursor(self, stage: str) -> str | None:
        return self._cursors.get(stage)

    def set_cursor(self, stage: str, cursor: str | None) -> None:
        if cursor is None:
            self._cursors.pop(stage, None)
        else:
            self._cursors[stage] = cursor
        self.save()

    def clear(self, stage: str) -> None:
        self._done.pop(stage, None)
        self._cursors.pop(stage, None)
        self.save()

    def save(self) -> None:
        stages = {
            stage: {
                "done": sorted(self._done.get(stage, ())),
                "cursor": self._cursors.get(stage),
            }
            for stage in sorted(set(self._done) | set(self._cursors))
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps({"stages": stages}, indent=2) + "\n")
        os.replace(tmp, self.path)
