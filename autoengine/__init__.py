"""
Obsidian Cut AutoEngine — HJSON Batch Video Automation Wrapper.

Provides a zero-dependency HJSON parser and high-level Python wrapper around
Obsidian Cut's FFmpeg media engine to automate multi-video generation from
declarative `.hjson` manifests.
"""

from .hjson_parser import HjsonDecodeError, load_hjson, parse_hjson
from .wrapper import (
    BatchJobResult,
    BatchRenderReport,
    ObsidianAutoEngine,
    run_batch_from_hjson,
)

__all__ = [
    "HjsonDecodeError",
    "parse_hjson",
    "load_hjson",
    "BatchJobResult",
    "BatchRenderReport",
    "ObsidianAutoEngine",
    "run_batch_from_hjson",
]
