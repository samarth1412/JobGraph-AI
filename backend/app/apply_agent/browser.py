from __future__ import annotations

import asyncio
import re
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.app.apply_agent.adapters import adapter_for_url
from backend.app.apply_agent.field_mapper import boolean_choice, normalize_label, value_for_field
from backend.app.apply_agent.schemas import PageFillResult
from backend.app.apply_agent.node_runner import run_node_hybrid_apply
from backend.app.schemas import AgentStep, ApplyAgentRun, AutofillProfile, CandidateProfile, Job
from backend.app.services import store

_ACTIVE_BROWSERS: Dict[int, Tuple[Any, Any, Any]] = {}
FORM_SELECTOR = "input:not([type='hidden']), textarea, select, [contenteditable='true']"


def _best_resume_path(candidate_id: str, profile) -> str:
    """Prefer latest uploaded resume; avoid stale/default paths."""
    latest = (store.latest_resume_path(candidate_id) or "").strip()
    current = (getattr(profile, "candidate_resume_path", "") or "").strip()

    if latest and Path(latest).is_file():
        return latest
    if current and Path(current).is_file():
        return current
    # Return latest (even if missing) so error reporting points at the expected path.
    return latest or current


def _hybrid_candidate_for_agent(autofill: AutofillProfile, cand_row: CandidateProfile) -> Dict[str, Any]:
    """Merge stored autofill with parsed resume row so TS agent sees links + summary for mapping."""
    d = autofill.model_dump()
    ca = d.get("custom_answers") or {}
    d["resume_summary"] = (
        str(ca.get("resume summary") or ca.get("professional summary") or "").strip()
        or str(cand_row.summary or "").strip()
    )
    links = cand_row.links or {}
    for key in ("linkedin", "github", "portfolio"):
        if not str(d.get(key) or "").strip():
            d[key] = str(links.get(key, "") or "")
    if not str(d.get("legal_name") or "").strip() and cand_row.name:
        d["legal_name"] = cand_row.name
    if not str(d.get("work_authorization") or "").strip() and cand_row.work_authorization:
        d["work_authorization"] = cand_row.work_authorization
    if not str(d.get("sponsorship_required") or "").strip() and cand_row.sponsorship_required:
        d["sponsorship_required"] = cand_row.sponsorship_required
    return d


def create_apply_run(candidate_id: str, job_id: str, headless: bool = False) -> ApplyAgentRun:
    job = store.get_job(job_id)
    profile = store.get_autofill(candidate_id)
    candidate = store.get_candidate(candidate_id)
    profile = _hydrate_autofill_from_candidate(profile, candidate)
    # Always prefer the latest uploaded resume for this candidate.
    resume_path = _best_resume_path(candidate_id, profile)
    if resume_path and resume_path != (getattr(profile, "candidate_resume_path", "") or "").strip():
        profile.candidate_resume_path = resume_path
        profile = store.save_autofill(profile)
    adapter = _adapter_for_job(job)
    run = ApplyAgentRun(
        candidate_id=candidate_id,
        job_id=job_id,
        apply_url=job.apply_url,
        ats=adapter.name,
        status="starting" if job.apply_url else "failed",
        error="" if job.apply_url else "This job does not have an apply URL.",
        metadata={
            "agent_engine": "jobgraph_playwright",
            "headless": headless,
            "submit_policy": "never_submit_without_user_approval",
            "profile_fields_available": sorted(key for key, value in profile.model_dump().items() if value),
        },
        finished_at=None if job.apply_url else datetime.utcnow(),
    )
    saved = store.save_apply_agent_run(run)
    if saved.id is not None:
        _log_step(saved.id, 1, "Opening job page", "pending", "Apply run created; waiting for browser automation.")
        saved = store.get_apply_agent_run(saved.id)
    return saved


