# Obsidian Cut — `autoengine` (HJSON Batch Video Automation)

A zero-dependency Python wrapper around **Obsidian Cut's** Python + FFmpeg media engine for automating **multiple video renders** from declarative `.hjson` (Human JSON) manifests.

Works on **Windows (PowerShell / cmd)**, **WSL**, and **Linux** with Python `3.9+` and `ffmpeg`/`ffprobe` on `PATH`—no `pip install` packages required.

---

## Folder Structure

```text
autoengine/
├── __init__.py               # Public Python API exports
├── __main__.py               # Enables `python -m autoengine`
├── hjson_parser.py           # Zero-dependency HJSON parser (#, //, /* */, unquoted keys, multiline)
├── wrapper.py                # ObsidianAutoEngine batch orchestrator (auto & timeline modes)
├── cli.py                    # CLI runner (`run`, `validate`, `--dry-run`, `--only`, `--workers`)
├── README.md                 # Documentation & schema reference
└── examples/
    ├── batch_videos.hjson    # Example automating 3 distinct videos from one HJSON file
    └── run_example.py        # Programmatic Python wrapper usage example
```

---

## Quick Start (CLI)

From the repository root:

1. **Validate the example `.hjson` manifest**:
   ```bash
   python -m autoengine validate autoengine/examples/batch_videos.hjson
   ```

2. **Preview timelines with `--dry-run`** (checks files & durations without encoding):
   ```bash
   python -m autoengine run autoengine/examples/batch_videos.hjson --dry-run
   ```

3. **Render all videos in the batch**:
   ```bash
   python -m autoengine run autoengine/examples/batch_videos.hjson --report autoengine/output/batch_report.json
   ```
   Rendered MP4s will be written to `autoengine/output/`:
   - `alpine_landscape_hd.mp4` (1280×720, 30 fps, beat-synced + Teal & Orange grade + corner watermark)
   - `vertical_social_reel_9x16.mp4` (720×1280, `23.976` fps, glob-matched photos + Kodak Warm grade)
   - `noir_multitrack_cut.mp4` (1280×720, 24 fps, explicit multi-track Mono Noir timeline)

4. **Render only a subset of jobs or submit to a running server**:
   ```bash
   python -m autoengine run autoengine/examples/batch_videos.hjson --only alpine_landscape_hd
   python -m autoengine run autoengine/examples/batch_videos.hjson --server http://127.0.0.1:3000
   ```

> **Windows Tip**: Replace `python` with `py -3` if your Windows Python launcher uses `py`.

---

## Programmatic Python Usage

```python
from autoengine import ObsidianAutoEngine, run_batch_from_hjson

# One-shot helper
report = run_batch_from_hjson(
    "autoengine/examples/batch_videos.hjson",
    workers=2,
    report_path="autoengine/output/batch_report.json",
)
print(f"Done: {report.succeeded}/{report.total_videos} succeeded")

# Or reusable instance (caches probed media & beat analysis across manifests)
engine = ObsidianAutoEngine()
report = engine.run_manifest("autoengine/examples/batch_videos.hjson", dry_run=False)
```

Or run the bundled example script directly:
```bash
python autoengine/examples/run_example.py
```

---

## HJSON Manifest Schema

- **`defaults`**: Shared properties merged into every entry in `videos` (`outputDir`, `resolution`, `fps`, `format`, `speedProfile`, `transitionStyle`, `transitionDuration`, `enableMotion`, `beatStride`, `colorGrade`).
- **`workers`**: Optional concurrent FFmpeg worker count (`1`–`4`, default `2`).
- **`videos`** (or **`jobs`**): Array of video definitions. Each entry supports:
  - **`mode: auto`** — Provide `slides` (file paths, glob patterns like `photos/*.jpg`, or objects with per-slide `duration`, `motion`, `transition`, `effects`), optional `audio` (song path or `"sample:120bpm"`), and optional `overlay` watermark.
  - **`mode: timeline`** — Provide explicit `tracks` (`video` / `audio`) and `clips` with `startTime`, `duration`, `trimStart`, `speed`, `reverse`, `scale`, `x`, `y`, `rotation`, `opacity`, `pan`, `volume`, and `effects` (`brightness`, `contrast`, `gamma`, `hue`, `saturation`, `greyscale`, `chromaKeyEnabled`, `chromaKeyColor`).
