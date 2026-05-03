from backend.app.ingestion.normalize import from_greenhouse, from_jobspy, from_lever, from_workday


def test_from_jobspy_normalizes_board_result():
    row = {
        "site": "indeed",
        "title": "Machine Learning Engineer",
        "company": "Acme AI",
        "city": "San Francisco",
        "state": "CA",
        "description": "Build Python, PyTorch, and React systems.",
        "job_url": "https://www.indeed.com/viewjob?jk=123",
        "min_amount": 120000,
        "max_amount": 160000,
    }

    job = from_jobspy(row)

    assert job.source == "jobspy_indeed"
    assert job.company == "Acme AI"
    assert job.apply_url.endswith("jk=123")
    assert job.salary_min == 120000
    assert "Python" in job.required_skills


def test_from_greenhouse_normalizes_company_board_job():
    row = {
        "title": "AI Product Engineer",
        "absolute_url": "https://boards.greenhouse.io/acme/jobs/123",
        "location": {"name": "New York, NY"},
        "content": "<p>Work with FastAPI and LLM evaluation.</p>",
        "updated_at": "2026-01-01T00:00:00Z",
    }

    job = from_greenhouse(row, board_name="acme")

    assert job.source == "greenhouse"
    assert job.company == "acme"
    assert job.apply_url.endswith("/123")
    assert "FastAPI" in job.required_skills


def test_from_lever_normalizes_company_posting():
    row = {
        "text": "Applied AI Engineer",
        "hostedUrl": "https://jobs.lever.co/acme/123",
        "applyUrl": "https://jobs.lever.co/acme/123/apply",
        "categories": {"location": "Remote", "commitment": "Full-time"},
        "lists": [{"text": "Build LangGraph agents and RAG workflows."}],
        "createdAt": 1767225600000,
    }

    job = from_lever(row, company="acme")

    assert job.source == "lever"
    assert job.work_model == "remote"
    assert job.apply_url.endswith("/apply")
    assert "LangGraph" in job.required_skills


def test_from_workday_normalizes_company_portal_result():
    row = {
        "title": "Recommendation Systems Engineer",
        "locationsText": "Austin, TX",
        "externalPath": "/job/Austin-TX/Recommendation-Systems-Engineer_R123",
        "postedOn": "Posted 2 Days Ago",
        "timeType": "Full time",
    }

    job = from_workday(row, tenant="acme", site="External", base_url="https://acme.wd1.myworkdayjobs.com")

    assert job.source == "workday"
    assert job.company == "acme"
    assert "External/job/Austin-TX" in job.apply_url
    assert job.location == "Austin, TX"