def _hydrate_autofill_from_candidate(profile, candidate: CandidateProfile):
    changed = False
    updates = {
        "legal_name": candidate.name,
        "email": candidate.email,
        "phone": candidate.phone,
        "linkedin": candidate.links.get("linkedin", ""),
        "github": candidate.links.get("github", ""),
        "portfolio": candidate.links.get("portfolio", ""),
    }
    for key, value in updates.items():
        if value and not getattr(profile, key, ""):
            setattr(profile, key, value)
            changed = True
    if candidate.education and not profile.education:
        first = candidate.education[0] or {}
        profile.education = {
            key: str(first.get(source) or "").strip()
            for key, source in {"school": "school", "degree": "degree", "major": "field"}.items()
            if str(first.get(source) or "").strip()
        }
        changed = True
    return store.save_autofill(profile) if changed else profile


def execute_apply_run(run_id: int) -> ApplyAgentRun:
    result: Optional[ApplyAgentRun] = None
    error: Optional[Exception] = None

    def worker() -> None:
        nonlocal result, error
        try:
            result = _execute_apply_run_sync(run_id)
        except Exception as exc:
            error = exc

    # Playwright operations can hang on Windows (browser launch / page.goto).
    # We run them in a worker thread and enforce a hard timeout so the UI
    # doesn't stay stuck on "navigating" forever.
    thread = threading.Thread(target=worker, name=f"apply-agent-run-{run_id}", daemon=True)
    thread.start()
    timeout_s = 120
    thread.join(timeout=timeout_s)

    if thread.is_alive():
        run = store.get_apply_agent_run(run_id)
        if run.id is not None:
            _log_step(
                run.id,
                7,
                "Completed / Needs manual action",
                "failed",
                f"Apply agent timed out after {timeout_s}s while launching/navigating. "
                "This is usually Playwright browser startup getting blocked. "
                "Try installing browsers with `python -m playwright install chromium` and re-run.",
            )
        return _finish(
            run,
            "failed",
            error=f"Timed out after {timeout_s}s while launching/navigating the apply page.",
        )

    if result:
        return result
    run = store.get_apply_agent_run(run_id)
    return _finish(run, "failed", error=str(error or "Apply agent worker failed."))


