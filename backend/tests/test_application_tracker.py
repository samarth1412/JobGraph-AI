import pytest

from backend.app.db.session import init_db
from backend.app.schemas import ApplicationEvent, Job
from backend.app.services import store


def test_application_status_validation():
    with pytest.raises(ValueError):
        ApplicationEvent(candidate_id="x", job_id="j", status="not_a_real_status")


def test_save_application_sets_applied_at_for_applied_status():
    init_db()
    store.upsert_jobs([Job(job_id="t-app-1", source="ashby", title="Engineer", company="Co", apply_url="https://x", required_skills=["Python"])])
    ev = store.save_application(ApplicationEvent(candidate_id="trk", job_id="t-app-1", status="applied", note="Submitted"))
    assert ev.status == "applied"
    assert ev.applied_at is not None


def test_application_summary_and_history():
    init_db()
    store.upsert_jobs([Job(job_id="t-app-2", source="greenhouse", title="MLE", company="Acme", apply_url="https://y", required_skills=["PyTorch"])])
    store.save_application(ApplicationEvent(candidate_id="trk2", job_id="t-app-2", status="saved", note="Bookmarked"))
    store.save_application(ApplicationEvent(candidate_id="trk2", job_id="t-app-2", status="applied", note="Sent app"))
    hist = store.list_application_history("trk2", "t-app-2")
    assert len(hist) == 2
    assert hist[-1].status == "applied"
    summaries = store.list_application_summaries("trk2")
    row = next(s for s in summaries if s.job_id == "t-app-2")
    assert row.latest_status == "applied"
    assert row.history_count == 2
    assert row.job_title == "MLE"
    assert row.company == "Acme"
