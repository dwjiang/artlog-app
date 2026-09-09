from pathlib import Path

from artlog_jobs.config import JOBS_DIR, REPO_URL, Settings


def settings(**overrides) -> Settings:
    return Settings(_env_file=None, **overrides)


def test_defaults_resolve_scratch_dir_and_user_agent(monkeypatch):
    for name in ("SCRATCH_DIR", "DEVICE", "CRAWLER_CONTACT", "USER_AGENT", "CONVEX_URL"):
        monkeypatch.delenv(name, raising=False)
    s = settings()
    assert s.scratch_dir == (JOBS_DIR / "scratch").resolve()
    assert s.scratch_dir.is_absolute()
    assert s.user_agent == f"artlog-bot/0.1 (+{REPO_URL})"
    assert s.convex_url == ""


def test_environment_overrides(monkeypatch, tmp_path):
    monkeypatch.setenv("SCRATCH_DIR", str(tmp_path / "scratch"))
    monkeypatch.setenv("DEVICE", "cpu")
    monkeypatch.setenv("CRAWLER_CONTACT", "ops@example.org")
    monkeypatch.setenv("CONVEX_URL", "https://example.convex.cloud")
    s = settings()
    assert s.scratch_dir == (tmp_path / "scratch").resolve()
    assert s.device == "cpu"
    assert s.user_agent.endswith("; mailto:ops@example.org)")
    assert s.convex_url == "https://example.convex.cloud"


def test_device_detection_picks_an_available_backend(monkeypatch):
    monkeypatch.delenv("DEVICE", raising=False)
    s = settings(scratch_dir=Path("/tmp/artlog-scratch"))
    assert s.device in {"mps", "cuda", "cpu"}