def _execute_apply_run_sync(run_id: int) -> ApplyAgentRun:
    run = store.get_apply_agent_run(run_id)
    if not run.apply_url:
        if run.id is not None:
            _log_step(run.id, 1, "Opening job page", "failed", "This job does not have an apply URL.")
        return _finish(run, "failed", error="This job does not have an apply URL.")

    profile = store.get_autofill(run.candidate_id)
    candidate = store.get_candidate(run.candidate_id)
    job = store.get_job(run.job_id)
    resume_path = _best_resume_path(run.candidate_id, profile)
    if resume_path and resume_path != (getattr(profile, "candidate_resume_path", "") or "").strip():
        profile.candidate_resume_path = resume_path
        profile = store.save_autofill(profile)
    run = _update(run, status="navigating")
    _log_step(run_id, 1, "Opening job page", "running", run.apply_url)

    # New hybrid architecture: run the TypeScript Playwright-first agent via node.
    resume_path = (getattr(profile, "candidate_resume_path", None) or "").strip()
    resume_on_disk = bool(resume_path) and Path(resume_path).is_file()
    payload = {
        "applyUrl": run.apply_url,
        "options": {
            "resumePdfPath": resume_path if resume_on_disk else "",
            "candidate": _hybrid_candidate_for_agent(profile, candidate),
            "job": job.model_dump(),
            "reviewMode": True,
            "autoFillMinConfidence": 0.75,
            # Upload resume via Playwright when a PDF path exists; otherwise CLI expects skipResumeUpload.
            "skipResumeUpload": not resume_on_disk,
            "maxSmartLlmFields": 18,
        },
    }
    ok, data, stderr = run_node_hybrid_apply(payload, timeout_s=420)
    if not ok:
        details = str(data.get("error") or "Hybrid agent failed.")
        if stderr:
            details = f"{details}\n{stderr[:1500]}"
        _log_step(run_id, 7, "Completed / Needs manual action", "failed", details)
        return _finish(run, "failed", error=details)

    summary = (data.get("summary") or {}) if isinstance(data, dict) else {}
    filled = summary.get("filledFields") or []
    needs_review = summary.get("needsReview") or []
    resume_upload = summary.get("resumeUpload") or {}

    _log_step(run_id, 1, "Opening job page", "completed", str(summary.get("resumeUpload", {}).get("detail") or run.apply_url))
    _log_step(run_id, 3, "Filling personal details", "completed" if filled else "needs_manual_action", f"Filled {len(filled)} fields.", {"filled_fields": filled})
    resume_skipped = bool(resume_upload.get("skipped"))
    _log_step(
        run_id,
        4,
        "Uploading resume",
        "completed" if resume_upload.get("ok") or resume_skipped else "needs_manual_action",
        str(resume_upload.get("detail") or ""),
        {
            "file_fields": []
            if resume_upload.get("ok") or resume_skipped
            else [{"label": "Resume", "reason": str(resume_upload.get("detail") or "")}]
        },
    )
    _log_step(
        run_id,
        5,
        "Handling custom questions",
        "needs_manual_action" if needs_review else "completed",
        f"{len(needs_review)} fields need review or user input.",
        {"blockers": needs_review},
    )
    _log_step(run_id, 6, "Waiting for user review", "needs_review", "Review before submit. The agent will not submit automatically.")

    # Map summary into legacy ApplyAgentRun fields.
    mapped_filled = [{"label": item.get("label", ""), "source": "hybrid_agent", "confidence": item.get("confidence", 0.8)} for item in filled]
    mapped_blockers = [
        {
            "label": (item.get("field") or {}).get("labelsText") or (item.get("field") or {}).get("placeholder") or "Field",
            "reason": item.get("reason") or "Needs review",
        }
        for item in needs_review
        if isinstance(item, dict)
    ]
    file_fields = (
        []
        if resume_upload.get("ok") or resume_skipped
        else [{"label": "Resume", "reason": str(resume_upload.get("detail") or "Upload not confirmed")}]
    )
    agent_status = (
        "Opened application - Filled visible fields"
        + (" - Resume upload skipped (add your file in the browser)" if resume_skipped else "")
        + (" - Uploaded resume" if resume_upload.get("ok") and not resume_skipped else "")
        + " - Needs your review (will not submit)"
    )
    return _update(
        run,
        status="blocked" if mapped_blockers else "needs_review",
        ats=str(summary.get("resumeUpload", {}).get("ok") and run.ats or run.ats),
        current_url=str(summary.get("resumeUpload", {}).get("pathUsed") or run.apply_url),
        filled_fields=mapped_filled,
        blockers=mapped_blockers,
        file_fields=file_fields,
        page_summary=str(summary.get("resumeUpload", {}).get("detail") or ""),
        metadata={
            **run.metadata,
            "agent_engine": "jobgraph_playwright_hybrid_ts",
            "review_required": True,
            "submit_policy": "never_submit_without_user_approval",
            "agent_status": agent_status,
            "hybrid_summary": summary,
        },
        finished_at=None,
    )


def _configure_windows_playwright_loop() -> None:
    if sys.platform.startswith("win") and hasattr(asyncio, "WindowsProactorEventLoopPolicy"):
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


def _wait_for_application_form(page: Any, extra_selectors: Sequence[str] = ()) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
        pass
    try:
        page.wait_for_selector(FORM_SELECTOR, timeout=20000)
        return
    except Exception:
        pass

    # Many ATS flows require multiple clicks before the real form shows up.
    # Keep clicking safe entry points (Apply/Continue/Next) a few times.
    for _ in range(4):
        _click_apply_entrypoint(page, extra_selectors)
        try:
            page.wait_for_load_state("domcontentloaded", timeout=15000)
        except Exception:
            pass
        try:
            page.wait_for_selector(FORM_SELECTOR, timeout=8000)
            return
        except Exception:
            pass
        if not _click_next_or_continue(page):
            continue
        try:
            page.wait_for_load_state("domcontentloaded", timeout=12000)
        except Exception:
            pass
        try:
            page.wait_for_selector(FORM_SELECTOR, timeout=8000)
            return
        except Exception:
            pass


