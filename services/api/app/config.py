from __future__ import annotations
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    value = int(os.getenv(name, str(default)))
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def default_tools_file() -> Path:
    explicit = os.getenv("TOOLS_FILE")
    if explicit:
        return Path(explicit)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "shared/tools.json"
        if candidate.is_file():
            return candidate
    raise RuntimeError("Set TOOLS_FILE to the shared tools.json catalog.")


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", ".data")).resolve())
    max_upload_mb: int = field(default_factory=lambda: env_int("MAX_UPLOAD_MB", 50, 1, 500))
    max_files: int = 20
    max_pages: int = field(default_factory=lambda: env_int("MAX_PAGES", 200, 1, 1000))
    max_output_mb: int = 250
    max_jobs: int = 24
    session_jobs: int = 3
    job_timeout: int = field(default_factory=lambda: env_int("JOB_TIMEOUT_SECONDS", 180, 15, 1800))
    worker_memory_mb: int = field(default_factory=lambda: env_int("WORKER_MEMORY_MB", 1536, 256, 8192))
    concurrency: int = field(default_factory=lambda: env_int("WORKER_CONCURRENCY", 2, 1, 8))
    retention_seconds: int = field(default_factory=lambda: env_int("RETENTION_SECONDS", 3600, 300, 86400))
    gotenberg_url: str = field(default_factory=lambda: os.getenv("GOTENBERG_URL", "http://gotenberg:3000").rstrip("/"))
    office_engine: str = field(default_factory=lambda: os.getenv("OFFICE_ENGINE", "gotenberg"))
    libreoffice_bin: str = field(default_factory=lambda: os.getenv("LIBREOFFICE_BIN", "libreoffice"))
    secure_cookie: bool = field(default_factory=lambda: os.getenv("COOKIE_SECURE", "false").lower() == "true")
    tools_file: Path = field(default_factory=default_tools_file)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    def session_secret(self) -> str:
        explicit = os.getenv("SESSION_SECRET")
        if explicit:
            if len(explicit) < 32:
                raise ValueError("SESSION_SECRET must contain at least 32 characters")
            return explicit
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = self.data_dir / ".session-key"
        if not path.exists():
            try:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "w") as handle:
                    handle.write(secrets.token_hex(32))
            except FileExistsError:
                pass
        return path.read_text().strip()
