from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Dict, Tuple


def _repo_root() -> Path:
    # backend/app/apply_agent/node_runner.py -> repo root
    return Path(__file__).resolve().parents[3]


def _node_cli_path() -> Path:
    return _repo_root() / "agents" / "dist" / "cli" / "runApply.js"


def run_node_hybrid_apply(payload: Dict[str, Any], timeout_s: int = 180) -> Tuple[bool, Dict[str, Any], str]:
    """
    Runs the TypeScript hybrid agent (compiled JS) via node.
    Returns: (ok, json_payload, stderr_text)
    """
    cli = _node_cli_path()
    if not cli.is_file():
        return False, {"ok": False, "error": f"Hybrid agent CLI not built: {cli}"}, ""

    proc = subprocess.run(
        ["node", str(cli)],
        input=json.dumps(payload).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(_repo_root()),
        timeout=timeout_s,
    )
    stderr = proc.stderr.decode("utf-8", errors="ignore")
    out_text = proc.stdout.decode("utf-8", errors="ignore").strip()
    try:
        data = json.loads(out_text) if out_text else {"ok": False, "error": "empty stdout from hybrid agent"}
    except Exception:
        data = {"ok": False, "error": "invalid JSON from hybrid agent", "raw": out_text[:2000]}
    ok = bool(data.get("ok")) and proc.returncode == 0
    return ok, data, stderr