def _click_apply_entrypoint(page: Any, extra_selectors: Sequence[str] = ()) -> None:
    candidates = list(extra_selectors) + [
        "a:has-text('Apply')",
        "button:has-text('Apply')",
        "a:has-text('Apply Now')",
        "button:has-text('Apply Now')",
        "a:has-text('Start application')",
        "button:has-text('Start application')",
        "a:has-text('Continue')",
        "button:has-text('Continue')",
        "a:has-text('Next')",
        "button:has-text('Next')",
        "button:has-text('Continue to Application')",
        "a:has-text('Continue to Application')",
        "button:has-text('Proceed')",
        "a:has-text('Proceed')",
    ]
    for selector in candidates:
        try:
            locator = page.locator(selector).first
            if locator.count() and locator.is_visible():
                locator.click(timeout=3000)
                return
        except Exception:
            continue


def _forbidden_submit_visible(page: Any) -> bool:
    forbidden = re.compile(r"(submit\s*application|send\s*application|finish\s*application|^\s*submit\s*$)", re.I)
    selectors = ("button", "input[type='submit']", "[role='button']")
    for sel in selectors:
        try:
            for element in page.query_selector_all(sel):
                if not element.is_visible():
                    continue
                text = (element.inner_text() or element.get_attribute("value") or "").strip()
                if text and forbidden.search(text):
                    return True
        except Exception:
            continue
    return False


def _click_next_or_continue(page: Any) -> bool:
    """Clicks safe navigation controls; never clicks final submit/send."""
    avoid = re.compile(r"(submit\s*application|send\s*application|^\s*submit\s*$|finish\s*application)", re.I)
    allow = re.compile(
        r"(^next$|^continue|save\s+and\s+continue|start\s+application|apply\s+for\s+this\s+job|apply\s+now|^apply$|autofill)",
        re.I,
    )
    selectors = ("button", "a", "input[type='submit']")
    for sel in selectors:
        try:
            for element in page.query_selector_all(sel):
                if not element.is_visible():
                    continue
                text = (element.inner_text() or element.get_attribute("value") or "").strip()
                if not text or len(text) > 120:
                    continue
                if avoid.search(text):
                    continue
                if allow.search(text):
                    element.click(timeout=4000)
                    return True
        except Exception:
            continue
    return False


def _fill_multistep_pages(page: Any, profile, candidate: CandidateProfile, job: Job, apply_url: str, resume_path: str) -> PageFillResult:
    merged = PageFillResult(current_url=page.url, ats=_adapter_for_job(job).name, page_summary=_page_summary(page))
    any_pass = False
    for _ in range(5):
        part = fill_current_page(page, profile, candidate, job, apply_url, resume_path, allow_empty_report=False)
        merged.filled_fields.extend(part.filled_fields)
        merged.blockers.extend(part.blockers)
        merged.file_fields.extend(part.file_fields)
        merged.ats = part.ats
        if part.filled_fields or part.file_fields or part.blockers:
            any_pass = True
        if _forbidden_submit_visible(page):
            break
        if not _click_next_or_continue(page):
            break
        page.wait_for_timeout(900)
        try:
            page.wait_for_load_state("domcontentloaded", timeout=12000)
        except Exception:
            pass
        try:
            page.wait_for_selector(FORM_SELECTOR, timeout=8000)
        except Exception:
            pass
    merged.current_url = page.url
    merged.page_summary = _page_summary(page)
    if not any_pass and not merged.filled_fields and not merged.file_fields and not merged.blockers:
        merged.blockers.append(
            {
                "label": "Application form",
                "reason": "No fillable form fields were detected after navigating the ATS flow.",
            }
        )
    return merged


