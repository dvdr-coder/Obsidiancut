"""
Obsidian Cut AutoEngine Python Wrapper.

Automates rendering multiple videos from `.hjson` batch manifests using
Obsidian Cut's Python + FFmpeg multi-track engine (directly in Python or via
a running Obsidian Cut HTTP server). Compatible with Windows, WSL, and Linux.
"""

from __future__ import annotations

import copy
import glob
import json
import mimetypes
import os
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

from .hjson_parser import load_hjson

REPO_ROOT = Path(__file__).resolve().parent.parent

TRANSITION_POOLS: dict[str, list[str]] = {
    "dynamic": ["fade", "smoothleft", "dissolve", "circleopen", "wipeleft", "radial", "smoothright"],
    "crossfade": ["fade", "dissolve", "fadeblack"],
    "directional": ["slideleft", "slideright", "wipeleft", "wiperight", "smoothleft", "smoothright"],
    "geometric": ["circleopen", "circleclose", "radial", "diagtl", "squeezeh"],
    "cut": ["cut"],
}

MOTIONS = ["zoomIn", "panRight", "zoomOut", "panLeft"]

DEFAULT_CLIP_EFFECTS: dict[str, Any] = {
    "brightness": 0.0,
    "contrast": 1.0,
    "gamma": 1.0,
    "hue": 0.0,
    "saturation": 1.0,
    "greyscale": False,
    "chromaKeyEnabled": False,
    "chromaKeyColor": "#00ff00",
    "chromaKeySimilarity": 0.18,
    "chromaKeyBlend": 0.08,
}


@dataclass
class BatchJobResult:
    id: str
    status: str  # completed | failed | dry_run
    output_path: str
    duration_sec: float = 0.0
    elapsed_ms: int = 0
    size_bytes: int = 0
    clip_count: int = 0
    resolution: str = "1920x1080"
    fps: float = 30.0
    format: str = "mp4"
    error: str | None = None


@dataclass
class BatchRenderReport:
    manifest_path: str
    total_videos: int
    succeeded: int
    failed: int
    total_elapsed_ms: int
    results: list[BatchJobResult] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "manifestPath": self.manifest_path,
            "totalVideos": self.total_videos,
            "succeeded": self.succeeded,
            "failed": self.failed,
            "totalElapsedMs": self.total_elapsed_ms,
            "results": [asdict(r) for r in self.results],
        }


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _resolve_path(raw_path: str, search_roots: list[Path]) -> Path:
    p = Path(raw_path)
    if p.is_absolute():
        if p.exists():
            return p.resolve()
        raise FileNotFoundError(f"Media file not found: {raw_path}")
    for root in search_roots:
        cand = (root / p).resolve()
        if cand.exists():
            return cand
    raise FileNotFoundError(f"Media file not found: {raw_path} (searched {[str(r) for r in search_roots]})")


def _expand_glob_or_path(raw_path: str, search_roots: list[Path]) -> list[Path]:
    if any(ch in raw_path for ch in ("*", "?", "[")):
        for root in search_roots:
            pattern = str(root / raw_path) if not Path(raw_path).is_absolute() else raw_path
            matches = sorted(Path(m).resolve() for m in glob.glob(pattern) if Path(m).is_file())
            if matches:
                return matches
        raise FileNotFoundError(f"No files matched glob pattern: {raw_path}")
    return [_resolve_path(raw_path, search_roots)]


def _sanitize_filename(name: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9_.\-]+", "_", name).strip("_.")
    return clean or f"video_{uuid.uuid4().hex[:6]}"


