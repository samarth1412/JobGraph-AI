from __future__ import annotations

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

    for job in jobs:
        graph_job_id = f"job:{job.job_id}"
        add_node(graph_job_id, job.title, "job")
        company_id = f"company:{job.company.lower()}"
        location_id = f"location:{job.location.lower() or 'unknown'}"
        add_node(company_id, job.company, "company")
        add_node(location_id, job.location or "Unknown", "location")
        edges.append({"source": graph_job_id, "target": company_id, "type": "posted_by"})
        edges.append({"source": graph_job_id, "target": location_id, "type": "located_in"})

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
        },
    }