def _honest_agent_status(result: PageFillResult) -> str:
    parts: List[str] = ["Opened application"]
    if result.filled_fields:
        parts.append("Filled visible fields")
    if any((f.get("source") == "candidate_resume_path") for f in result.filled_fields):
        parts.append("Uploaded resume")
    if result.file_fields:
        parts.append("Some uploads may still need manual selection")
    if result.blockers:
        parts.append("Manual step may be required")
    parts.append("Needs your review (will not submit)")
    return " - ".join(parts)


def fill_current_page(
    page: Any,
    profile,
    candidate: CandidateProfile,
    job: Job,
    apply_url: str = "",
    resume_path: str = "",
    allow_empty_report: bool = True,
) -> PageFillResult:
    adapter = _adapter_for_job(job)
    result = PageFillResult(current_url=page.url, ats=adapter.name, page_summary=_page_summary(page))
    filled_handles: List[Any] = []

    def iter_contexts() -> List[Any]:
        contexts: List[Any] = [page]
        try:
            for frame in list(getattr(page, "frames", [])) or []:
                if frame is page:
                    continue
                contexts.append(frame)
        except Exception:
            pass
        return contexts

    def _pick_combobox_option(ctx: Any, wanted: str) -> bool:
        """Handle modern ATS combobox/listbox UIs (not <select>)."""
        wanted = str(wanted or "").strip()
        if not wanted:
            return False
        # Try clicking an option in an open listbox/menu.
        option_selectors = [
            f"[role='option']:has-text('{wanted}')",
            f"[role='menuitem']:has-text('{wanted}')",
            f"li:has-text('{wanted}')",
            f"div:has-text('{wanted}')",
        ]
        for sel in option_selectors:
            try:
                loc = ctx.locator(sel).first
                if loc.count() and loc.is_visible():
                    loc.click(timeout=2500)
                    return True
            except Exception:
                continue
        # Fallback: pressing Enter often selects the highlighted option.
        try:
            ctx.keyboard.press("Enter")
            return True
        except Exception:
            return False

    for ctx in iter_contexts():
        try:
            elements = ctx.query_selector_all("input, textarea, select, [contenteditable='true'], [role='combobox']")
        except Exception:
            continue
        for element in elements:
            try:
                field_type = (element.get_attribute("type") or "").lower()
                tag_name = element.evaluate("(el) => el.tagName.toLowerCase()")
                role = (element.get_attribute("role") or "").lower()
                has_listbox = (element.get_attribute("aria-haspopup") or "").lower() == "listbox"
                label = _field_label(element)
                # File inputs are often hidden behind a custom upload button.
                # We allow them even if not visible/attached in the normal way.
                if field_type != "file" and _should_skip(element, field_type):
                    continue
            except Exception:
                continue
            if field_type == "file":
                path = (resume_path or "").strip()
                if path and Path(path).is_file():
                    try:
                        # Use locator.set_input_files(force=True) to handle hidden inputs.
                        try:
                            ctx.locator("input[type='file']").first.set_input_files(path, force=True, timeout=12000)
                        except Exception:
                            element.set_input_files(path)
                        filled_handles.append(element)
                        result.filled_fields.append(_filled(label or "Resume", "candidate_resume_path", 0.92))
                    except Exception as exc:
                        result.blockers.append({"label": label or "Resume upload", "reason": f"Could not attach resume file: {exc}"})
                else:
                    result.file_fields.append(
                        {
                            "label": label or "File upload",
                        "reason": f"Resume file not found on disk (path: {path or '—'}). Upload your resume first from /upload.",
                        }
                    )
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
                elif role == "combobox" or has_listbox:
                    try:
                        element.click(timeout=2500)
                    except Exception:
                        pass
                    # Many comboboxes are backed by an <input> inside; typing helps filter options.
                    try:
                        element.fill(str(value))
                    except Exception:
                        try:
                            ctx.keyboard.type(str(value), delay=15)
                        except Exception:
                            pass
                    if _pick_combobox_option(ctx, str(value)):
                        filled_handles.append(element)
                        result.filled_fields.append(_filled(label, source, min(0.78, confidence)))
                elif field_type in {"checkbox", "radio"}:
                    if boolean_choice(value, label):
                        element.check()
                        filled_handles.append(element)
                        result.filled_fields.append(_filled(label, source, confidence))
                else:
                    # fill() works for inputs, textareas, and contenteditable fields.
                    element.fill(value)
                    filled_handles.append(element)
                    result.filled_fields.append(_filled(label, source, confidence))
            except Exception as exc:
                result.blockers.append({"label": label or "Unknown field", "reason": f"Could not fill field: {exc}"})

    if allow_empty_report and not result.filled_fields and not result.file_fields and not result.blockers:
        result.blockers.append(
            {
                "label": "Application form",
                "reason": "No fillable form fields were detected after waiting for the ATS page to load.",
            }
        )

    filled_ids = {id(handle) for handle in filled_handles}
    for ctx in iter_contexts():
        try:
            required_elements = ctx.query_selector_all(
                "input[required], textarea[required], select[required], [aria-required='true'], [contenteditable='true'][aria-required='true']"
            )
        except Exception:
            continue
        for element in required_elements:
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
    _log_step(run_id, 6, "Waiting for user review", "acknowledged", "User requested continue/review state. Submit remains manual.")
    metadata = {**run.metadata, "continue_requested": True, "submit_policy": "never_submit_without_user_approval"}
    return _update(run, metadata=metadata, status="needs_review" if run.status in {"blocked", "filling"} else run.status)


