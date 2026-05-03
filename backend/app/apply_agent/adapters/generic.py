from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AtsAdapter:
    name: str
    final_submit_terms: tuple[str, ...] = ("submit application", "submit", "send application")


def adapter_for_url(apply_url: str) -> AtsAdapter:
    lowered = apply_url.lower()
    if "greenhouse" in lowered:
        return AtsAdapter(name="greenhouse")
    if "lever.co" in lowered:
        return AtsAdapter(name="lever")
    if "ashbyhq" in lowered or "ashby" in lowered:
        return AtsAdapter(name="ashby")
    if "myworkdayjobs" in lowered or "workday" in lowered:
        return AtsAdapter(name="workday")
    return AtsAdapter(name="generic")
