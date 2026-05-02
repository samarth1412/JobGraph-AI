from backend.app.agents.tools import generate_cover_letter
from backend.app.db.session import init_db
from backend.app.seed import seed
from backend.app.services import store


def test_generate_cover_letter_uses_persisted_job_store():
    init_db()
    seed()
    job = store.list_jobs()[0]

    output = generate_cover_letter("default", job.job_id)

    assert output["job_id"] == job.job_id
    assert job.company in output["cover_letter"]
    assert job.title in output["cover_letter"]
