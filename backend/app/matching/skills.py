from __future__ import annotations

import re
from typing import Iterable, List

SKILL_VOCAB = sorted({
    "Python", "Java", "C++", "SQL", "PyTorch", "TensorFlow", "scikit-learn", "Pandas", "NumPy",
    "FastAPI", "Docker", "Kubernetes", "AWS", "GCP", "Azure", "MLflow", "Airflow", "Kafka",
    "Spark", "Databricks", "LangGraph", "LangChain", "RAG", "LLM", "OpenAI", "Hugging Face",
    "Transformers", "Graph Neural Networks", "PyTorch Geometric", "Recommendation Systems", "Ranking",
    "A/B Testing", "Feature Store", "Model Serving", "MLOps", "OpenTelemetry", "Prometheus", "Grafana",
    "PostgreSQL", "Redis", "pgvector", "Vector Search", "NLP", "Computer Vision", "Time Series",
    "Experiment Tracking", "CI/CD", "GitHub Actions", "React", "Next.js", "TypeScript",
    "Salesforce", "CRM", "Account Management", "Lead Generation", "Customer Success", "HubSpot",
    "Excel", "Tableau", "Power BI", "Go", "Node.js", "Django", "Flask", "REST", "GraphQL",
    "Product Management", "Jira", "Figma", "Analytics", "Statistics"
})

ALIASES = {
    "pytorch geometric": "PyTorch Geometric",
    "gnn": "Graph Neural Networks",
    "gnns": "Graph Neural Networks",
    "llms": "LLM",
    "large language model": "LLM",
    "retrieval augmented generation": "RAG",
    "ml ops": "MLOps",
    "ci cd": "CI/CD",
}


def normalize_skill(skill: str) -> str:
    cleaned = re.sub(r"\s+", " ", skill.strip())
    lower = cleaned.lower()
    if lower in ALIASES:
        return ALIASES[lower]
    for item in SKILL_VOCAB:
        if item.lower() == lower:
            return item
    return cleaned


def extract_skills(text: str, extra_vocab: Iterable[str] = ()) -> List[str]:
    haystack = text.lower()
    found = set()
    for skill in list(SKILL_VOCAB) + list(extra_vocab):
        pattern = r"(?<![a-z0-9+#.])" + re.escape(skill.lower()) + r"(?![a-z0-9+#.])"
        if re.search(pattern, haystack):
            found.add(normalize_skill(skill))
    for alias, canonical in ALIASES.items():
        if alias in haystack:
            found.add(canonical)
    return sorted(found)
