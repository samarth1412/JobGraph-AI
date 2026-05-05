from __future__ import annotations

import re

from backend.app.schemas import CandidateProfile, Job


def build_graph_snapshot(candidate: CandidateProfile, jobs: list[Job]) -> dict:
    nodes = []
    edges = []
    seen = set()

    def add_node(node_id: str, label: str, node_type: str) -> None:
        if node_id in seen:
            return
        seen.add(node_id)
        nodes.append({"id": node_id, "label": label, "type": node_type})

    candidate_id = f"candidate:{candidate.candidate_id}"
    add_node(candidate_id, candidate.name or candidate.candidate_id, "candidate")

    for skill in candidate.skills:
        skill_id = f"skill:{skill.lower()}"
        add_node(skill_id, skill, "skill")
        edges.append({"source": candidate_id, "target": skill_id, "type": "has_skill"})

    for location in candidate.location_preferences:
        location_id = f"location:{location.lower()}"
        add_node(location_id, location, "location")
        edges.append({"source": candidate_id, "target": location_id, "type": "prefers"})

    for role in candidate.target_roles:
        role_id = f"role:{role.lower()}"
        add_node(role_id, role, "role")
        edges.append({"source": candidate_id, "target": role_id, "type": "targets_role"})

    candidate_level = _candidate_experience_level(candidate.experience_years)
    candidate_level_id = f"experience:{candidate_level}"
    add_node(candidate_level_id, candidate_level.title(), "experience_level")
    edges.append({"source": candidate_id, "target": candidate_level_id, "type": "has_experience_level"})

    for job in jobs:
        graph_job_id = f"job:{job.job_id}"
        add_node(graph_job_id, job.title, "job")
        company_id = f"company:{job.company.lower()}"
        location_id = f"location:{job.location.lower() or 'unknown'}"
        job_level = _job_experience_level(job)
        job_level_id = f"experience:{job_level}"
        add_node(company_id, job.company, "company")
        add_node(location_id, job.location or "Unknown", "location")
        add_node(job_level_id, job_level.title(), "experience_level")
        edges.append({"source": graph_job_id, "target": company_id, "type": "posted_by"})
        edges.append({"source": graph_job_id, "target": location_id, "type": "located_in"})
        edges.append({"source": graph_job_id, "target": job_level_id, "type": "requires_experience_level"})

        for skill in job.required_skills:
            skill_id = f"skill:{skill.lower()}"
            add_node(skill_id, skill, "skill")
            edges.append({"source": graph_job_id, "target": skill_id, "type": "requires_skill"})

    return {
        "nodes": nodes,
        "edges": edges,
        "summary": {
            "nodes": len(nodes),
            "edges": len(edges),
            "jobs": len(jobs),
            "candidate_skills": len(candidate.skills),
            "schema": "candidate_skill_job_company_location_experience_role",
        },
    }


def _candidate_experience_level(years: float) -> str:
    if years < 1:
        return "entry"
    if years < 4:
        return "early"
    if years < 8:
        return "mid"
    return "senior"


def _job_experience_level(job: Job) -> str:
    blob = f"{job.title} {job.description}".lower()
    years = [float(value) for value in re.findall(r"(\d+)\+?\s*(?:years|yrs|yr\b)", blob)]
    if any(term in blob for term in ("intern", "new grad", "entry level", "junior")):
        return "entry"
    if any(term in blob for term in ("senior", "staff", "principal", "lead")) or (years and max(years) >= 6):
        return "senior"
    if years and max(years) <= 2:
        return "early"
    return "mid"
