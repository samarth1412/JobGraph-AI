from backend.app.ingestion.normalize import from_ashby


def test_from_ashby_normalizes_public_posting():
    row = {
        "title": "Product Engineer",
        "location": "San Francisco",
        "workplaceType": "Hybrid",
        "descriptionPlain": "Build Python and React systems.",
        "applyUrl": "https://jobs.ashbyhq.com/acme/apply/123",
        "publishedAt": "2026-01-01T00:00:00Z",
        "compensation": {
            "summaryComponents": [
                {"compensationType": "Salary", "minValue": 120000, "maxValue": 160000}
            ]
        },
    }

    job = from_ashby(row, board_name="Acme")

    assert job.source == "ashby"
    assert job.company == "Acme"
    assert job.work_model == "hybrid"
    assert job.apply_url.endswith("/123")
    assert job.salary_min == 120000
    assert "Python" in job.required_skills
