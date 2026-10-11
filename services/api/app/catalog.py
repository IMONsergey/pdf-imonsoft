from __future__ import annotations
import json
from pathlib import Path
from typing import Any


def load_catalog(path: Path) -> dict[str, dict[str, Any]]:
    tools = json.loads(path.read_text())
    return {tool["id"]: tool for tool in tools}
