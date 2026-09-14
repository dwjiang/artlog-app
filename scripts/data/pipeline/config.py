import logging
from functools import cached_property, lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .model_version import REPO_ROOT

DATA_DIR = REPO_ROOT / "scripts" / "data"
REPO_URL = "https://github.com/dwjiang/artlog-app"


def detect_device() -> str:
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env.local",
        env_file_encoding="utf-8",
        extra="ignore",
        validate_by_name=True,
        validate_by_alias=True,
    )

    convex_url: str = ""
    convex_deploy_key: str = ""
    scratch_dir: Path = DATA_DIR / "scratch"
    device_name: str | None = Field(default=None, validation_alias="DEVICE")
    crawler_contact: str | None = None
    user_agent: str | None = None
    log_level: str = "INFO"

    @field_validator("scratch_dir")
    @classmethod
    def _absolute(cls, value: Path) -> Path:
        return value.expanduser().resolve()

    @model_validator(mode="after")
    def _default_user_agent(self) -> "Settings":
        if self.user_agent is None:
            contact = f"; mailto:{self.crawler_contact}" if self.crawler_contact else ""
            self.user_agent = f"artlog-bot/0.1 (+{REPO_URL}{contact})"
        return self

    @cached_property
    def device(self) -> str:
        return self.device_name or detect_device()


@lru_cache
def get_settings() -> Settings:
    return Settings()


def setup_logging(settings: Settings) -> None:
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