class ObsidianAutoEngine:
    """
    High-level Python wrapper for automating multi-video renders from HJSON manifests.

    Example:
        engine = ObsidianAutoEngine()
        report = engine.run_manifest("autoengine/examples/batch_videos.hjson")
    """

    def __init__(
        self,
        work_dir: str | Path | None = None,
        server_url: str | None = None,
        keep_temp: bool = False,
        on_event: Callable[[str], None] | None = None,
    ) -> None:
        self.work_dir = Path(work_dir).resolve() if work_dir else (REPO_ROOT / ".obsidiancut_data" / "autoengine").resolve()
        self.server_url = server_url.rstrip("/") if server_url else None
        self.keep_temp = keep_temp
        self.on_event = on_event or (lambda msg: print(msg, flush=True))
        self._cache_lock = threading.Lock()
        self._media_cache: dict[tuple[str, int, int], dict[str, Any]] = {}
        self._sample_audio_cache: dict[tuple[float, int], dict[str, Any]] = {}
        self._engine_mod = None

    def _get_engine(self):
        if self._engine_mod is not None:
            return self._engine_mod
        if str(REPO_ROOT) not in sys.path:
            sys.path.insert(0, str(REPO_ROOT))
        os.environ.setdefault("OBSIDIANCUT_DATA_DIR", str(self.work_dir))
        from backend import engine as py_engine

        for d in (py_engine.UPLOAD_DIR, py_engine.THUMB_DIR, py_engine.PROXY_DIR, py_engine.RENDER_DIR):
            d.mkdir(parents=True, exist_ok=True)
        self._engine_mod = py_engine
        return py_engine

    def _register_local_media_direct(self, file_path: Path) -> dict[str, Any]:
        engine = self._get_engine()
        stat = file_path.stat()
        cache_key = (str(file_path), stat.st_size, stat.st_mtime_ns)
        with self._cache_lock:
            if cache_key in self._media_cache:
                return self._media_cache[cache_key]

        asset_id = uuid.uuid4().hex[:12]
        ext = file_path.suffix.lower() or ".bin"
        dest = engine.UPLOAD_DIR / f"{asset_id}{ext}"
        shutil.copy2(file_path, dest)

        meta = engine.probe_media(str(dest), asset_id)
        if meta["mediaType"] == "audio":
            audio_info = engine.analyze_audio_beats(str(dest))
            meta.update(audio_info)

        record = {
            "id": asset_id,
            "name": file_path.name,
            "sourcePath": str(file_path),
            **meta,
        }
        with self._cache_lock:
            self._media_cache[cache_key] = record
        return record

    def _get_or_create_sample_audio_direct(self, bpm: int = 120, duration: float = 16.0) -> dict[str, Any]:
        engine = self._get_engine()
        key = (round(duration, 2), int(bpm))
        with self._cache_lock:
            if key in self._sample_audio_cache:
                return self._sample_audio_cache[key]

        asset_id = f"sample_{bpm}bpm_{uuid.uuid4().hex[:6]}"
        out_wav = engine.UPLOAD_DIR / f"{asset_id}.wav"
        engine.generate_sample_audio(out_wav, duration=duration, bpm=bpm)
        meta = engine.probe_media(str(out_wav), asset_id)
        audio_info = engine.analyze_audio_beats(str(out_wav))
        meta.update(audio_info)
        record = {
            "id": asset_id,
            "name": f"sample_{bpm}bpm.wav",
            "sourcePath": str(out_wav),
            **meta,
        }
        with self._cache_lock:
            self._sample_audio_cache[key] = record
        return record

    def _upload_media_remote(self, file_path: Path) -> dict[str, Any]:
        stat = file_path.stat()
        cache_key = (str(file_path), stat.st_size, stat.st_mtime_ns)
        with self._cache_lock:
            if cache_key in self._media_cache:
                return self._media_cache[cache_key]

        boundary = f"----ObsidianAutoEngine{uuid.uuid4().hex}"
        mime = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        data_bytes = file_path.read_bytes()
        header = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="files"; filename="{file_path.name}"\r\n'
            f"Content-Type: {mime}\r\n\r\n"
        ).encode("utf-8")
        footer = f"\r\n--{boundary}--\r\n".encode("utf-8")
        req = urllib.request.Request(
            f"{self.server_url}/api/media/upload",
            data=header + data_bytes + footer,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        assets = payload.get("assets") or []
        if not assets:
            raise RuntimeError(f"Remote upload failed for {file_path}")
        record = assets[0]
        with self._cache_lock:
            self._media_cache[cache_key] = record
        return record

    def _get_remote_sample_audio(self) -> dict[str, Any]:
        key = (16.0, 120)
        with self._cache_lock:
            if key in self._sample_audio_cache:
                return self._sample_audio_cache[key]
        req = urllib.request.Request(
            f"{self.server_url}/api/sample-pack",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        audio = next((a for a in payload.get("assets", []) if a.get("mediaType") == "audio"), None)
        if not audio:
            raise RuntimeError("Remote /api/sample-pack did not return an audio track")
        with self._cache_lock:
            self._sample_audio_cache[key] = audio
        return audio

    def _resolve_audio_asset(
        self,
        audio_spec: Any,
        search_roots: list[Path],
        dry_run: bool,
    ) -> dict[str, Any] | None:
        if not audio_spec:
            return None
        if isinstance(audio_spec, dict):
            path_str = str(audio_spec.get("path", "")).strip()
        else:
            path_str = str(audio_spec).strip()
        if not path_str:
            return None

        if path_str.lower().startswith("sample"):
            m = re.search(r"(\d+)\s*bpm", path_str.lower())
            bpm = int(m.group(1)) if m else 120
            bpm = max(60, min(200, bpm))
            if dry_run:
                step = 60.0 / bpm
                beats = [round(i * step, 3) for i in range(int(16.0 / step))]
                return {"id": f"dry_sample_{bpm}", "mediaType": "audio", "duration": 16.0, "bpm": bpm, "beats": beats}
            if self.server_url:
                return self._get_remote_sample_audio()
            return self._get_or_create_sample_audio_direct(bpm=bpm, duration=16.0)

        resolved = _resolve_path(path_str, search_roots)
        if dry_run:
            return {"id": f"dry_{resolved.stem}", "mediaType": "audio", "duration": 12.0, "bpm": 120, "beats": [round(i * 0.5, 3) for i in range(24)]}
        return self._upload_media_remote(resolved) if self.server_url else self._register_local_media_direct(resolved)

    def _register_visual(self, file_path: Path, dry_run: bool) -> dict[str, Any]:
        if dry_run:
            ext = file_path.suffix.lower()
            is_vid = ext in {".mp4", ".mov", ".mkv", ".webm", ".avi"}
            return {"id": f"dry_{file_path.stem}", "mediaType": "video" if is_vid else "image", "duration": 4.0 if is_vid else 0.0, "hasAudio": is_vid}
        return self._upload_media_remote(file_path) if self.server_url else self._register_local_media_direct(file_path)

    def _build_auto_payload(
        self,
        spec: dict[str, Any],
        search_roots: list[Path],
        dry_run: bool,
    ) -> dict[str, Any]:
        raw_slides = spec.get("slides") or spec.get("media") or []
        if not raw_slides:
            raise ValueError(f"Video '{spec.get('id', 'unnamed')}' in auto mode must define 'slides'")

        expanded_slides: list[dict[str, Any]] = []
        for entry in raw_slides:
            if isinstance(entry, str):
                for p in _expand_glob_or_path(entry, search_roots):
                    expanded_slides.append({"path": p})
            elif isinstance(entry, dict):
                raw_p = str(entry.get("path", "")).strip()
                if not raw_p:
                    raise ValueError(f"Slide object missing 'path' in video '{spec.get('id')}'")
                for p in _expand_glob_or_path(raw_p, search_roots):
                    slide_cfg = dict(entry)
                    slide_cfg["path"] = p
                    expanded_slides.append(slide_cfg)

        if not expanded_slides:
            raise ValueError(f"No visual slides resolved for video '{spec.get('id')}'")

        audio_spec = spec.get("audio")
        audio_asset = self._resolve_audio_asset(audio_spec, search_roots, dry_run)

        beat_stride = spec.get("beatStride", 2)
        trans_style = str(spec.get("transitionStyle", "dynamic"))
        if trans_style not in TRANSITION_POOLS:
            trans_style = "dynamic"
        pool = TRANSITION_POOLS[trans_style]
        base_tdur = float(spec.get("transitionDuration", 0.45)) if trans_style != "cut" else 0.0
        enable_motion = bool(spec.get("enableMotion", True))
        max_song_dur = spec.get("maxDuration")

        # Compute beat-aligned cut intervals matching Obsidian Cut's frontend autoAssembleTimeline
        cut_times: list[float] = []
        if audio_asset and len(audio_asset.get("beats") or []) >= 2:
            song_dur = max(2.0, float(audio_asset.get("duration") or 16.0))
            target_limit = min(song_dur, float(max_song_dur)) if max_song_dur else song_dur
            beats = [b for b in audio_asset["beats"] if b <= target_limit]

            if beat_stride == "fit":
                count = len(expanded_slides)
                step = target_limit / float(count)
                cut_times = [round(i * step, 3) for i in range(count + 1)]
            else:
                stride = max(1, int(beat_stride))
                cut_times = [0.0]
                for idx in range(stride, len(beats), stride):
                    bt = float(beats[idx])
                    if bt - cut_times[-1] >= 0.55:
                        cut_times.append(bt)
                if len(cut_times) - 1 < len(expanded_slides):
                    count = len(expanded_slides)
                    step = max(1.2, min(3.5, target_limit / float(count)))
                    cut_times = [round(i * step, 3) for i in range(count + 1)]
        else:
            default_dur = float(spec.get("slideDuration", 2.5))
            cut_times = [0.0]
            cursor_t = 0.0
            for s in expanded_slides:
                cursor_t += float(s.get("duration", default_dur))
                cut_times.append(round(cursor_t, 3))

        tracks = [
            {"id": "trk_v2", "name": "V2 Overlay", "kind": "video", "muted": False, "solo": False, "hidden": False, "volume": 1.0},
            {"id": "trk_v1", "name": "V1 Main", "kind": "video", "muted": False, "solo": False, "hidden": False, "volume": 1.0},
            {"id": "trk_a1", "name": "A1 Music", "kind": "audio", "muted": False, "solo": False, "hidden": False, "volume": 1.0},
        ]

        clips: list[dict[str, Any]] = []
        max_slides = min(64, max(len(expanded_slides), len(cut_times) - 1))
        if max_song_dur and not audio_asset:
            max_slides = len(expanded_slides)

        cursor = 0.0
        for i in range(max_slides):
            s_cfg = expanded_slides[i % len(expanded_slides)]
            v_asset = self._register_visual(s_cfg["path"], dry_run)

            t_start = cut_times[i] if i < len(cut_times) else cursor
            t_end = cut_times[i + 1] if i + 1 < len(cut_times) else (t_start + 2.0)
            interval = float(s_cfg.get("duration", max(0.6, t_end - t_start)))

            trans = str(s_cfg.get("transition") or pool[i % len(pool)])
            eff_tdur = (
                min(base_tdur, interval * 0.4)
                if (i < max_slides - 1 and trans != "cut")
                else 0.0
            )
            dur = round(interval + eff_tdur, 3)
            if v_asset.get("mediaType") == "video" and float(v_asset.get("duration") or 0) > 0.5:
                dur = min(dur, float(v_asset["duration"]))

            motion = s_cfg.get("motion")
            if motion is None:
                motion = MOTIONS[i % len(MOTIONS)] if (enable_motion and v_asset.get("mediaType") == "image") else "none"

            clip_effects = {**DEFAULT_CLIP_EFFECTS, **(s_cfg.get("effects") or {})}
            clips.append({
                "id": f"cl_{i}",
                "trackId": "trk_v1",
                "kind": "video" if v_asset.get("mediaType") == "video" else "image",
                "mediaId": v_asset["id"],
                "name": s_cfg["path"].name,
                "startTime": round(cursor, 3),
                "duration": round(dur, 3),
                "trimStart": float(s_cfg.get("trimStart", 0.0)),
                "hasAudio": bool(v_asset.get("hasAudio", False)),
                "muted": bool(audio_asset is not None or s_cfg.get("muted", False)),
                "fit": str(s_cfg.get("fit", "cover")),
                "scale": float(s_cfg.get("scale", 1.0)),
                "x": float(s_cfg.get("x", 0.0)),
                "y": float(s_cfg.get("y", 0.0)),
                "rotation": float(s_cfg.get("rotation", 0.0)),
                "opacity": float(s_cfg.get("opacity", 1.0)),
                "motion": motion,
                "transitionOut": trans if i < max_slides - 1 else "cut",
                "transitionDuration": round(eff_tdur, 2),
                "fadeIn": float(s_cfg.get("fadeIn", 0.0)),
                "fadeOut": float(s_cfg.get("fadeOut", 0.0)),
                "speed": float(s_cfg.get("speed", 1.0)),
                "reverse": bool(s_cfg.get("reverse", False)),
                "volume": float(s_cfg.get("volume", 1.0)),
                "pan": float(s_cfg.get("pan", 0.0)),
                "effects": clip_effects,
            })
            cursor = round(cursor + dur - eff_tdur, 3)

        total_dur = max((c["startTime"] + c["duration"] for c in clips), default=1.0)
        if max_song_dur:
            total_dur = min(total_dur, float(max_song_dur))

        # Optional overlay/watermark on V2 track
        overlays = []
        if spec.get("overlay"):
            overlays.append(spec["overlay"])
        if isinstance(spec.get("overlays"), list):
            overlays.extend(spec["overlays"])

        for ov_idx, ov in enumerate(overlays):
            ov_path_str = str(ov.get("path", "")).strip()
            if not ov_path_str:
                continue
            ov_path = _resolve_path(ov_path_str, search_roots)
            ov_asset = self._register_visual(ov_path, dry_run)
            ov_start = float(ov.get("startTime", 0.0))
            ov_dur = float(ov.get("duration", max(0.5, total_dur - ov_start)))
            clips.append({
                "id": f"ov_{ov_idx}",
                "trackId": "trk_v2",
                "kind": "video" if ov_asset.get("mediaType") == "video" else "image",
                "mediaId": ov_asset["id"],
                "name": ov_path.name,
                "startTime": round(ov_start, 3),
                "duration": round(ov_dur, 3),
                "trimStart": float(ov.get("trimStart", 0.0)),
                "hasAudio": False,
                "muted": True,
                "fit": str(ov.get("fit", "contain")),
                "scale": float(ov.get("scale", 0.18)),
                "x": float(ov.get("x", 36.0)),
                "y": float(ov.get("y", -36.0)),
                "rotation": float(ov.get("rotation", 0.0)),
                "opacity": float(ov.get("opacity", 0.85)),
                "motion": "none",
                "transitionOut": "cut",
                "transitionDuration": 0.0,
                "fadeIn": float(ov.get("fadeIn", 0.3)),
                "fadeOut": float(ov.get("fadeOut", 0.3)),
                "speed": float(ov.get("speed", 1.0)),
                "reverse": bool(ov.get("reverse", False)),
                "volume": 1.0,
                "pan": 0.0,
                "effects": {**DEFAULT_CLIP_EFFECTS, **(ov.get("effects") or {})},
            })

        # Add background audio track
        if audio_asset:
            audio_cfg = audio_spec if isinstance(audio_spec, dict) else {}
            song_dur = max(1.0, float(audio_asset.get("duration") or total_dur))
            a_dur = round(min(song_dur, total_dur), 3)
            clips.append({
                "id": "aud_0",
                "trackId": "trk_a1",
                "kind": "audio",
                "mediaId": audio_asset["id"],
                "name": audio_asset.get("name", "audio"),
                "startTime": float(audio_cfg.get("startTime", 0.0)),
                "duration": a_dur,
                "trimStart": float(audio_cfg.get("trimStart", 0.0)),
                "hasAudio": True,
                "muted": False,
                "speed": float(audio_cfg.get("speed", 1.0)),
                "reverse": bool(audio_cfg.get("reverse", False)),
                "volume": float(audio_cfg.get("volume", 1.0)),
                "pan": float(audio_cfg.get("pan", 0.0)),
                "fadeIn": float(audio_cfg.get("fadeIn", 0.35)),
                "fadeOut": float(audio_cfg.get("fadeOut", min(1.5, a_dur * 0.15))),
                "effects": dict(DEFAULT_CLIP_EFFECTS),
            })

        return {
            "tracks": tracks,
            "clips": clips,
            "colorGrade": spec.get("colorGrade") or {"enabled": False, "preset": "none"},
            "export": {
                "resolution": str(spec.get("resolution", "1920x1080")),
                "fps": float(spec.get("fps", 30)),
                "format": str(spec.get("format", "mp4")).lower(),
                "speedProfile": str(spec.get("speedProfile", "veryfast")),
            },
        }

    def _build_timeline_payload(
        self,
        spec: dict[str, Any],
        search_roots: list[Path],
        dry_run: bool,
    ) -> dict[str, Any]:
        tracks_in = spec.get("tracks") or [
            {"id": "v2", "name": "V2 Overlay", "kind": "video"},
            {"id": "v1", "name": "V1 Main", "kind": "video"},
            {"id": "a1", "name": "A1 Audio", "kind": "audio"},
        ]
        tracks = [
            {
                "id": str(t.get("id", f"trk_{idx}")),
                "name": str(t.get("name", f"Track {idx+1}")),
                "kind": str(t.get("kind", "video")),
                "muted": bool(t.get("muted", False)),
                "solo": bool(t.get("solo", False)),
                "hidden": bool(t.get("hidden", False)),
                "volume": float(t.get("volume", 1.0)),
            }
            for idx, t in enumerate(tracks_in)
        ]

        clips_in = spec.get("clips") or []
        if not clips_in:
            raise ValueError(f"Video '{spec.get('id', 'unnamed')}' in timeline mode has no clips")

        clips: list[dict[str, Any]] = []
        for idx, c in enumerate(clips_in):
            raw_path = str(c.get("path", "")).strip()
            media_id = c.get("mediaId")
            media_type = c.get("kind")
            has_audio = bool(c.get("hasAudio", False))

            if raw_path:
                if raw_path.lower().startswith("sample"):
                    asset = self._resolve_audio_asset(raw_path, search_roots, dry_run)
                else:
                    p = _resolve_path(raw_path, search_roots)
                    ext = p.suffix.lower()
                    if ext in {".mp3", ".wav", ".aac", ".m4a", ".ogg", ".flac", ".opus", ".wma"}:
                        asset = self._resolve_audio_asset(str(p), search_roots, dry_run)
                    else:
                        asset = self._register_visual(p, dry_run)
                assert asset is not None
                media_id = asset["id"]
                media_type = media_type or asset["mediaType"]
                has_audio = bool(asset.get("hasAudio", media_type == "audio"))

            clips.append({
                "id": str(c.get("id", f"tc_{idx}")),
                "trackId": str(c.get("trackId", tracks[0]["id"])),
                "kind": media_type or "image",
                "mediaId": media_id,
                "name": str(c.get("name", Path(raw_path).name if raw_path else f"Clip {idx+1}")),
                "startTime": float(c.get("startTime", 0.0)),
                "duration": float(c.get("duration", 3.0)),
                "trimStart": float(c.get("trimStart", 0.0)),
                "hasAudio": has_audio,
                "muted": bool(c.get("muted", False)),
                "fit": str(c.get("fit", "cover")),
                "scale": float(c.get("scale", 1.0)),
                "x": float(c.get("x", 0.0)),
                "y": float(c.get("y", 0.0)),
                "rotation": float(c.get("rotation", 0.0)),
                "opacity": float(c.get("opacity", 1.0)),
                "motion": str(c.get("motion", "none")),
                "transitionOut": str(c.get("transitionOut", "cut")),
                "transitionDuration": float(c.get("transitionDuration", 0.0)),
                "fadeIn": float(c.get("fadeIn", 0.0)),
                "fadeOut": float(c.get("fadeOut", 0.0)),
                "speed": float(c.get("speed", 1.0)),
                "reverse": bool(c.get("reverse", False)),
                "volume": float(c.get("volume", 1.0)),
                "pan": float(c.get("pan", 0.0)),
                "effects": {**DEFAULT_CLIP_EFFECTS, **(c.get("effects") or {})},
            })

        return {
            "tracks": tracks,
            "clips": clips,
            "colorGrade": spec.get("colorGrade") or {"enabled": False, "preset": "none"},
            "export": {
                "resolution": str(spec.get("resolution", "1920x1080")),
                "fps": float(spec.get("fps", 30)),
                "format": str(spec.get("format", "mp4")).lower(),
                "speedProfile": str(spec.get("speedProfile", "veryfast")),
            },
        }

    def _render_single_direct(self, job_id: str, payload: dict[str, Any], out_dest: Path) -> dict[str, Any]:
        engine = self._get_engine()
        with engine.JOBS_LOCK:
            engine.JOBS[job_id] = {
                "jobId": job_id,
                "status": "queued",
                "progress": 0,
                "speed": "",
                "elapsedMs": 0,
                "createdAt": time.time(),
            }
        engine.render_job_worker(job_id, payload)
        with engine.JOBS_LOCK:
            job_state = dict(engine.JOBS[job_id])

        if job_state.get("status") != "completed":
            raise RuntimeError(job_state.get("error") or "Render failed")

        src_path = Path(job_state["outputPath"])
        out_dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, out_dest)
        return job_state

    def _render_single_remote(self, payload: dict[str, Any], out_dest: Path) -> dict[str, Any]:
        req = urllib.request.Request(
            f"{self.server_url}/api/render",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            enq = json.loads(resp.read().decode("utf-8"))
        remote_id = enq["jobId"]

        while True:
            time.sleep(0.5)
            with urllib.request.urlopen(f"{self.server_url}/api/render/{remote_id}", timeout=30) as st_resp:
                job_state = json.loads(st_resp.read().decode("utf-8"))
            status = job_state.get("status")
            if status == "completed":
                break
            if status == "failed":
                raise RuntimeError(job_state.get("error") or "Remote render failed")

        out_dest.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(f"{self.server_url}/api/render/{remote_id}/download", timeout=120) as dl:
            out_dest.write_bytes(dl.read())
        return job_state

    def _process_video_entry(
        self,
        idx: int,
        spec: dict[str, Any],
        search_roots: list[Path],
        dry_run: bool,
    ) -> BatchJobResult:
        t0 = time.time()
        vid_id = _sanitize_filename(str(spec.get("id") or f"video_{idx+1}"))
        fmt = str(spec.get("format", "mp4")).lower()
        res = str(spec.get("resolution", "1920x1080"))
        fps = float(spec.get("fps", 30))

        out_dir_raw = str(spec.get("outputDir", "autoengine/output"))
        out_dir = Path(out_dir_raw)
        if not out_dir.is_absolute():
            out_dir = (REPO_ROOT / out_dir).resolve()

        out_name_raw = str(spec.get("output") or f"{vid_id}.{fmt}")
        out_dest = Path(out_name_raw)
        if not out_dest.is_absolute():
            out_dest = (out_dir / out_name_raw).resolve()
        if out_dest.suffix.lower().lstrip(".") != fmt:
            out_dest = out_dest.with_suffix(f".{fmt}")

        try:
            mode = str(spec.get("mode") or ("timeline" if spec.get("clips") else "auto")).lower()
            if mode == "timeline":
                payload = self._build_timeline_payload(spec, search_roots, dry_run)
            else:
                payload = self._build_auto_payload(spec, search_roots, dry_run)

            dur_sec = round(max((c["startTime"] + c["duration"] for c in payload["clips"]), default=0.0), 3)
            clip_count = len(payload["clips"])

            if dry_run:
                self.on_event(f"[DRY-RUN] {vid_id} -> {out_dest} ({res} @ {fps}fps, {clip_count} clips, ~{dur_sec:.2f}s)")
                return BatchJobResult(
                    id=vid_id,
                    status="dry_run",
                    output_path=str(out_dest),
                    duration_sec=dur_sec,
                    elapsed_ms=int((time.time() - t0) * 1000),
                    clip_count=clip_count,
                    resolution=res,
                    fps=fps,
                    format=fmt,
                )

            self.on_event(f"[RENDER] Starting '{vid_id}' ({res} @ {fps}fps, {fmt}) -> {out_dest}")
            if self.server_url:
                job_state = self._render_single_remote(payload, out_dest)
            else:
                job_state = self._render_single_direct(f"{vid_id}_{uuid.uuid4().hex[:6]}", payload, out_dest)

            size_bytes = out_dest.stat().st_size if out_dest.exists() else int(job_state.get("outputSize", 0))
            elapsed_ms = int((time.time() - t0) * 1000)
            self.on_event(f"[DONE]   '{vid_id}' completed in {elapsed_ms/1000:.2f}s ({size_bytes:,} bytes)")
            return BatchJobResult(
                id=vid_id,
                status="completed",
                output_path=str(out_dest),
                duration_sec=dur_sec,
                elapsed_ms=elapsed_ms,
                size_bytes=size_bytes,
                clip_count=clip_count,
                resolution=res,
                fps=fps,
                format=fmt,
            )
        except Exception as exc:
            elapsed_ms = int((time.time() - t0) * 1000)
            self.on_event(f"[FAILED] '{vid_id}' failed: {exc}")
            return BatchJobResult(
                id=vid_id,
                status="failed",
                output_path=str(out_dest),
                elapsed_ms=elapsed_ms,
                resolution=res,
                fps=fps,
                format=fmt,
                error=str(exc),
            )

    def run_manifest(
        self,
        manifest_path: str | Path,
        *,
        only_ids: set[str] | None = None,
        workers: int | None = None,
        dry_run: bool = False,
        report_path: str | Path | None = None,
    ) -> BatchRenderReport:
        t_start = time.time()
        m_path = Path(manifest_path).resolve()
        if not m_path.exists():
            raise FileNotFoundError(f"HJSON manifest not found: {m_path}")

        manifest = load_hjson(m_path)
        if not isinstance(manifest, dict):
            raise ValueError("HJSON manifest root must be an object")

        defaults = manifest.get("defaults") or {}
        raw_videos = manifest.get("videos") or manifest.get("jobs") or []
        if not isinstance(raw_videos, list) or not raw_videos:
            raise ValueError("HJSON manifest must contain a non-empty 'videos' (or 'jobs') list")

        merged_specs: list[dict[str, Any]] = []
        for idx, v in enumerate(raw_videos):
            if not isinstance(v, dict):
                raise ValueError(f"Video entry #{idx+1} must be an HJSON object")
            spec = _deep_merge(defaults, v)
            vid_id = str(spec.get("id") or f"video_{idx+1}")
            if only_ids and vid_id not in only_ids:
                continue
            merged_specs.append(spec)

        if not merged_specs:
            raise ValueError("No matching video entries selected for processing")

        search_roots = [m_path.parent, REPO_ROOT, Path.cwd()]
        max_workers = max(1, min(4, int(workers or manifest.get("workers") or 2)))

        results: list[BatchJobResult] = [None] * len(merged_specs)  # type: ignore[list-item]
        if max_workers == 1 or len(merged_specs) == 1:
            for i, spec in enumerate(merged_specs):
                results[i] = self._process_video_entry(i, spec, search_roots, dry_run)
        else:
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                fut_map = {
                    pool.submit(self._process_video_entry, i, spec, search_roots, dry_run): i
                    for i, spec in enumerate(merged_specs)
                }
                for fut in as_completed(fut_map):
                    idx = fut_map[fut]
                    results[idx] = fut.result()

        if not self.keep_temp and not dry_run and self._engine_mod is not None and self.work_dir.exists():
            shutil.rmtree(self.work_dir, ignore_errors=True)
            with self._cache_lock:
                self._media_cache.clear()
                self._sample_audio_cache.clear()
            for d in (
                self._engine_mod.UPLOAD_DIR,
                self._engine_mod.THUMB_DIR,
                self._engine_mod.PROXY_DIR,
                self._engine_mod.RENDER_DIR,
            ):
                d.mkdir(parents=True, exist_ok=True)

        succeeded = sum(1 for r in results if r.status in ("completed", "dry_run"))
        failed = sum(1 for r in results if r.status == "failed")
        report = BatchRenderReport(
            manifest_path=str(m_path),
            total_videos=len(results),
            succeeded=succeeded,
            failed=failed,
            total_elapsed_ms=int((time.time() - t_start) * 1000),
            results=results,
        )

        if report_path:
            rp = Path(report_path)
            rp.parent.mkdir(parents=True, exist_ok=True)
            rp.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")

        return report


def run_batch_from_hjson(
    manifest_path: str | Path,
    *,
    only_ids: set[str] | None = None,
    workers: int | None = None,
    dry_run: bool = False,
    server_url: str | None = None,
    report_path: str | Path | None = None,
) -> BatchRenderReport:
    """Convenience function to execute an HJSON batch manifest in one call."""
    wrapper = ObsidianAutoEngine(server_url=server_url)
    return wrapper.run_manifest(
        manifest_path,
        only_ids=only_ids,
        workers=workers,
        dry_run=dry_run,
        report_path=report_path,
    )