def cancel_apply_run(run_id: int) -> ApplyAgentRun:
    run = store.get_apply_agent_run(run_id)
    _log_step(run_id, 7, "Completed / Needs manual action", "cancelled", "User cancelled the apply agent run.")
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
    if any(term in normalized for term in ("skill", "technology", "tools", "languages")) and candidate.skills:
        return ", ".join(candidate.skills[:14]), "candidate.skills"
    if any(term in normalized for term in ("github", "git hub")) and candidate.links.get("github"):
        return candidate.links["github"], "candidate.links.github"
    if any(term in normalized for term in ("linkedin", "linked in")) and candidate.links.get("linkedin"):
        return candidate.links["linkedin"], "candidate.links.linkedin"
    if any(term in normalized for term in ("portfolio", "website", "personal site")):
        portfolio = candidate.links.get("portfolio") or candidate.links.get("website") or candidate.links.get("github", "")
        if portfolio:
            return portfolio, "candidate.links.portfolio"
    if any(term in normalized for term in ("school", "university", "college")):
        value = _education_value(candidate, "school")
        if value:
            return value, "candidate.education.school"
    if any(term in normalized for term in ("degree", "major", "field of study", "discipline")):
        value = _education_value(candidate, "degree") or _education_value(candidate, "field")
        if value:
            return value, "candidate.education.degree"
    if any(term in normalized for term in ("company", "employer")):
        value = _experience_value(candidate, "company")
        if value:
            return value, "candidate.experience.company"
    if any(term in normalized for term in ("current title", "job title", "role title", "position")):
        value = _experience_value(candidate, "title") or (candidate.target_roles[0] if candidate.target_roles else "")
        if value:
            return value, "candidate.experience.title"
    if any(term in normalized for term in ("years of experience", "experience years", "total experience")) and candidate.experience_years:
        return str(candidate.experience_years).rstrip("0").rstrip("."), "candidate.experience_years"
    if any(term in normalized for term in ("project", "portfolio project")) and tag_name != "textarea" and candidate.projects:
        return _clean_project(candidate.projects[0]), "candidate.projects"
    if tag_name == "textarea":
        answer = _resume_based_text_answer(candidate, job, normalized)
        if answer:
            return answer, "resume_draft.required_text_answer"
    if tag_name == "input" and ("country" in normalized or "city" in normalized or "location" in normalized):
        # Avoid guessing "Remote" into address/location fields.
        if candidate.location_preferences:
            prefs = [str(p).strip() for p in candidate.location_preferences if str(p).strip()]
            if not prefs:
                return "", ""
            if "remote" in normalized:
                # If the question is explicitly about remote work, allow Remote.
                return prefs[0], "candidate.location_preferences"
            non_remote = next((p for p in prefs if p.lower() not in {"remote", "remote-only", "remote only"}), "")
            if non_remote:
                return non_remote, "candidate.location_preferences"
            # If we only have Remote, do not fill a location guess.
            return "", ""
    return "", ""


