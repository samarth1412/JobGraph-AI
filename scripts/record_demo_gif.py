#!/usr/bin/env python3
"""
Capture a short README demo GIF (upload → workspace → job detail).

Requires:
  - Backend: uvicorn on port 8022 (default NEXT_PUBLIC_API_URL)
  - Frontend: next dev on port 3020
  - pip: playwright pillow  (playwright already in backend/requirements.txt)

Usage (from repo root):
  python scripts/record_demo_gif.py
  python scripts/record_demo_gif.py --install-browser
  python scripts/record_demo_gif.py --base-url http://127.0.0.1:3020
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "docs" / "images" / "demo.gif"


def _need_pillow():
    try:
        from PIL import Image  # noqa: F401

        return Image
    except ImportError:
        print("Install Pillow: pip install pillow", file=sys.stderr)
        sys.exit(1)


def _frames_from_playwright(base_url: str, Image):
    from playwright.sync_api import sync_playwright

    frames: list = []
    viewport = {"width": 1280, "height": 780}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport=viewport)
        page = context.new_page()

        def shot():
            png = page.screenshot(full_page=False, type="png")
            frames.append(Image.open(io.BytesIO(png)).convert("RGB"))

        # 1) Upload / intake hero
        page.goto(f"{base_url.rstrip('/')}/upload", wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_timeout(1200)
        shot()

        # 2) Pretend resume already uploaded — workspace loads ranked board
        page.evaluate(
            """() => {
              localStorage.setItem('jobgraph_resume_uploaded', 'true');
            }"""
        )
        page.goto(f"{base_url.rstrip('/')}/workspace", wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_timeout(3500)
        shot()

        # 3) Open first job row (detail panel) when the ranked list rendered
        try:
            loc = page.locator('div.divide-y > div[role="button"]')
            if loc.count() > 0:
                loc.first.click(timeout=6000)
                page.wait_for_timeout(2000)
        except Exception:
            pass
        shot()

        browser.close()

    return frames


def main() -> None:
    parser = argparse.ArgumentParser(description="Record docs/images/demo.gif from running JobGraph web UI.")
    parser.add_argument("--base-url", default="http://127.0.0.1:3020", help="Next.js dev server URL")
    parser.add_argument("--install-browser", action="store_true", help="Run playwright install chromium first")
    parser.add_argument("--out", type=Path, default=OUT_PATH, help="Output GIF path")
    args = parser.parse_args()

    Image = _need_pillow()

    if args.install_browser:
        import subprocess

        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=False)

    args.out.parent.mkdir(parents=True, exist_ok=True)

    try:
        frames = _frames_from_playwright(args.base_url, Image)
    except Exception as e:
        print(
            f"Capture failed: {e}\n"
            "Start backend (port 8022) and frontend (port 3020), then retry.\n"
            "First time: python scripts/record_demo_gif.py --install-browser",
            file=sys.stderr,
        )
        sys.exit(1)

    if not frames:
        print("No frames captured.", file=sys.stderr)
        sys.exit(1)

    # Normalize width for GitHub README readability
    target_w = 1100
    resized = []
    for im in frames:
        w, h = im.size
        if w > target_w:
            nh = int(h * (target_w / w))
            resized.append(im.resize((target_w, nh), Image.Resampling.LANCZOS))
        else:
            resized.append(im)

    durations_ms = [2200, 3200, 2800][: len(resized)]
    while len(durations_ms) < len(resized):
        durations_ms.append(2500)

    resized[0].save(
        args.out,
        save_all=True,
        append_images=resized[1:] if len(resized) > 1 else [],
        duration=durations_ms[: len(resized)],
        loop=0,
        optimize=False,
    )
    print(f"Wrote {args.out} ({len(resized)} frames)")


if __name__ == "__main__":
    main()
