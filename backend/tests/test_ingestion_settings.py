from backend.app.db.session import init_db
from backend.app.schemas import IngestionRun, IntegrationSettings
from backend.app.services import store


def test_integration_status_lists_ats_and_catalog_meta():
    init_db()
    try:
        status = store.save_integration_settings(IntegrationSettings())
        assert status.ats_sources == ["ashby", "greenhouse", "lever", "workday"]
        assert status.scraper_sources == ["ashby", "greenhouse", "lever", "workday"]
        assert status.adzuna_configured is False
        assert status.usajobs_configured is False
        assert status.jsearch_configured is False
        assert status.companies_catalog.get("exists") is True

        saved = store.save_ingestion_run(
            IngestionRun(
                query="machine learning engineer",
                location="Remote",
                sources=["ashby", "greenhouse"],
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