def _resume_based_text_answer(candidate: CandidateProfile, job: Job, label: str) -> str:
    skills = ", ".join(candidate.skills[:6])
    projects = [_clean_project(project) for project in candidate.projects[:3] if _clean_project(project)]
    summary = candidate.summary or (projects[0] if projects else "")
    role = job.title or "this role"
    company = job.company or "your team"

    if not any(term in label for term in ("describe", "why", "project", "role", "experience", "work", "cover", "tell us", "anything else")):
        return ""

    parts = []
    if summary:
        parts.append(summary)
    if projects:
        parts.append(f"Relevant resume projects include {projects[0]}.")
        if len(projects) > 1 and any(term in label for term in ("project", "experience", "work")):
            parts.append(f"Another relevant project is {projects[1]}.")
    if skills:
        parts.append(f"I would connect that experience to {role} at {company} through my background with {skills}.")
    if candidate.experience:
        latest = candidate.experience[0]
        title = latest.get("title") or latest.get("role") or ""
        org = latest.get("company") or ""
        if title or org:
            parts.append(f"My resume also shows experience as {title}{f' at {org}' if org else ''}.")
    if not parts:
        return ""
    return " ".join(parts[:3])


def _education_value(candidate: CandidateProfile, key: str) -> str:
    if not candidate.education:
        return ""
    first = candidate.education[0] or {}
    return str(first.get(key) or "").strip()


def _experience_value(candidate: CandidateProfile, key: str) -> str:
    if not candidate.experience:
        return ""
    first = candidate.experience[0] or {}
    return str(first.get(key) or "").strip()


def _clean_project(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "")).strip(" -•")
    cleaned = re.sub(r"^(project|projects)\s*[:|-]\s*", "", cleaned, flags=re.I)
    return cleaned[:220].rstrip(" ,;")


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


def _adapter_for_job(job: Job):
    source = (job.source or "").lower().strip()
    if source in {"greenhouse", "lever", "workday", "ashby"}:
        return adapter_for_url(source)
    return adapter_for_url(job.apply_url)


def _update(run: ApplyAgentRun, **changes: Any) -> ApplyAgentRun:
    payload = run.model_dump()
    payload.update(changes)
    payload["updated_at"] = datetime.utcnow()
    return store.save_apply_agent_run(ApplyAgentRun(**payload))


def _finish(run: ApplyAgentRun, status: str, error: str = "") -> ApplyAgentRun:
    if run.id is not None and status in {"cancelled", "failed"}:
        _log_step(run.id, 7, "Completed / Needs manual action", status, error or status)
    return _update(run, status=status, error=error, finished_at=datetime.utcnow())


def _log_step(run_id: int, order: int, label: str, status: str, details: str = "", metadata: Optional[Dict[str, Any]] = None) -> None:
    step = store.save_agent_step(
        AgentStep(
            run_id=run_id,
            step_order=order,
            label=label,
            status=status,
            details=details,
            metadata=metadata or {},
        )
    )
    try:
        run = store.get_apply_agent_run(run_id)
        steps = [item.model_dump() for item in store.list_agent_steps(run_id)]
        payload = {
            **run.metadata,
            "steps": steps,
            "agent_status": f"{label}: {status}",
            "last_step_id": step.id,
            "submit_policy": "never_submit_without_user_approval",
        }
        store.save_apply_agent_run(run.model_copy(update={"metadata": payload, "updated_at": datetime.utcnow()}))
    except Exception:
        pass


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
