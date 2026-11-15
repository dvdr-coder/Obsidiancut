#!/usr/bin/env python3
"""
Programmatic example of using Obsidian Cut AutoEngine from Python
to automate multiple video renders from an `.hjson` batch manifest.

Run from the repository root:
    python autoengine/examples/run_example.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from autoengine import ObsidianAutoEngine  # noqa: E402


def main() -> int:
    manifest_path = REPO_ROOT / "autoengine" / "examples" / "batch_videos.hjson"
    report_path = REPO_ROOT / "autoengine" / "output" / "batch_report.json"

    engine = ObsidianAutoEngine()

    print("=== 1) Dry-run validation & timeline preview ===")
    dry_report = engine.run_manifest(manifest_path, dry_run=True)
    print(f"Validated {dry_report.total_videos} video jobs cleanly.\n")

    print("=== 2) Rendering all HJSON video jobs ===")
    report = engine.run_manifest(manifest_path, workers=2, report_path=report_path)
    print("\n=== 3) Summary Report ===")
    print(json.dumps(report.to_dict(), indent=2))
    return 0 if report.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
