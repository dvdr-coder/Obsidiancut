"""Command-line interface for Obsidian Cut AutoEngine."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .hjson_parser import HjsonDecodeError, load_hjson
from .wrapper import ObsidianAutoEngine


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m autoengine",
        description="Obsidian Cut AutoEngine — Automate multiple video renders from HJSON manifests.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run", help="Render all videos defined in an .hjson manifest")
    run_p.add_argument("manifest", help="Path to .hjson batch manifest")
    run_p.add_argument(
        "--only",
        nargs="+",
        help="Render only specific video ID(s) from the manifest",
    )
    run_p.add_argument(
        "--workers",
        type=int,
        default=None,
        help="Max concurrent FFmpeg render workers (default: from manifest or 2)",
    )
    run_p.add_argument(
        "--server",
        default=None,
        help="Optional Obsidian Cut server URL (e.g. http://127.0.0.1:3000) instead of direct Python mode",
    )
    run_p.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate HJSON, expand media paths, and inspect computed timelines without rendering",
    )
    run_p.add_argument(
        "--report",
        default=None,
        help="Optional path to write JSON batch summary report",
    )
    run_p.add_argument(
        "--keep-temp",
        action="store_true",
        help="Keep intermediate probed media/proxy workspace files after batch completes",
    )

    val_p = sub.add_parser("validate", help="Parse an .hjson file and print normalized JSON")
    val_p.add_argument("manifest", help="Path to .hjson manifest to validate")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "validate":
        try:
            data = load_hjson(Path(args.manifest))
            print(json.dumps(data, indent=2))
            return 0
        except (FileNotFoundError, HjsonDecodeError) as exc:
            print(f"Validation failed: {exc}", file=sys.stderr)
            return 1

    if args.command == "run":
        engine = ObsidianAutoEngine(
            server_url=args.server,
            keep_temp=args.keep_temp,
        )
        try:
            report = engine.run_manifest(
                args.manifest,
                only_ids=set(args.only) if args.only else None,
                workers=args.workers,
                dry_run=args.dry_run,
                report_path=args.report,
            )
        except Exception as exc:
            print(f"AutoEngine error: {exc}", file=sys.stderr)
            return 1

        print(
            f"\n[Obsidian Cut AutoEngine] Batch complete: "
            f"{report.succeeded}/{report.total_videos} succeeded, "
            f"{report.failed} failed ({report.total_elapsed_ms / 1000:.2f}s total)."
        )
        return 0 if report.failed == 0 else 2

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
