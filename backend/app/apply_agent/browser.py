from __future__ import annotations

import asyncio
import sys
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.app.apply_agent.adapters import adapter_for_url
from backend.app.apply_agent.field_mapper import boolean_choice, normalize_label, value_for_field
from backend.app.apply_agent.schemas import PageFillResult
from backend.app.schemas import ApplyAgentRun, CandidateProfile, Job
from backend.app.services import store

_ACTIVE_BROWSERS: Dict[int, Tuple[Any, Any, Any]] = {}
FORM_SELECTOR = "input:not([type='hidden']), textarea, select, [contenteditable='true']"


def create_apply_run(candidate_id: str, job_id: str, headless: bool = False) -> ApplyAgentRun:
    job = store.get_job(job_id)
    profile = store.get_autofill(candidate_id)
    adapter = adapter_for_url(job.apply_url)
    run = ApplyAgentRun(
        candidate_id=candidate_id,
        job_id=job_id,
        apply_url=job.apply_url,
        ats=adapter.name,
        status="starting" if job.apply_url else "failed",
        error="" if job.apply_url else "This job does not have an apply URL.",
        metadata={
            "headless": headless,
            "submit_policy": "never_submit_without_user_approval",
            "profile_fields_available": sorted(key for key, value in profile.model_dump().items() if value),
        },
        finished_at=None if job.apply_url else datetime.utcnow(),
    )
    return store.save_apply_agent_run(run)


def execute_apply_run(run_id: int) -> ApplyAgentRun:
    result: Optional[ApplyAgentRun] = None
    error: Optional[Exception] = None

    def worker() -> None:
        nonlocal result, error
        try:
            result = _execute_apply_run_sync(run_id)
        except Exception as exc:
            error = exc

    thread = threading.Thread(target=worker, name=f"apply-agent-run-{run_id}", daemon=False)
    thread.start()
    thread.join()

    if result:
        return result
    run = store.get_apply_agent_run(run_id)
    return _finish(run, "failed", error=str(error or "Apply agent worker failed."))


def _execute_apply_run_sync(run_id: int) -> ApplyAgentRun:
    run = store.get_apply_agent_run(run_id)
    if not run.apply_url:
        return _finish(run, "failed", error="This job does not have an apply URL.")

    profile = store.get_autofill(run.candidate_id)
    candidate = store.get_candidate(run.candidate_id)
    job = store.get_job(run.job_id)
    run = _update(run, status="navigating")
    _configure_windows_playwright_loop()
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        return _finish(
            run,
            "failed",
            error=f"Playwright is not installed or browsers are missing: {exc}. Install dependencies and run `python -m playwright install chromium`.",
        )

    playwright = None
    browser = None
    try:
        playwright = sync_playwright().start()
        browser = playwright.chromium.launch(headless=bool(run.metadata.get("headless", False)))
        page = browser.new_page()
        if run.id is not None:
            _ACTIVE_BROWSERS[run.id] = (playwright, browser, page)
        page.goto(run.apply_url, wait_until="domcontentloaded", timeout=45000)
        _wait_for_application_form(page)
        run = _update(run, status="filling", current_url=page.url)
        result = fill_current_page(page, profile, candidate, job, run.apply_url)
        return _update(
            run,
            status="blocked" if result.blockers else "needs_review",
            ats=result.ats,
            current_url=result.current_url,
            filled_fields=result.filled_fields,
            blockers=result.blockers,
            file_fields=result.file_fields,
            page_summary=result.page_summary,
            metadata={
                **run.metadata,
                "review_required": True,
                "submit_policy": "never_submit_without_user_approval",
            },
        )
    except Exception as exc:
        failed = _finish(run, "failed", error=str(exc))
        _close_browser(run.id)
        return failed


def _configure_windows_playwright_loop() -> None:
    if sys.platform.startswith("win") and hasattr(asyncio, "WindowsProactorEventLoopPolicy"):
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


