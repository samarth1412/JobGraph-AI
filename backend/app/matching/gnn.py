from __future__ import annotations

from typing import Dict, List

import networkx as nx

from backend.app.schemas import CandidateProfile, Job


def graph_affinity_scores(candidate: CandidateProfile, jobs: List[Job]) -> List[float]:
    """GNN-ready graph signal using message passing over candidate-skill-job nodes.

    This is not a trained neural network yet. It builds the same heterogeneous graph
    a GraphSAGE/link-prediction model would consume, then uses personalized PageRank
    as a deterministic message-passing baseline until PyTorch Geometric training is
    added.
    """
    if not jobs:
        return []

    graph = nx.Graph()
    candidate_node = f"candidate:{candidate.candidate_id}"
    graph.add_node(candidate_node, node_type="candidate")

    for skill in candidate.skills:
        skill_node = _skill_node(skill)
        graph.add_node(skill_node, node_type="skill")
        graph.add_edge(candidate_node, skill_node, weight=1.4, edge_type="has_skill")

    for role in candidate.target_roles:
        role_node = f"role:{role.lower()}"
        graph.add_node(role_node, node_type="role")
        graph.add_edge(candidate_node, role_node, weight=0.6, edge_type="targets_role")

    for job in jobs:
        job_node = _job_node(job)
        graph.add_node(job_node, node_type="job")

        for skill in job.required_skills:
            skill_node = _skill_node(skill)
            graph.add_node(skill_node, node_type="skill")
            graph.add_edge(job_node, skill_node, weight=1.0, edge_type="requires_skill")

        role_tokens = [role for role in candidate.target_roles if role.lower() in job.title.lower()]
        for role in role_tokens:
            role_node = f"role:{role.lower()}"
            graph.add_node(role_node, node_type="role")
            graph.add_edge(job_node, role_node, weight=0.7, edge_type="role_match")

        if job.location:
            location_node = f"location:{job.location.lower()}"
            graph.add_node(location_node, node_type="location")
            graph.add_edge(job_node, location_node, weight=0.25, edge_type="located_in")
            if any(loc.lower() in job.location.lower() for loc in candidate.location_preferences):
                graph.add_edge(candidate_node, location_node, weight=0.5, edge_type="prefers_location")

    if graph.number_of_edges() == 0:
        return [0.0 for _ in jobs]

    personalization: Dict[str, float] = {node: 0.0 for node in graph.nodes}
    personalization[candidate_node] = 1.0
    ranks = nx.pagerank(graph, alpha=0.82, personalization=personalization, weight="weight")
    raw_scores = [ranks.get(_job_node(job), 0.0) for job in jobs]
    max_score = max(raw_scores) or 1.0
    return [score / max_score for score in raw_scores]


def _skill_node(skill: str) -> str:
    return f"skill:{skill.lower()}"


def _job_node(job: Job) -> str:
    return f"job:{job.job_id}"
