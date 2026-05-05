from backend.app.ingestion.logo_urls import resolve_company_logo_url
from backend.app.schemas import Job, job_with_unified_api_fields


def test_resolve_logo_prefers_raw_url():
    url = resolve_company_logo_url(
        "ashby",
        "Acme",
        "https://jobs.ashbyhq.com/x/123",
        {"logoUrl": "https://cdn.example.com/logo.png"},
    )
    assert url == "https://cdn.example.com/logo.png"


def test_resolve_logo_favicon_for_greenhouse_slug():
    url = resolve_company_logo_url(
        "greenhouse",
        "stripe",
        "https://boards.greenhouse.io/stripe/jobs/1",
        {},
    )
    assert "favicons" in url
    assert "stripe.com" in url


def test_job_model_includes_logo_after_unify():
    job = job_with_unified_api_fields(
        Job(
            job_id="gh_x",
            source="greenhouse",
            title="Engineer",
            company="figma",
            location="Remote",
            work_model="remote",
            description="d",
            apply_url="https://boards.greenhouse.io/figma/jobs/1",
            required_skills=[],
            raw={},
        )
    )
    assert job.company_logo_url
    assert "figma.com" in job.company_logo_url
