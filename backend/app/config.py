"""Application settings loaded from environment variables and ``backend/.env`` (SPEC Section 6)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env, resolved relative to this file so the working directory does not matter.
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    """All runtime configuration. Secrets are ``SecretStr`` so they never appear in reprs or logs."""

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    tiger_connection_string: SecretStr
    readonly_connection_string: SecretStr | None = None
    admin_token: SecretStr | None = None
    # Kept as a plain string: comma-separated values are not valid JSON for a list field.
    cors_origins: str = "http://localhost:5173"
    db_pool_size: int = Field(default=5, ge=1, le=50)
    sim_max_vehicles: int = Field(default=1000, ge=1)
    sim_min_interval_seconds: float = Field(default=1, gt=0)
    sim_default_max_rows: int = Field(default=1_000_000, ge=1)
    bench_statement_timeout_seconds: int = Field(default=120, ge=1)
    cagg_refresh_interval_seconds: int = Field(default=60, ge=1)

    @property
    def cors_origin_list(self) -> list[str]:
        """Return ``CORS_ORIGINS`` split on commas, whitespace trimmed, empties removed."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def read_dsn(self) -> str:
        """DSN for dashboard reads: the read-only role if configured, else the main role."""
        ro = self.readonly_connection_string
        if ro is not None and ro.get_secret_value().strip():
            return ro.get_secret_value()
        return self.tiger_connection_string.get_secret_value()

    @property
    def write_dsn(self) -> str:
        """DSN for writes and admin jobs (always the main role)."""
        return self.tiger_connection_string.get_secret_value()


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings instance (loaded once)."""
    return Settings()  # type: ignore[call-arg]  # values come from the environment
