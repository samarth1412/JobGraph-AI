from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from backend.app.agents import tools


@dataclass
class AgentStep:
    tool: str
    args: Dict[str, Any] = field(default_factory=dict)
    reason: str = ""


class JobSearchAgent:
    def __init__(self, candidate_id: str) -> None:
        self.candidate_id = candidate_id
        self.registry: Dict[str, Callable[..., dict]] = {
            "find_best_jobs": tools.find_best_jobs,
            "explain_match": tools.explain_match,
            "tailor_resume": tools.tailor_resume,
            "analyze_keyword_gaps": tools.analyze_keyword_gaps,
            "generate_cover_letter": tools.generate_cover_letter,
            "prepare_autofill_profile": tools.prepare_autofill_profile,
            "prepare_application": tools.prepare_application,
        }

    def run(self, message: str) -> dict:
        plan = self.plan(message)
        completed = []
        intermediate_results = {}
        final_result: dict = {}

        for step in plan:
            result = self._execute(step)
            completed.append({"tool": step.tool, "status": "completed", "reason": step.reason, "args": _safe_args(step.args)})
            final_result = result
            if step != plan[-1]:
                intermediate_results[step.tool] = result

        return {
            "agent": "jobgraph_react_tool_agent_v2",
            "intent": _intent_from_plan(plan),
            "plan": completed,
            "result": final_result,
            "intermediate_results": intermediate_results,
        }

    def plan(self, message: str) -> List[AgentStep]:
        lowered = message.lower()
        job_id = _extract_job_id(message)

        if job_id and ("keyword" in lowered or "missing" in lowered or "gap" in lowered):
            return [
                AgentStep("explain_match", {"candidate_id": self.candidate_id, "job_id": job_id}, "Extract matched and missing job signals."),
                AgentStep("analyze_keyword_gaps", {"candidate_id": self.candidate_id, "job_id": job_id}, "Recommend truthful resume keyword improvements."),
            ]

        if job_id and (_has_command_word(lowered, "apply") or "autofill" in lowered):
            return [
                AgentStep("explain_match", {"candidate_id": self.candidate_id, "job_id": job_id}, "Check fit before applying."),
                AgentStep("tailor_resume", {"candidate_id": self.candidate_id, "job_id": job_id}, "Prepare resume targeting guidance."),
                AgentStep("prepare_application", {"candidate_id": self.candidate_id, "job_id": job_id}, "Prepare autofill payload and apply portal handoff."),
            ]

        if "autofill" in lowered:
            return [AgentStep("prepare_autofill_profile", {"candidate_id": self.candidate_id}, "Prepare structured profile for browser autofill.")]

        if job_id and ("cover" in lowered or "letter" in lowered):
            return [
                AgentStep("explain_match", {"candidate_id": self.candidate_id, "job_id": job_id}, "Ground the draft in match evidence."),
                AgentStep("generate_cover_letter", {"candidate_id": self.candidate_id, "job_id": job_id}, "Draft a role-specific cover letter."),
            ]

        if job_id and ("tailor" in lowered or "resume" in lowered):
            return [
                AgentStep("explain_match", {"candidate_id": self.candidate_id, "job_id": job_id}, "Identify matched and missing skills."),
                AgentStep("tailor_resume", {"candidate_id": self.candidate_id, "job_id": job_id}, "Produce resume targeting guidance."),
            ]

        if job_id:
            return [AgentStep("explain_match", {"candidate_id": self.candidate_id, "job_id": job_id}, "Explain the selected job match.")]

        return [AgentStep("find_best_jobs", {"candidate_id": self.candidate_id, "k": 10}, "Rank current jobs with hybrid semantic and GNN graph signals.")]

    def _execute(self, step: AgentStep) -> dict:
        tool = self.registry[step.tool]
        return tool(**step.args)


def _extract_job_id(message: str) -> Optional[str]:
    match = re.search(r"(?:demo|adzuna|usajobs|jsearch|job)_[a-z0-9_:-]+", message, flags=re.I)
    return match.group(0) if match else None


def _has_command_word(message: str, word: str) -> bool:
    return bool(re.search(rf"\b{re.escape(word)}\b", message))


def _intent_from_plan(plan: List[AgentStep]) -> str:
    return plan[-1].tool if plan else "unknown"


def _safe_args(args: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in args.items() if "key" not in key.lower() and "token" not in key.lower()}
