from backend.app.ingestion.clients import JobIngestionClient
from backend.app.core.config import Settings
from backend.app.schemas import IntegrationSettings, SearchRequest


def test_ingestion_does_not_silently_fallback_to_demo_jobs():
    jobs = JobIngestionClient(IntegrationSettings()).search(
        SearchRequest(
            query="machine learning engineer",
            location="Remote",
            sources=[],
        )
    )

    assert jobs == []


def test_ingestion_returns_demo_jobs_only_when_requested():
    jobs = JobIngestionClient(IntegrationSettings()).search(
        SearchRequest(
            query="machine learning engineer",
            location="Remote",
            sources=["demo"],
        )
    )

    assert jobs
    assert {job.source for job in jobs} == {"demo"}
    assert all(job.required_skills for job in jobs)


def test_default_ats_configuration_includes_multiple_providers():
    settings = Settings()

    assert settings.ashby_job_boards
    assert settings.greenhouse_boards
    assert settings.lever_companies
    assert "airbnb" in settings.greenhouse_boards
    assert "netflix" in settings.lever_companies
