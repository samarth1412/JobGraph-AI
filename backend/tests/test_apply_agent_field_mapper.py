from backend.app.apply_agent.adapters.generic import adapter_for_url
from backend.app.apply_agent.field_mapper import boolean_choice, value_for_field
from backend.app.schemas import AutofillProfile


def test_field_mapper_matches_resume_profile_fields():
    profile = AutofillProfile(
        legal_name="Resume User",
        email="resume@example.com",
        phone="555-111-2222",
        linkedin="https://linkedin.com/in/resume-user",
        education={"school": "Graph University", "degree": "BS Computer Science"},
    )

    assert value_for_field(profile, "Full legal name").value == "Resume User"
    assert value_for_field(profile, "Email address").key == "email"
    assert value_for_field(profile, "Mobile phone").value == "555-111-2222"
    assert value_for_field(profile, "LinkedIn profile").key == "linkedin"
    assert value_for_field(profile, "University or college").value == "Graph University"
    assert value_for_field(profile, "Degree").value == "BS Computer Science"


def test_field_mapper_handles_boolean_options_and_ats_detection():
    assert boolean_choice("Yes", "Yes, I am authorized to work")
    assert boolean_choice("No", "No, I will not need sponsorship")
    gh = adapter_for_url("https://boards.greenhouse.io/example/jobs/123")
    assert gh.name == "greenhouse"
    assert len(gh.extra_apply_selectors) > 0
    assert adapter_for_url("https://jobs.lever.co/example/123").name == "lever"
    assert adapter_for_url("https://jobs.ashbyhq.com/example/123").name == "ashby"
    assert adapter_for_url("https://example.myworkdayjobs.com/careers").name == "workday"
    assert adapter_for_url("https://company.example/apply").name == "generic"
