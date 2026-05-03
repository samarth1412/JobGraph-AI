from backend.app.resume.parser import parse_resume_text
from backend.app.core.config import get_settings


def test_resume_parser_extracts_structured_profile_without_llm(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    get_settings.cache_clear()
    text = """
    Manav Sharma
    manav@example.com
    https://github.com/manav
    https://linkedin.com/in/manav

    Skills
    Python, PyTorch, FastAPI, React, LangGraph

    Experience
    Machine Learning Engineer Intern - Acme AI - 2025
    - Built model serving APIs with FastAPI and PyTorch.

    Projects
    Job recommendation engine using graph neural networks.

    Education
    University of Example, MS Computer Science
    """

    profile = parse_resume_text(text, candidate_id="test")

    assert profile.candidate_id == "test"
    assert profile.name == "Manav Sharma"
    assert profile.email == "manav@example.com"
    assert "Python" in profile.skills
    assert "Machine Learning Engineer" in profile.target_roles
    assert profile.experience
    assert profile.education
    assert profile.links["github"].startswith("https://github.com")
    get_settings.cache_clear()