def _wait_for_application_form(page: Any) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
        pass
    try:
        page.wait_for_selector(FORM_SELECTOR, timeout=20000)
        return
    except Exception:
        pass

    _click_apply_entrypoint(page)
    try:
        page.wait_for_selector(FORM_SELECTOR, timeout=15000)
    except Exception:
        pass


def _click_apply_entrypoint(page: Any) -> None:
    candidates = [
        "a:has-text('Apply')",
        "button:has-text('Apply')",
        "a:has-text('Apply Now')",
        "button:has-text('Apply Now')",
        "a:has-text('Start application')",
        "button:has-text('Start application')",
    ]
    for selector in candidates:
        try:
            locator = page.locator(selector).first
            if locator.count() and locator.is_visible():
                locator.click(timeout=3000)
                return
        except Exception:
            continue


def fill_current_page(page: Any, profile, candidate: CandidateProfile, job: Job, apply_url: str = "") -> PageFillResult:
    adapter = adapter_for_url(apply_url or page.url)
    result = PageFillResult(current_url=page.url, ats=adapter.name, page_summary=_page_summary(page))
    filled_handles: List[Any] = []

    for element in page.query_selector_all("input, textarea, select"):
        try:
            field_type = (element.get_attribute("type") or "").lower()
            tag_name = element.evaluate("(el) => el.tagName.toLowerCase()")
            label = _field_label(element)
            if _should_skip(element, field_type):
                continue
        except Exception:
            continue
        if field_type == "file":
            result.file_fields.append({"label": label or "File upload", "reason": "Browser automation cannot choose a local resume file safely."})
            continue

        match = value_for_field(profile, label)
        fallback_value, fallback_source = ("", "")
        if not match:
            fallback_value, fallback_source = _fallback_value(candidate, job, label, tag_name, element)
        if not match and not fallback_value:
            continue

        try:
            value = match.value if match else fallback_value
            source = match.key if match else fallback_source
            confidence = match.confidence if match else 0.56
            if tag_name == "select":
                if _select_option(element, value):
                    filled_handles.append(element)
                    result.filled_fields.append(_filled(label, source, confidence))
            elif field_type in {"checkbox", "radio"}:
                if boolean_choice(value, label):
                    element.check()
                    filled_handles.append(element)
                    result.filled_fields.append(_filled(label, source, confidence))
            else:
                element.fill(value)
                filled_handles.append(element)
                result.filled_fields.append(_filled(label, source, confidence))
        except Exception as exc:
            result.blockers.append({"label": label or "Unknown field", "reason": f"Could not fill field: {exc}"})

    if not result.filled_fields and not result.file_fields and not result.blockers:
        result.blockers.append(
            {
                "label": "Application form",
                "reason": "No fillable form fields were detected after waiting for the ATS page to load.",
            }
        )

    filled_ids = {id(handle) for handle in filled_handles}
    for element in page.query_selector_all("input[required], textarea[required], select[required], [aria-required='true']"):
        if id(element) in filled_ids:
            continue
        try:
            field_type = (element.get_attribute("type") or "").lower()
            if _should_skip(element, field_type) or _has_value(element):
                continue
            result.blockers.append({"label": _field_label(element) or "Required field", "reason": "Required question needs user input."})
        except Exception:
            continue

    return result


def continue_apply_run(run_id: int) -> ApplyAgentRun:
    run = store.get_apply_agent_run(run_id)
    metadata = {**run.metadata, "continue_requested": True, "submit_policy": "never_submit_without_user_approval"}
    return _update(run, metadata=metadata, status="needs_review" if run.status in {"blocked", "filling"} else run.status)


def cancel_apply_run(run_id: int) -> ApplyAgentRun:
    run = store.get_apply_agent_run(run_id)
    _close_browser(run_id)
    return _finish(run, "cancelled")


