from __future__ import annotations

# Primary pipeline (plus operational / legacy statuses used by the app).
APPLICATION_STATUSES = frozenset(
    {
        "saved",
        "applied",
        "interview",
        "offer",
        "rejected",
        "skipped",
        "applying",
        "failed",
    }
)

_ALIASES = {
    "offered": "offer",
    "offer_received": "offer",
    "declined": "rejected",
    "not_selected": "rejected",
    "hired": "offer",
}


def normalize_application_status(raw: str) -> str:
    s = (raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    s = _ALIASES.get(s, s)
    if s not in APPLICATION_STATUSES:
        raise ValueError(f"Invalid application status '{raw}'. Allowed: {', '.join(sorted(APPLICATION_STATUSES))}")
    return s
