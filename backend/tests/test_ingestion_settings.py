from backend.app.db.session import init_db
from backend.app.schemas import IngestionRun, IntegrationSettings
from backend.app.services import store


def test_integration_settings_status_and_ingestion_run_history():
    init_db()
    try:
        status = store.save_integration_settings(
            IntegrationSettings(
                adzuna_app_id="app",
                adzuna_app_key="key",
                usajobs_user_agent="user@example.com",
                usajobs_api_key="usa-key",
            )
        )
        assert status.adzuna_configured is True
        assert status.usajobs_configured is True
        assert status.jsearch_configured is False

        saved = store.save_ingestion_run(
            IngestionRun(
                query="machine learning engineer",
                location="Remote",
                sources=["adzuna"],
                jobs_found=2,
                jobs_saved=2,
                status="success",
            )
        )
        runs = store.list_ingestion_runs(limit=5)

        assert saved.id is not None
        assert any(run.id == saved.id and run.jobs_saved == 2 for run in runs)
    finally:
        store.save_integration_settings(IntegrationSettings())
