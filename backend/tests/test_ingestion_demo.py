import pytest

from backend.app.ingestion.clients import JobIngestionClient
from backend.app.schemas import IntegrationSettings, SearchRequest


def test_ingestion_returns_empty_when_no_sources_requested():
    jobs = JobIngestionClient(IntegrationSettings()).search(
        SearchRequest(
            query="machine learning engineer",
            location="Remote",
            sources=[],
        )
    )

    assert jobs == []


def test_ingestion_errors_on_removed_non_ats_source():
    with pytest.raises(RuntimeError, match="demo"):
        JobIngestionClient(IntegrationSettings()).search(
            SearchRequest(
                query="machine learning engineer",
                location="Remote",
                sources=["demo"],
            )
        )


def test_companies_catalog_loads_and_includes_stripe():
    from backend.app.ingestion.companies_catalog import load_company_entries, resolve_catalog_path

    path = resolve_catalog_path()
    assert path.name == "companies.json"
    entries = load_company_entries(path)
    companies = {e.company for e in entries}
    assert "Stripe" in companies
    assert any(e.ats == "greenhouse" and e.board == "stripe" for e in entries)


def test_workday_token_from_public_url():
    from backend.app.ingestion.companies_catalog import workday_board_from_url

    token = workday_board_from_url("https://adobe.wd5.myworkdayjobs.com/external_experienced")
    tenant, site, base = token.split("|")
    assert tenant == "adobe"
    assert site == "external_experienced"
    assert base.startswith("https://adobe.wd5")


def test_matches_filters_respects_location_remote():
    c = JobIngestionClient(IntegrationSettings())
    req = SearchRequest(query="engineer", location="Remote", sources=["ashby"])
    assert c._matches_filters("Software Engineer", "Build APIs", "Remote - US", req) is True
    assert c._matches_filters("Software Engineer", "Build APIs", "San Francisco, CA", req) is False


def test_matches_filters_broad_location_skips_geo_gate():
    c = JobIngestionClient(IntegrationSettings())
    req = SearchRequest(query="engineer", location="United States", sources=["ashby"])
    assert c._matches_filters("Software Engineer", "Build APIs", "London, UK", req) is True


def test_matches_filters_query_terms_must_appear():
    c = JobIngestionClient(IntegrationSettings())
    req = SearchRequest(query="machine learning", location="", sources=["ashby"])
    assert c._matches_filters("Machine Learning Engineer", "TensorFlow pipelines", "", req) is True
    assert c._matches_filters("Cook", "Kitchen", "", req) is False
