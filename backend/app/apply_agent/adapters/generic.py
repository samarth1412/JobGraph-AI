from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class AtsAdapter:
    """ATS-specific hints for reaching and stepping through hosted application flows."""

    name: str
    extra_apply_selectors: Tuple[str, ...] = ()


def adapter_for_url(apply_url: str) -> AtsAdapter:
    lowered = apply_url.lower()
    if "greenhouse" in lowered:
        from backend.app.apply_agent.adapters import greenhouse as gh

        return AtsAdapter(name="greenhouse", extra_apply_selectors=gh.EXTRA_APPLY_SELECTORS)
    if "lever.co" in lowered:
        from backend.app.apply_agent.adapters import lever as lv

        return AtsAdapter(name="lever", extra_apply_selectors=lv.EXTRA_APPLY_SELECTORS)
    if "ashbyhq" in lowered or "ashby" in lowered:
        from backend.app.apply_agent.adapters import ashby as ash

        return AtsAdapter(name="ashby", extra_apply_selectors=ash.EXTRA_APPLY_SELECTORS)
    if "myworkdayjobs" in lowered or "workday" in lowered:
        return AtsAdapter(name="workday")
    return AtsAdapter(name="generic")