def _field_label(element: Any) -> str:
    return normalize_label(
        element.evaluate(
            r"""(input) => {
                const id = input.getAttribute("id");
                const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText || "" : "";
                const ariaLabelledBy = (input.getAttribute("aria-labelledby") || "")
                    .split(/\s+/)
                    .map((item) => document.getElementById(item)?.innerText || "")
                    .join(" ");
                const directWrapper = input.closest("label, fieldset, [role='group']")?.innerText || "";
                let parentText = "";
                let parent = input.parentElement;
                for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
                    const text = (parent.innerText || "").trim();
                    if (text && text.length < 260) {
                        parentText = text;
                        break;
                    }
                }
                return [
                    input.getAttribute("aria-label") || "",
                    ariaLabelledBy,
                    input.getAttribute("name") || "",
                    input.getAttribute("placeholder") || "",
                    input.getAttribute("title") || "",
                    label,
                    directWrapper,
                    parentText
                ].join(" ");
            }"""
        )
    )


def _should_skip(element: Any, field_type: str) -> bool:
    try:
        return field_type == "hidden" or element.is_disabled() or element.get_attribute("readonly") is not None or not element.is_visible()
    except Exception:
        return True


def _select_option(element: Any, value: str) -> bool:
    option_value = element.evaluate(
        """(select, wanted) => {
            const normalized = String(wanted).toLowerCase();
            const option = Array.from(select.options).find((item) => {
                const text = `${item.text} ${item.value}`.toLowerCase();
                return text.includes(normalized) || normalized.includes(text.trim());
            });
            return option ? option.value : null;
        }""",
        value,
    )
    if option_value is None:
        return False
    element.select_option(option_value)
    return True


def _fallback_value(candidate: CandidateProfile, job: Job, label: str, tag_name: str, element: Any) -> Tuple[str, str]:
    normalized = normalize_label(label)
    if tag_name == "textarea" and _is_required(element):
        answer = _resume_based_text_answer(candidate, job, normalized)
        if answer:
            return answer, "resume_draft.required_text_answer"
    if tag_name == "input" and ("country" in normalized or "city" in normalized or "location" in normalized):
        if candidate.location_preferences:
            return candidate.location_preferences[0], "candidate.location_preferences"
    return "", ""


def _resume_based_text_answer(candidate: CandidateProfile, job: Job, label: str) -> str:
    skills = ", ".join(candidate.skills[:6])
    project = candidate.projects[0] if candidate.projects else ""
    summary = candidate.summary or project
    role = job.title or "this role"
    company = job.company or "your team"

    if not any(term in label for term in ("describe", "why", "project", "role", "experience", "work")):
        return ""

    parts = []
    if summary:
        parts.append(summary)
    if project:
        parts.append(f"One relevant project from my resume is: {project}")
    if skills:
        parts.append(f"I would connect that experience to {role} at {company} through my background with {skills}.")
    if not parts:
        return ""
    return " ".join(parts[:3])


def _is_required(element: Any) -> bool:
    try:
        return element.get_attribute("required") is not None or element.get_attribute("aria-required") == "true"
    except Exception:
        return False


def _has_value(element: Any) -> bool:
    try:
        return bool(element.evaluate("(el) => el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value"))
    except Exception:
        return False


def _filled(label: str, source: str, confidence: float) -> Dict[str, Any]:
    return {"label": label or "Detected field", "source": source, "confidence": confidence}


def _page_summary(page: Any) -> str:
    title = ""
    try:
        title = page.title()
    except Exception:
        title = ""
    return f"{title} {page.url}".strip()


def _update(run: ApplyAgentRun, **changes: Any) -> ApplyAgentRun:
    payload = run.model_dump()
    payload.update(changes)
    payload["updated_at"] = datetime.utcnow()
    return store.save_apply_agent_run(ApplyAgentRun(**payload))


def _finish(run: ApplyAgentRun, status: str, error: str = "") -> ApplyAgentRun:
    return _update(run, status=status, error=error, finished_at=datetime.utcnow())


def _close_browser(run_id: Optional[int]) -> None:
    if run_id is None:
        return
    active = _ACTIVE_BROWSERS.pop(run_id, None)
    if not active:
        return
    playwright, browser, _page = active
    try:
        browser.close()
    except Exception:
        pass
    try:
        playwright.stop()
    except Exception:
        pass
