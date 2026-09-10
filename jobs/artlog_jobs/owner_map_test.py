import pytest

from .owner_map import AIC_KEY, MET_KEY, OwnerMap


class Writer:
    def __init__(self):
        self.calls = []

    def query(self, fn, args):
        self.calls.append((fn, args))
        return {
            "page": [{"key": AIC_KEY if args else MET_KEY}],
            "isDone": bool(args),
            "continueCursor": "next",
        }


def test_only_seeded_museums_map_and_unknown_owners_are_counted():
    owners = OwnerMap({MET_KEY, AIC_KEY})
    assert owners.venue("Q160236", owner=True) == MET_KEY
    assert owners.venue("Q999", owner=True) is None
    assert owners.venue("Q999") is None
    assert owners.unmapped == {"Q999": 1}


def test_venue_export_is_paginated_cached_and_deployment_scoped(tmp_path):
    writer = Writer()
    first = OwnerMap.load(writer, tmp_path, deployment_url="https://dev.convex.cloud")
    second = OwnerMap.load(writer, tmp_path, deployment_url="https://dev.convex.cloud")
    assert first.keys == second.keys == {MET_KEY, AIC_KEY}
    assert len(writer.calls) == 2
    OwnerMap.load(writer, tmp_path, deployment_url="https://another.convex.cloud")
    assert len(writer.calls) == 4


def test_incomplete_venue_export_never_writes_a_cache(tmp_path):
    class Incomplete:
        def query(self, *args):
            return {"page": [{"key": MET_KEY}], "isDone": False, "continueCursor": "stuck"}

    with pytest.raises(RuntimeError, match="pagination"):
        OwnerMap.load(Incomplete(), tmp_path, deployment_url="dev")
    assert list(tmp_path.rglob("*.json")) == []
