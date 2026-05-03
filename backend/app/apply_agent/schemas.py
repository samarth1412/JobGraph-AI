from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass(frozen=True)
class FieldMatch:
    key: str
    value: str
    confidence: float


@dataclass
class PageFillResult:
    current_url: str = ""
    ats: str = "generic"
    filled_fields: List[Dict[str, Any]] = field(default_factory=list)
    blockers: List[Dict[str, Any]] = field(default_factory=list)
    file_fields: List[Dict[str, Any]] = field(default_factory=list)
    page_summary: str = ""
