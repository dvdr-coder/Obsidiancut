#!/usr/bin/env python3
"""
Obsidian Cut High-Performance Multi-Track Python + FFmpeg Media Engine.
Supports unlimited tracks, compositing/watermarks, vector title & rolling credit
overlays, transitions, time-mapping (speed/reverse), digital video effects
(brightness, gamma, hue, greyscale, chromakey), VFR-to-CFR normalization,
smart editing proxies, 48kHz AV sync, and sandboxed plugin filters.
Compatible with Linux, WSL, and native Windows.
"""

import array
import base64
from collections import deque
import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.parse
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(os.environ.get("OBSIDIANCUT_DATA_DIR", ".obsidiancut_data")).resolve()
UPLOAD_DIR = BASE_DIR / "uploads"
THUMB_DIR = BASE_DIR / "thumbs"
PROXY_DIR = BASE_DIR / "proxies"
RENDER_DIR = BASE_DIR / "renders"

for d in (UPLOAD_DIR, THUMB_DIR, PROXY_DIR, RENDER_DIR):
    d.mkdir(parents=True, exist_ok=True)

FFMPEG_BIN = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE_BIN = shutil.which("ffprobe") or "ffprobe"

HOST = os.environ.get("PY_ENGINE_HOST", "127.0.0.1")
PORT = int(os.environ.get("PY_ENGINE_PORT", "3001"))

EXECUTOR = ThreadPoolExecutor(max_workers=2)
JOBS_LOCK = threading.Lock()
JOBS: dict[str, dict] = {}

SUPPORTED_XFADE = {
    "fade", "wipeleft", "wiperight", "wipeup", "wipedown",
    "slideleft", "slideright", "slideup", "slidedown",
    "circleopen", "circleclose", "dissolve", "pixelize",
    "radial", "smoothleft", "smoothright", "smoothup", "smoothdown",
    "fadeblack", "fadewhite", "fadegrays", "diagtl", "diagtr",
    "squeezeh", "squeezev", "vertopen", "horzopen", "hblur",
}

XFADE_ALIASES = {
    "wipe": "wipeleft",
    "crossfade": "fade",
    "none": "cut",
}


def build_track_dsp_filters(dsp: dict | None) -> list[str]:
    if not isinstance(dsp, dict):
        return []
    filters: list[str] = []
    eq_low = safe_float(dsp.get("eqLowDb", 0.0), 0.0, -12.0, 12.0)
    eq_mid = safe_float(dsp.get("eqMidDb", 0.0), 0.0, -12.0, 12.0)
    eq_high = safe_float(dsp.get("eqHighDb", 0.0), 0.0, -12.0, 12.0)
    if abs(eq_low) > 0.2:
        filters.append(f"bass=g={eq_low:.1f}:f=110:w=0.6")
    if abs(eq_mid) > 0.2:
        filters.append(f"equalizer=f=1200:t=q:w=1.1:g={eq_mid:.1f}")
    if abs(eq_high) > 0.2:
        filters.append(f"treble=g={eq_high:.1f}:f=6500:w=0.6")
    if dsp.get("compressorEnabled"):
        thresh_db = safe_float(dsp.get("compThresholdDb", -16.0), -16.0, -40.0, -2.0)
        ratio = safe_float(dsp.get("compRatio", 3.5), 3.5, 1.5, 12.0)
        filters.append(f"acompressor=threshold={thresh_db:.1f}dB:ratio={ratio:.2f}:attack=15:release=140:makeup=2.0")
    reverb_mix = safe_float(dsp.get("reverbMix", 0.0), 0.0, 0.0, 0.85)
    if reverb_mix > 0.02:
        wet = round(min(0.65, reverb_mix * 0.6), 2)
        filters.append(f"aecho=0.8:0.85:45|90:{wet}|{round(wet * 0.7, 2)}")
    if dsp.get("normalizeEnabled"):
        target_lufs = safe_float(
            dsp.get("normalizeTargetLufs", dsp.get("normalizeTargetDb", -16.0)),
            -16.0,
            -30.0,
            -5.0,
        )
        filters.append(f"loudnorm=I={target_lufs:.1f}:TP=-1.5:LRA=11")
        filters.append("aresample=48000")
        filters.append("aformat=sample_rates=48000:channel_layouts=stereo")
    if dsp.get("limiterEnabled"):
        filters.append("alimiter=limit=0.95:attack=5:release=50")
    return filters


def extract_clip_transition(clip: dict) -> tuple[str, float]:
    """Resolve normalized FFmpeg transition type and duration from clip timeline metadata."""
    trans_meta = clip.get("transition") if isinstance(clip.get("transition"), dict) else {}
    raw_type = str(
        trans_meta.get("ffmpegFilter")
        or trans_meta.get("type")
        or clip.get("transitionOut")
        or "cut"
    ).strip().lower()
    raw_type = XFADE_ALIASES.get(raw_type, raw_type)
    if raw_type == "cut":
        return "cut", 0.0
    if raw_type not in SUPPORTED_XFADE:
        raw_type = "fade"
    raw_dur = trans_meta.get("duration", clip.get("transitionDuration", 0.0))
    t_dur = safe_float(raw_dur, 0.0, 0.0, 5.0)
    return raw_type, t_dur


def run_cmd(cmd: list[str], timeout: int = 45) -> tuple[int, bytes, bytes]:
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    return proc.returncode, proc.stdout, proc.stderr


def parse_rate(rate_str: str | None) -> float:
    if not rate_str or "/" not in rate_str:
        try:
            v = float(rate_str or 0.0)
            return v if math.isfinite(v) else 0.0
        except (TypeError, ValueError):
            return 0.0
    try:
        num, den = rate_str.split("/", 1)
        d = float(den)
        if d <= 0:
            return 0.0
        v = float(num) / d
        return v if math.isfinite(v) else 0.0
    except (TypeError, ValueError):
        return 0.0


def safe_float(val, default: float, lo: float, hi: float) -> float:
    try:
        v = float(val)
        if not math.isfinite(v):
            return default
        return max(lo, min(hi, v))
    except (TypeError, ValueError):
        return default


def resolve_fps_spec(fps_raw) -> tuple[str, str, float]:
    val = safe_float(fps_raw, 30.0, 12.0, 120.0)
    if abs(val - 23.976) < 0.05:
        return "24000/1001", "1001/24000", 24000.0 / 1001.0
    if abs(val - 29.97) < 0.05:
        return "30000/1001", "1001/30000", 30000.0 / 1001.0
    if abs(val - 59.94) < 0.05:
        return "60000/1001", "1001/60000", 60000.0 / 1001.0
    fps_i = max(12, min(120, int(round(val))))
    return str(fps_i), f"1/{fps_i}", float(fps_i)


def probe_media(file_path: str, asset_id: str) -> dict:
    cmd = [
        FFPROBE_BIN,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        file_path,
    ]
    code, out, err = run_cmd(cmd, timeout=25)
    if code != 0:
        raise RuntimeError(f"ffprobe failed: {err.decode('utf-8', 'ignore')}")

    info = json.loads(out.decode("utf-8", "ignore") or "{}")
    streams = info.get("streams", [])
    fmt = info.get("format", {})

    v_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    a_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    ext = Path(file_path).suffix.lower()
    image_exts = {
        ".jpg", ".jpeg", ".jpe", ".png", ".apng", ".webp", ".gif", ".avif",
        ".heic", ".heif", ".bmp", ".dib", ".tiff", ".tif", ".tga", ".svg",
        ".ico", ".cur", ".jxl", ".jp2", ".j2k", ".jpf", ".jpx", ".psd",
        ".exr", ".hdr", ".dds", ".ppm", ".pgm", ".pbm", ".pnm", ".pam",
        ".pcx", ".sgi", ".xbm", ".xpm", ".qoi",
    }
    audio_exts = {
        ".mp3", ".mp2", ".mpa", ".wav", ".wave", ".aac", ".adts", ".m4a",
        ".m4b", ".m4p", ".m4r", ".ogg", ".oga", ".opus", ".spx", ".flac",
        ".alac", ".wma", ".aiff", ".aif", ".aifc", ".caf", ".amr", ".awb",
        ".ac3", ".eac3", ".dts", ".ape", ".wv", ".tta", ".mpc", ".mka",
        ".ra", ".au", ".snd", ".3ga", ".pcm",
    }
    video_exts = {
        ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".flv", ".f4v",
        ".wmv", ".asf", ".3gp", ".3g2", ".ts", ".mts", ".m2ts", ".vob",
        ".ogv", ".mxf", ".mpg", ".mpeg", ".m2v", ".mpv", ".rm", ".rmvb",
        ".divx", ".dv", ".nut", ".wtv",
    }

    codec_name = (v_stream or {}).get("codec_name", "").lower()
    audio_codec = (a_stream or {}).get("codec_name", "").lower()
    pix_fmt = (v_stream or {}).get("pix_fmt", "").lower()
    format_name = (fmt.get("format_name") or "").lower()
    nb_frames = int((v_stream or {}).get("nb_frames") or 0)
    is_animated_image = ext in {".gif", ".apng", ".webp"} and nb_frames > 1

    is_image = (
        not is_animated_image
        and (
            ext in image_exts
            or codec_name in {
                "mjpeg", "png", "webp", "bmp", "tiff", "targa", "gif",
                "svg", "exr", "psd", "dds", "jpeg2000", "ppm", "pgm", "pbm",
            }
            or "image2" in format_name
            or (v_stream is not None and nb_frames == 1 and ext not in video_exts)
        )
    )

    if is_image and ext not in audio_exts:
        media_type = "image"
    elif (v_stream is not None or ext in video_exts) and ext not in audio_exts:
        media_type = "video"
    elif a_stream is not None or ext in audio_exts:
        media_type = "audio"
    else:
        media_type = "image"

    width = int((v_stream or {}).get("width") or 0)
    height = int((v_stream or {}).get("height") or 0)
    r_fps = parse_rate((v_stream or {}).get("r_frame_rate"))
    avg_fps = parse_rate((v_stream or {}).get("avg_frame_rate"))
    is_vfr = media_type == "video" and r_fps > 0 and avg_fps > 0 and abs(r_fps - avg_fps) > 0.35
    source_fps = round(avg_fps or r_fps or 30.0, 3) if media_type == "video" else 0.0

    duration = 0.0
    if media_type != "image":
        try:
            duration = float(fmt.get("duration") or (v_stream or a_stream or {}).get("duration") or 0.0)
        except (TypeError, ValueError):
            duration = 0.0
        if media_type == "video" and duration <= 0.0:
            est_fps = avg_fps or r_fps or 15.0
            duration = round(max(0.5, nb_frames / max(1.0, est_fps)), 3)

    thumb_path = None
    if media_type in ("image", "video"):
        out_thumb = THUMB_DIR / f"{asset_id}.jpg"
        ss_args = ["-ss", "0.2"] if (media_type == "video" and duration > 0.5) else []
        t_cmd = [
            FFMPEG_BIN, "-y", "-nostdin", "-v", "error",
            *ss_args,
            "-i", file_path,
            "-frames:v", "1",
            "-vf", "scale=320:180:force_original_aspect_ratio=decrease",
            "-q:v", "4",
            str(out_thumb),
        ]
        t_code, _, _ = run_cmd(t_cmd, timeout=15)
        if t_code == 0 and out_thumb.exists():
            thumb_path = str(out_thumb)

    # Smart proxy generation:
    # 1) Non-browser-native images (TIFF, TGA, BMP, HEIC, EXR, PSD, JP2, HDR, PPM, etc.) or oversized photos
    # 2) Non-browser-native video containers/codecs (MKV, AVI, FLV, WMV, TS, MXF, MPG, HEVC, AV1, ProRes, VFR) or >540p
    # 3) Non-browser-native audio formats (WMA, AC3, DTS, AMR, AIFF, APE, WV, ALAC, MKA, etc.)
    browser_native_images = {".jpg", ".jpeg", ".jpe", ".png", ".webp", ".gif", ".svg", ".avif"}
    browser_native_videos = {".mp4", ".m4v", ".webm"}
    browser_native_video_codecs = {"h264", "vp8"}
    browser_native_audios = {".mp3", ".wav", ".wave", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".opus", ".webm"}
    browser_native_audio_codecs = {"mp3", "pcm_s16le", "pcm_u8", "pcm_f32le", "aac", "vorbis", "opus", "flac"}

    has_proxy = False
    try:
        needs_image_proxy = media_type == "image" and (
            ext not in browser_native_images
            or ((width > 1600 or height > 1000) and ext not in {".png", ".webp", ".svg"})
        )
        needs_video_proxy = media_type == "video" and (
            ext not in browser_native_videos
            or codec_name not in browser_native_video_codecs
            or width > 960
            or height > 540
            or is_vfr
            or (a_stream is not None and audio_codec not in {"aac", "mp3", "opus", "vorbis"})
        )
        needs_audio_proxy = media_type == "audio" and (
            ext not in browser_native_audios
            or (audio_codec and audio_codec not in browser_native_audio_codecs)
        )

        if needs_image_proxy:
            has_alpha = any(tok in pix_fmt for tok in ("rgba", "yuva", "bgra", "argb", "abgr", "pal8", "ya"))
            if has_alpha or ext in {".tga", ".tiff", ".tif", ".psd", ".exr"}:
                out_proxy = PROXY_DIR / f"{asset_id}_proxy.png"
                p_cmd = [
                    FFMPEG_BIN, "-y", "-nostdin", "-v", "error",
                    "-i", file_path,
                    "-frames:v", "1",
                    "-vf", "scale=min(1280\\,iw):min(720\\,ih):force_original_aspect_ratio=decrease",
                    str(out_proxy),
                ]
            else:
                out_proxy = PROXY_DIR / f"{asset_id}_proxy.jpg"
                p_cmd = [
                    FFMPEG_BIN, "-y", "-nostdin", "-v", "error",
                    "-i", file_path,
                    "-frames:v", "1",
                    "-vf", "scale=min(1280\\,iw):min(720\\,ih):force_original_aspect_ratio=decrease",
                    "-q:v", "3",
                    str(out_proxy),
                ]
            p_code, _, _ = run_cmd(p_cmd, timeout=20)
            has_proxy = p_code == 0 and out_proxy.exists()
        elif needs_video_proxy:
            out_proxy = PROXY_DIR / f"{asset_id}_proxy.mp4"
            p_cmd = [
                FFMPEG_BIN, "-y", "-nostdin", "-v", "error",
                "-fflags", "+genpts",
                "-i", file_path,
                "-vf", "fps=30,scale=trunc(min(854\\,iw)/2)*2:-2",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", "-g", "15",
                "-pix_fmt", "yuv420p",
                "-vsync", "cfr",
            ]
            if a_stream is not None:
                p_cmd.extend(["-c:a", "aac", "-b:a", "96k", "-ar", "48000"])
            p_cmd.extend(["-movflags", "+faststart", str(out_proxy)])
            p_code, _, _ = run_cmd(p_cmd, timeout=60)
            has_proxy = p_code == 0 and out_proxy.exists()
        elif needs_audio_proxy:
            out_proxy = PROXY_DIR / f"{asset_id}_proxy.m4a"
            p_cmd = [
                FFMPEG_BIN, "-y", "-nostdin", "-v", "error",
                "-i", file_path,
                "-vn",
                "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
                "-movflags", "+faststart",
                str(out_proxy),
            ]
            p_code, _, _ = run_cmd(p_cmd, timeout=30)
            has_proxy = p_code == 0 and out_proxy.exists()
    except Exception:
        has_proxy = False

    return {
        "mediaType": media_type,
        "width": width,
        "height": height,
        "duration": round(duration, 3),
        "hasAudio": a_stream is not None,
        "isVfr": is_vfr,
        "sourceFps": source_fps,
        "codec": codec_name or audio_codec,
        "pixFmt": pix_fmt,
        "hasThumb": thumb_path is not None,
        "hasProxy": has_proxy,
    }


def analyze_audio_beats(file_path: str) -> dict:
    sr = 11025
    hop = 256

    cmd = [
        FFMPEG_BIN, "-v", "error",
        "-i", file_path,
        "-vn",
        "-ac", "1",
        "-ar", str(sr),
        "-f", "s16le",
        "pipe:1",
    ]
    code, pcm_bytes, err = run_cmd(cmd, timeout=45)
    if code != 0 or len(pcm_bytes) < 512:
        raise RuntimeError(f"Audio decode failed: {err.decode('utf-8', 'ignore')}")

    samples = array.array("h")
    usable = len(pcm_bytes) - (len(pcm_bytes) % 2)
    samples.frombytes(pcm_bytes[:usable])

    total_samples = len(samples)
    duration = total_samples / float(sr)

    energies: list[float] = []
    peaks_raw: list[float] = []
    prev_val = 0
    for start in range(0, total_samples - hop, hop):
        acc = 0.0
        peak = 0
        for j in range(start, start + hop, 2):
            v = samples[j]
            diff = v - prev_val
            prev_val = v
            e = (v * v) * 0.65 + (diff * diff) * 0.35
            acc += e
            av = abs(v)
            if av > peak:
                peak = av
        energies.append(math.sqrt(acc / (hop // 2)))
        peaks_raw.append(peak / 32768.0)

    n_frames = len(energies)
    if n_frames < 8:
        return {
            "duration": round(duration, 3),
            "bpm": 120,
            "beats": [0.0],
            "waveform": [0.1] * 160,
        }

    flux: list[float] = [0.0] * n_frames
    for i in range(1, n_frames):
        d = math.log1p(energies[i]) - math.log1p(energies[i - 1])
        flux[i] = d if d > 0.0 else 0.0

    win = 14
    min_gap_frames = int(0.27 * sr / hop)
    flux_mean = sum(flux) / n_frames
    beats_frames: list[int] = []
    last_beat = -min_gap_frames

    for i in range(2, n_frames - 2):
        if i - last_beat < min_gap_frames:
            continue
        val = flux[i]
        if val <= flux_mean * 1.15:
            continue
        if val >= flux[i - 1] and val >= flux[i + 1] and val >= flux[i - 2] and val >= flux[i + 2]:
            lo = max(0, i - win)
            hi = min(n_frames, i + win + 1)
            local_avg = sum(flux[lo:hi]) / (hi - lo)
            if val > local_avg * 1.48 + 0.02:
                beats_frames.append(i)
                last_beat = i

    frame_dt = hop / float(sr)
    beats = [round(f * frame_dt, 3) for f in beats_frames]

    bpm = 120
    if len(beats) >= 4:
        votes: dict[int, float] = {}
        for k in range(1, len(beats)):
            dt = beats[k] - beats[k - 1]
            if dt <= 0.15 or dt > 2.2:
                continue
            cand = 60.0 / dt
            while cand < 75.0:
                cand *= 2.0
            while cand > 165.0:
                cand *= 0.5
            bucket = int(round(cand))
            for b in (bucket - 1, bucket, bucket + 1):
                w = 1.0 if b == bucket else 0.45
                votes[b] = votes.get(b, 0.0) + w
        if votes:
            bpm = max(votes.items(), key=lambda kv: kv[1])[0]

    if len(beats) < max(3, int(duration / 2.5)):
        step = 60.0 / max(75, bpm)
        offset = beats[0] if beats else 0.0
        grid = []
        t = offset
        while t < duration - 0.1:
            grid.append(round(t, 3))
            t += step
        beats = grid

    wf_bars = 220
    waveform: list[float] = []
    step_f = len(peaks_raw) / float(wf_bars)
    max_p = max(peaks_raw) or 1.0
    for b in range(wf_bars):
        a = int(b * step_f)
        z = max(a + 1, int((b + 1) * step_f))
        seg_max = max(peaks_raw[a:min(z, len(peaks_raw))])
        waveform.append(round(min(1.0, seg_max / max_p), 3))

    return {
        "duration": round(duration, 3),
        "bpm": int(bpm),
        "beats": beats,
        "waveform": waveform,
    }


def generate_sample_audio(out_path: Path, duration: float = 16.0, bpm: int = 120) -> None:
    sr = 22050
    total_samples = int(sr * duration)
    beat_sec = 60.0 / bpm
    samples = array.array("h")

    chords = [
        (220.00, 261.63, 329.63),
        (174.61, 220.00, 261.63),
        (130.81, 196.00, 261.63),
        (196.00, 246.94, 293.66),
    ]

    two_pi = 2.0 * math.pi
    for i in range(total_samples):
        t = i / float(sr)
        beat_idx = int(t / beat_sec)
        bt = t - beat_idx * beat_sec

        kick = 0.0
        if bt < 0.16:
            freq = 125.0 * math.exp(-bt * 24.0) + 46.0
            env = math.exp(-bt * 19.0)
            kick = math.sin(two_pi * freq * bt) * env * 0.62

        hat = 0.0
        ht = (t + beat_sec * 0.5) % beat_sec
        if ht < 0.045:
            n = math.sin(i * 12.9898) * 43758.5453
            noise = (n - math.floor(n)) * 2.0 - 1.0
            hat = noise * math.exp(-ht * 75.0) * 0.18

        chord = chords[(beat_idx // 4) % len(chords)]
        pad_env = min(1.0, t * 1.5) * min(1.0, (duration - t) * 1.2)
        pad = sum(math.sin(two_pi * f * t) for f in chord) / 3.0 * 0.24 * pad_env

        eighth = t % (beat_sec * 0.5)
        bass = math.sin(two_pi * (chord[0] * 0.5) * t) * math.exp(-eighth * 7.5) * 0.22

        val = kick + hat + pad + bass
        clamped = max(-0.96, min(0.96, val))
        samples.append(int(clamped * 32767))

    with wave.open(str(out_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(samples.tobytes())


def build_color_grade_filters(cg: dict | None) -> list[str]:
    if not isinstance(cg, dict) or not cg.get("enabled"):
        return []

    try:
        preset = str(cg.get("preset", "none"))
        exposure = safe_float(cg.get("exposure", 0.0), 0.0, -0.5, 0.5)
        contrast = safe_float(cg.get("contrast", 1.0), 1.0, 0.2, 2.5)
        saturation = safe_float(cg.get("saturation", 1.0), 1.0, 0.0, 2.5)
        gamma = safe_float(cg.get("gamma", 1.0), 1.0, 0.3, 2.5)
        temp = safe_float(cg.get("temperature", 0.0), 0.0, -0.6, 0.6)
        tint = safe_float(cg.get("tint", 0.0), 0.0, -0.6, 0.6)
        vignette = safe_float(cg.get("vignette", 0.0), 0.0, 0.0, 1.0)

        rs, gs, bs = 0.0, 0.0, 0.0
        rh, gh, bh = 0.0, 0.0, 0.0
        if preset == "cinematic_teal":
            bs += 0.14
            gs += 0.03
            rs -= 0.08
            rh += 0.12
            bh -= 0.10
            contrast = min(1.8, contrast * 1.12)
            saturation = max(0.0, saturation * 1.08)
        elif preset == "kodak_warm":
            rs += 0.07
            rh += 0.10
            bh -= 0.09
            gamma = min(1.8, gamma * 1.04)
            saturation = max(0.0, saturation * 1.12)
        elif preset == "mono_noir":
            saturation = 0.0
            contrast = min(1.8, contrast * 1.28)
            exposure -= 0.04
            vignette = max(vignette, 0.45)
        elif preset == "matte_fade":
            contrast = max(0.5, contrast * 0.86)
            exposure += 0.06
            saturation = max(0.0, saturation * 0.85)
            bs += 0.05
        elif preset == "vivid_hdr":
            contrast = min(1.8, contrast * 1.18)
            saturation = min(2.0, saturation * 1.32)

        rs += temp * 0.25
        rh += temp * 0.28
        bs -= temp * 0.25
        bh -= temp * 0.28
        gs += tint * 0.22
        gh += tint * 0.22

        def clamp_cb(x: float) -> float:
            return round(max(-0.85, min(0.85, x)), 3)

        filters: list[str] = []
        if (
            abs(exposure) > 0.005
            or abs(contrast - 1.0) > 0.005
            or abs(saturation - 1.0) > 0.005
            or abs(gamma - 1.0) > 0.005
        ):
            b_val = round(max(-0.5, min(0.5, exposure)), 3)
            c_val = round(max(0.2, min(2.5, contrast)), 3)
            s_val = round(max(0.0, min(2.5, saturation)), 3)
            g_val = round(max(0.3, min(2.5, gamma)), 3)
            filters.append(f"eq=brightness={b_val}:contrast={c_val}:saturation={s_val}:gamma={g_val}")

        if any(abs(v) > 0.008 for v in (rs, gs, bs, rh, gh, bh)):
            filters.append(
                f"colorbalance=rs={clamp_cb(rs)}:gs={clamp_cb(gs)}:bs={clamp_cb(bs)}"
                f":rh={clamp_cb(rh)}:gh={clamp_cb(gh)}:bh={clamp_cb(bh)}"
            )

        if vignette > 0.01:
            angle = round(max(0.05, min(1.2, vignette * 0.85)), 3)
            filters.append(f"vignette=angle={angle}")

        return filters
    except Exception:
        return []


def build_clip_effects_filters(fx: dict | None) -> list[str]:
    if not isinstance(fx, dict):
        return []

    try:
        filters: list[str] = []
        b = safe_float(fx.get("brightness", 0.0), 0.0, -0.5, 0.5)
        c = safe_float(fx.get("contrast", 1.0), 1.0, 0.2, 2.5)
        g = safe_float(fx.get("gamma", 1.0), 1.0, 0.3, 2.5)
        s = safe_float(fx.get("saturation", 1.0), 1.0, 0.0, 2.5)
        hue_deg = safe_float(fx.get("hue", 0.0), 0.0, -180.0, 180.0)
        grey = bool(fx.get("greyscale", False))

        if grey:
            s = 0.0

        if abs(b) > 0.005 or abs(c - 1.0) > 0.005 or abs(g - 1.0) > 0.005 or abs(s - 1.0) > 0.005:
            filters.append(
                f"eq=brightness={b:.3f}:contrast={c:.3f}:saturation={s:.3f}:gamma={g:.3f}"
            )

        if abs(hue_deg) > 0.5:
            filters.append(f"hue=h={hue_deg:.1f}")

        if fx.get("chromaKeyEnabled"):
            raw_col = str(fx.get("chromaKeyColor", "#00ff00")).lstrip("#")
            hex_col = raw_col if re.fullmatch(r"[0-9a-fA-F]{6}", raw_col) else "00ff00"
            sim = safe_float(fx.get("chromaKeySimilarity", 0.18), 0.18, 0.01, 0.85)
            blend = safe_float(fx.get("chromaKeyBlend", 0.08), 0.08, 0.0, 0.6)
            filters.append(f"chromakey=color=0x{hex_col}:similarity={sim:.3f}:blend={blend:.3f}")

        return filters
    except Exception:
        return []


def build_atempo_chain(speed: float) -> list[str]:
    sp = max(0.25, min(4.0, speed))
    if abs(sp - 1.0) < 0.01:
        return []
    chain: list[str] = []
    while sp < 0.5:
        chain.append("atempo=0.5")
        sp *= 2.0
    while sp > 2.0:
        chain.append("atempo=2.0")
        sp /= 2.0
    chain.append(f"atempo={sp:.4f}")
    return chain


def map_afade_curve(curve_name: str | None) -> str:
    c = str(curve_name or "scurve").lower()
    if c == "linear":
        return "tri"
    if c == "exp":
        return "exp"
    if c == "log":
        return "log"
    return "hsin"


def resolve_xfade_afade_curve(aclip: dict) -> str:
    explicit = aclip.get("audioCrossfadeCurve")
    if explicit in {"linear", "exp", "scurve", "log"}:
        return map_afade_curve(explicit)
    tr_type = str(aclip.get("audioTransitionOut", "cut"))
    if tr_type == "crossfade_lin":
        return "tri"
    if tr_type == "crossfade_exp":
        return "exp"
    return "hsin"


def build_audio_gain_filters(
    aclip: dict,
    clip_dur: float,
    track_mult: float,
    all_clips: list[dict],
    audio_track_map: dict[str, dict],
) -> list[str]:
    """
    Builds FFmpeg volume filter chain honoring clip base volume, track/folder gain,
    normalized volumeEnvelope ramps, and automatic backgroundDucking under foreground audio.
    Evaluated in clip-local time t in [0, clip_dur] before adelay.
    """
    filters: list[str] = []
    base_vol = safe_float(aclip.get("volume", 1.0), 1.0, 0.0, 2.0)
    raw_env = aclip.get("volumeEnvelope")
    env_pts = []
    if isinstance(raw_env, list) and len(raw_env) > 0:
        for p in raw_env:
            if isinstance(p, dict):
                env_pts.append({
                    "time": safe_float(p.get("time", 0.0), 0.0, 0.0, 1.0),
                    "gain": safe_float(p.get("gain", base_vol), base_vol, 0.0, 2.0),
                })
        env_pts.sort(key=lambda pt: pt["time"])

    use_dynamic = len(env_pts) >= 2
    if use_dynamic:
        first_g = env_pts[0]["gain"] * track_mult
        last_g = env_pts[-1]["gain"] * track_mult
        expr = f"{last_g:.4f}"
        for idx in range(len(env_pts) - 2, -1, -1):
            a = env_pts[idx]
            b = env_pts[idx + 1]
            t0 = a["time"] * clip_dur
            t1 = b["time"] * clip_dur
            ga = a["gain"] * track_mult
            gb = b["gain"] * track_mult
            span = max(1e-4, t1 - t0)
            u = f"clip((t-{t0:.4f})/{span:.4f}\\,0\\,1)"
            seg = f"({ga:.4f}+({gb - ga:.4f})*{u})"
            expr = f"if(lte(t\\,{t1:.4f})\\,{seg}\\,{expr})"
        expr = f"if(lte(t\\,{env_pts[0]['time'] * clip_dur:.4f})\\,{first_g:.4f}\\,{expr})"
    else:
        const_g = (env_pts[0]["gain"] if len(env_pts) == 1 else base_vol) * track_mult
        expr = f"{max(0.0, min(2.5, const_g)):.4f}"

    # Auto-duck BGM whenever non-ducked dialogue / SFX / video audio is active simultaneously
    duck_terms: list[str] = []
    if aclip.get("backgroundDucking"):
        duck_lvl = safe_float(aclip.get("duckLevel", 0.3), 0.3, 0.05, 0.95)
        clip_start = max(0.0, safe_float(aclip.get("startTime", 0.0), 0.0, 0.0, 36000.0))
        for other in all_clips:
            if other.get("id") == aclip.get("id") or other.get("muted"):
                continue
            otrk = audio_track_map.get(other.get("trackId", ""), {})
            oparent = audio_track_map.get(otrk.get("parentFolderId", ""), {}) if otrk.get("parentFolderId") else {}
            if otrk.get("muted") or oparent.get("muted"):
                continue
            is_fg = (
                (other.get("kind") == "video" and other.get("hasAudio"))
                or (other.get("kind") == "audio" and not other.get("backgroundDucking"))
            )
            if not is_fg:
                continue
            os = max(0.0, safe_float(other.get("startTime", 0.0), 0.0, 0.0, 36000.0))
            od = max(0.0, safe_float(other.get("duration", 0.0), 0.0, 0.0, 3600.0))
            ov_s = max(0.0, os - clip_start)
            ov_e = min(clip_dur, (os + od) - clip_start)
            if ov_e > ov_s + 0.02:
                duck_terms.append(f"between(t\\,{ov_s:.3f}\\,{ov_e:.3f})")

    if duck_terms:
        duck_lvl = safe_float(aclip.get("duckLevel", 0.3), 0.3, 0.05, 0.95)
        cond = "+".join(duck_terms[:16])
        expr = f"({expr})*if(gt(({cond})\\,0)\\,{duck_lvl:.3f}\\,1)"
        filters.append(f"volume='{expr}':eval=frame")
    elif use_dynamic:
        filters.append(f"volume='{expr}':eval=frame")
    else:
        const_val = float(expr)
        if abs(const_val - 1.0) > 0.01:
            filters.append(f"volume={const_val:.3f}")

    return filters


SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def validate_safe_id(val: object, label: str = "assetId") -> str:
    s = str(val or "").strip()
    if not SAFE_ID_RE.fullmatch(s):
        raise ValueError(f"Invalid {label}")
    return s


def resolve_media_path(media_id: str) -> Path:
    safe_id = validate_safe_id(media_id, "mediaId")
    matches = list(UPLOAD_DIR.glob(f"{safe_id}.*"))
    if not matches:
        raise FileNotFoundError(f"Media file not found: {safe_id}")
    return matches[0]


def make_even(n: int) -> int:
    return max(2, n - (n % 2))


def clip_has_keyframes(clip: dict) -> bool:
    kf = clip.get("keyframes")
    if not isinstance(kf, dict):
        return False
    for prop in ("opacity", "scale", "x", "y", "rotation"):
        pts = kf.get(prop)
        if isinstance(pts, list) and len(pts) > 0:
            return True
    return False


def _sorted_kf_points(kf: dict | None, prop: str) -> list[dict]:
    if not isinstance(kf, dict):
        return []
    raw = kf.get(prop)
    if not isinstance(raw, list) or len(raw) == 0:
        return []
    cleaned = []
    for p in raw:
        if not isinstance(p, dict):
            continue
        t_val = safe_float(p.get("time", 0.0), 0.0, 0.0, 1.0)
        v_val = float(p.get("value", 0.0)) if p.get("value") is not None else 0.0
        easing = str(p.get("easing", "linear"))
        if easing not in {"linear", "easeIn", "easeOut", "easeInOut"}:
            easing = "linear"
        cleaned.append({"time": t_val, "value": v_val, "easing": easing})
    cleaned.sort(key=lambda pt: pt["time"])
    return cleaned


def build_keyframe_ff_expr(
    points: list[dict],
    dur: float,
    t_expr: str,
    default_val: float,
    mul: float = 1.0,
    lo: float | None = None,
    hi: float | None = None,
) -> tuple[str, bool]:
    """
    Builds an FFmpeg expression for animated keyframe points over local clip duration.
    Returns (expr_string, is_time_varying). Commas are escaped (`\\,`) for -filter_complex.
    """
    def clamp_v(v: float) -> float:
        out = v * mul
        if lo is not None:
            out = max(lo, out)
        if hi is not None:
            out = min(hi, out)
        return out

    if not points:
        return f"{clamp_v(default_val):.5f}", False

    if len(points) == 1:
        return f"{clamp_v(points[0]['value']):.5f}", False

    first_v = clamp_v(points[0]["value"])
    last_v = clamp_v(points[-1]["value"])
    if all(abs(clamp_v(p["value"]) - first_v) < 1e-4 for p in points):
        return f"{first_v:.5f}", False

    expr = f"{last_v:.5f}"
    # Wrap backwards so the nested if(...) matches segments strictly in chronological order
    for idx in range(len(points) - 2, -1, -1):
        a = points[idx]
        b = points[idx + 1]
        t0 = a["time"] * dur
        t1 = b["time"] * dur
        va = clamp_v(a["value"])
        vb = clamp_v(b["value"])
        span = max(1e-4, t1 - t0)
        u = f"clip((({t_expr})-{t0:.4f})/{span:.4f}\\,0\\,1)"
        ease = a["easing"]
        if ease == "easeIn":
            f_u = f"pow({u}\\,2)"
        elif ease == "easeOut":
            f_u = f"(1-pow(1-({u})\\,2))"
        elif ease == "easeInOut":
            f_u = f"(3*pow({u}\\,2)-2*pow({u}\\,3))"
        else:
            f_u = u
        seg = f"({va:.5f}+({vb - va:.5f})*{f_u})"
        expr = f"if(lte({t_expr}\\,{t1:.4f})\\,{seg}\\,{expr})"

    expr = f"if(lte({t_expr}\\,{points[0]['time'] * dur:.4f})\\,{first_v:.5f}\\,{expr})"
    return expr, True


def render_job_worker(job_id: str, payload: dict) -> None:
    t0 = time.time()
    temp_files: list[Path] = []
    try:
        with JOBS_LOCK:
            JOBS[job_id]["status"] = "rendering"
            JOBS[job_id]["progress"] = 2

        tracks = payload.get("tracks", [])
        clips = payload.get("clips", [])
        export_cfg = payload.get("export", {})
        color_grade = payload.get("colorGrade", {})

        # Backwards compatibility if legacy 'slides' payload is ever passed
        if not tracks and payload.get("slides"):
            tracks = [
                {"id": "trk_v1", "name": "V1", "kind": "video", "muted": False, "solo": False, "hidden": False, "volume": 1},
                {"id": "trk_a1", "name": "A1", "kind": "audio", "muted": False, "solo": False, "hidden": False, "volume": 1},
            ]
            cursor = 0.0
            clips = []
            for s in payload["slides"]:
                dur = float(s.get("duration", 2.5))
                tdur = float(s.get("transitionDuration", 0.45)) if s.get("transition", "fade") != "cut" else 0.0
                clips.append({
                    "id": s["id"],
                    "trackId": "trk_v1",
                    "kind": s.get("type", "image"),
                    "mediaId": s["mediaId"],
                    "startTime": cursor,
                    "duration": dur,
                    "trimStart": float(s.get("trimStart", 0)),
                    "fit": s.get("fit", "cover"),
                    "scale": 1.0,
                    "x": 0.0,
                    "y": 0.0,
                    "rotation": 0.0,
                    "opacity": 1.0,
                    "motion": s.get("motion", "none"),
                    "transitionOut": s.get("transition", "fade"),
                    "transitionDuration": tdur,
                    "speed": 1.0,
                    "reverse": False,
                    "muted": s.get("muted", False),
                    "hasAudio": s.get("hasAudio", False),
                    "volume": 1.0,
                    "pan": 0.0,
                    "effects": {},
                })
                cursor += max(0.1, dur - tdur)
            for a in payload.get("audioClips", []):
                clips.append({**a, "trackId": "trk_a1", "kind": "audio", "speed": 1.0, "reverse": False, "pan": 0.0})

        if not clips:
            raise ValueError("Timeline has no clips to render.")

        res_str = export_cfg.get("resolution", "1920x1080")
        w_str, h_str = res_str.split("x")
        width = make_even(int(w_str))
        height = make_even(int(h_str))
        fps_expr, tb_expr, fps_num = resolve_fps_spec(export_cfg.get("fps", 30))
        fmt = export_cfg.get("format", "mp4").lower()
        if fmt not in {"mp4", "webm", "mov"}:
            fmt = "mp4"
        speed_preset = export_cfg.get("speedProfile", "veryfast")
        if speed_preset not in {"ultrafast", "veryfast", "fast", "medium"}:
            speed_preset = "veryfast"

        out_path = RENDER_DIR / f"obsidiancut_{job_id}.{fmt}"

        # Compute total timeline duration from visible/active clips
        total_duration = 0.0
        for c in clips:
            end_t = float(c.get("startTime", 0.0)) + max(0.2, float(c.get("duration", 1.0)))
            if end_t > total_duration:
                total_duration = end_t
        total_duration = max(0.5, round(total_duration, 3))

        cmd: list[str] = [
            FFMPEG_BIN,
            "-y",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-filter_complex_threads",
            "0",
            "-sws_flags",
            "fast_bilinear",
            "-progress",
            "pipe:1",
        ]
        filter_parts: list[str] = []

        # Lazy black master canvas stream: only synthesized when bottom track starts after t=0,
        # has gaps/transparency, or no full-frame opaque bottom track exists.
        base_label: str | None = None

        def ensure_base_canvas() -> str:
            nonlocal base_label
            if base_label is None:
                base_label = "base0"
                filter_parts.insert(
                    0,
                    f"color=c=black:s={width}x{height}:r={fps_expr}:d={total_duration:.3f},format=yuv420p,settb={tb_expr}[{base_label}]",
                )
            return base_label

        input_idx = 0
        audio_mix_labels: list[str] = []

        # Determine track ordering (UI lists top layers first; composite bottom-to-top)
        video_tracks = [t for t in tracks if t.get("kind") == "video" and not t.get("hidden")]
        video_tracks_bottom_up = list(reversed(video_tracks))

        audio_tracks = [t for t in tracks if t.get("kind") == "audio"]
        any_audio_solo = any(t.get("solo") for t in audio_tracks)
        audio_track_map = {t["id"]: t for t in audio_tracks}

        blank_png_bytes = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        )

        def prepare_visual_clip_input(clip: dict, c_idx: int, target_w: int, target_h: int, force_exact_box: bool) -> tuple[str, int, float, bool]:
            """
            Appends FFmpeg input args + filter chain for a visual/title clip.
            Returns (output_stream_label, input_index_used, timeline_dur, is_scrolling_credits).
            """
            nonlocal input_idx
            c_kind = clip.get("kind", "image")
            dur = max(0.2, safe_float(clip.get("duration", 2.5), 2.5, 0.2, 3600.0))
            speed = safe_float(clip.get("speed", 1.0), 1.0, 0.25, 4.0)
            reverse = bool(clip.get("reverse", False))
            trim_start = max(0.0, safe_float(clip.get("trimStart", 0.0), 0.0, 0.0, 36000.0))
            fit = clip.get("fit", "cover")
            motion = clip.get("motion", "none")
            scale_factor = safe_float(clip.get("scale", 1.0), 1.0, 0.08, 3.5)
            scale_x = safe_float(clip.get("scaleX", 1.0), 1.0, 0.15, 3.0)
            scale_y = safe_float(clip.get("scaleY", 1.0), 1.0, 0.15, 3.0)
            crop_cfg = clip.get("crop") if isinstance(clip.get("crop"), dict) else {}
            crop_l = safe_float(crop_cfg.get("left", 0.0), 0.0, 0.0, 0.9)
            crop_r = safe_float(crop_cfg.get("right", 0.0), 0.0, 0.0, 0.9)
            crop_t = safe_float(crop_cfg.get("top", 0.0), 0.0, 0.0, 0.9)
            crop_b = safe_float(crop_cfg.get("bottom", 0.0), 0.0, 0.0, 0.9)
            if crop_l + crop_r > 0.9:
                ex = (crop_l + crop_r - 0.9) / 2.0
                crop_l = max(0.0, crop_l - ex)
                crop_r = max(0.0, crop_r - ex)
            if crop_t + crop_b > 0.9:
                ex = (crop_t + crop_b - 0.9) / 2.0
                crop_t = max(0.0, crop_t - ex)
                crop_b = max(0.0, crop_b - ex)

            rot_deg = safe_float(clip.get("rotation", 0.0), 0.0, -360.0, 360.0)
            opacity = safe_float(clip.get("opacity", 1.0), 1.0, 0.0, 1.0)
            kf_map = clip.get("keyframes") if isinstance(clip.get("keyframes"), dict) else {}
            kf_scale_pts = _sorted_kf_points(kf_map, "scale")
            kf_rot_pts = _sorted_kf_points(kf_map, "rotation")
            kf_op_pts = _sorted_kf_points(kf_map, "opacity")
            kf_x_pts = _sorted_kf_points(kf_map, "x")
            kf_y_pts = _sorted_kf_points(kf_map, "y")

            scale_expr, scale_is_anim = build_keyframe_ff_expr(kf_scale_pts, dur, "t", scale_factor, 1.0, 0.08, 3.5)
            rot_expr, rot_is_anim = build_keyframe_ff_expr(kf_rot_pts, dur, "t", rot_deg, math.pi / 180.0, -6.2832, 6.2832)
            op_expr, op_is_anim = build_keyframe_ff_expr(kf_op_pts, dur, "T", opacity, 1.0, 0.0, 1.0)

            if len(kf_scale_pts) == 1:
                scale_factor = safe_float(kf_scale_pts[0]["value"], scale_factor, 0.08, 3.5)
            if len(kf_rot_pts) == 1:
                rot_deg = safe_float(kf_rot_pts[0]["value"], rot_deg, -360.0, 360.0)
            if len(kf_op_pts) == 1:
                opacity = safe_float(kf_op_pts[0]["value"], opacity, 0.0, 1.0)

            fade_in = safe_float(clip.get("fadeIn", 0.0), 0.0, 0.0, dur * 0.45)
            fade_out = safe_float(clip.get("fadeOut", 0.0), 0.0, 0.0, dur * 0.45)
            is_credits = False
            total_frames = max(2, int(round(dur * fps_num)))
            uses_zoompan = c_kind == "image" and motion in {"zoomIn", "zoomOut", "panLeft", "panRight"}

            cur_inp = input_idx
            has_anim_frames = False
            if c_kind == "title":
                overlay_frames = clip.get("renderedOverlayFrames")
                is_credits = (clip.get("title") or {}).get("template") == "scrolling_credits"
                if isinstance(overlay_frames, list) and len(overlay_frames) > 0 and not is_credits:
                    has_anim_frames = True
                    concat_lines = ["ffconcat version 1.0"]
                    last_frame_path: Path | None = None
                    for f_idx, fr in enumerate(overlay_frames):
                        f_png_b64 = fr.get("png", "") if isinstance(fr, dict) else ""
                        f_dur = max(0.015, safe_float(fr.get("duration", 0.05) if isinstance(fr, dict) else 0.05, 0.05, 0.015, 3600.0))
                        f_path = RENDER_DIR / f"_ov_{job_id}_{c_idx}_{f_idx}.png"
                        f_bytes = blank_png_bytes
                        if f_png_b64 and "," in f_png_b64:
                            try:
                                dec = base64.b64decode(f_png_b64.split(",", 1)[1])
                                if dec.startswith(b"\x89PNG\r\n\x1a\n"):
                                    f_bytes = dec
                            except Exception:
                                f_bytes = blank_png_bytes
                        f_path.write_bytes(f_bytes)
                        temp_files.append(f_path)
                        safe_p = str(f_path.resolve()).replace("\\", "/").replace("'", "\\'")
                        concat_lines.append(f"file '{safe_p}'")
                        concat_lines.append(f"duration {f_dur:.4f}")
                        last_frame_path = f_path
                    if last_frame_path is not None:
                        safe_last = str(last_frame_path.resolve()).replace("\\", "/").replace("'", "\\'")
                        concat_lines.append(f"file '{safe_last}'")
                    concat_path = RENDER_DIR / f"_ov_{job_id}_{c_idx}.ffconcat"
                    concat_path.write_text("\n".join(concat_lines) + "\n", encoding="utf-8")
                    temp_files.append(concat_path)
                    cmd.extend(["-f", "concat", "-safe", "0", "-i", str(concat_path)])
                else:
                    png_b64 = clip.get("renderedOverlayPng", "")
                    tmp_png = RENDER_DIR / f"_ov_{job_id}_{c_idx}.png"
                    png_bytes = blank_png_bytes
                    if png_b64 and "," in png_b64:
                        try:
                            decoded = base64.b64decode(png_b64.split(",", 1)[1])
                            if decoded.startswith(b"\x89PNG\r\n\x1a\n"):
                                png_bytes = decoded
                        except Exception:
                            png_bytes = blank_png_bytes
                    tmp_png.write_bytes(png_bytes)
                    temp_files.append(tmp_png)
                    cmd.extend(["-framerate", fps_expr, "-i", str(tmp_png)])
            elif c_kind == "image":
                m_path = resolve_media_path(clip["mediaId"])
                cmd.extend(["-framerate", fps_expr, "-i", str(m_path)])
            else:  # video
                m_path = resolve_media_path(clip["mediaId"])
                src_dur = dur * speed
                cmd.extend(["-fflags", "+genpts", "-ss", f"{trim_start:.3f}", "-t", f"{src_dur:.3f}", "-i", str(m_path)])

            input_idx += 1

            chain: list[str] = []
            # When scale is animated via keyframes, prepare at base 1.0 frame scale first so animated scale=eval=frame operates cleanly
            eff_static_scale = 1.0 if (force_exact_box or scale_is_anim) else scale_factor
            box_w = make_even(int(round(target_w * eff_static_scale)))
            box_h = make_even(int(round(target_h * eff_static_scale)))

            # Normalize VFR video to CFR first, and downscale BEFORE reverse to avoid buffering 4K frames in RAM
            if c_kind == "video":
                chain.append(f"fps={fps_expr},settb={tb_expr}")

            # Apply source crop before scaling / zoompan
            if (crop_l + crop_r + crop_t + crop_b) > 0.002 and not (c_kind == "title" and is_credits):
                cw_f = max(0.05, 1.0 - crop_l - crop_r)
                ch_f = max(0.05, 1.0 - crop_t - crop_b)
                chain.append(
                    f"crop=w=max(2\\,trunc(iw*{cw_f:.5f}/2)*2):h=max(2\\,trunc(ih*{ch_f:.5f}/2)*2):x=trunc(iw*{crop_l:.5f}):y=trunc(ih*{crop_t:.5f})"
                )

            if c_kind == "title":
                if is_credits:
                    if abs(scale_factor - 1.0) > 0.02 and not force_exact_box:
                        chain.append(f"scale={box_w}:-2")
                else:
                    chain.append(f"scale={box_w}:{box_h}:force_original_aspect_ratio=decrease")
            elif uses_zoompan:
                if motion == "zoomIn":
                    z_expr, x_expr, y_expr = f"1+0.12*on/{total_frames}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
                elif motion == "zoomOut":
                    z_expr, x_expr, y_expr = f"1.12-0.12*on/{total_frames}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
                elif motion == "panLeft":
                    z_expr, x_expr, y_expr = "1.10", f"(iw-iw/zoom)*(1-on/{total_frames})", "ih/2-(ih/zoom/2)"
                else:
                    z_expr, x_expr, y_expr = "1.10", f"(iw-iw/zoom)*(on/{total_frames})", "ih/2-(ih/zoom/2)"
                work_w = make_even(int(box_w * 1.06))
                work_h = make_even(int(box_h * 1.06))
                chain.append(f"scale={work_w}:{work_h}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop={work_w}:{work_h}")
                chain.append(f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}':d={total_frames}:s={box_w}x{box_h}:fps={fps_expr}")
                chain.append(f"fps={fps_expr},setpts=PTS-STARTPTS,settb={tb_expr}")
            elif fit == "contain" or not force_exact_box:
                if force_exact_box:
                    chain.append(f"scale={box_w}:{box_h}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad={box_w}:{box_h}:(ow-iw)/2:(oh-ih)/2:color=black")
                elif fit == "cover":
                    chain.append(f"scale={box_w}:{box_h}:force_original_aspect_ratio=increase:flags=fast_bilinear")
                else:
                    chain.append(f"scale={box_w}:{box_h}:force_original_aspect_ratio=decrease:flags=fast_bilinear")
            else:
                chain.append(f"scale={box_w}:{box_h}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop={box_w}:{box_h}")

            if not force_exact_box and (abs(scale_x - 1.0) > 0.01 or abs(scale_y - 1.0) > 0.01):
                chain.append(f"scale=max(2\\,trunc(iw*{scale_x:.4f}/2)*2):max(2\\,trunc(ih*{scale_y:.4f}/2)*2):flags=fast_bilinear")

            if c_kind == "video":
                if reverse:
                    chain.append("reverse")
                if abs(speed - 1.0) > 0.01:
                    chain.append(f"setpts=(PTS-STARTPTS)/{speed:.4f},fps={fps_expr},settb={tb_expr}")
                else:
                    chain.append("setpts=PTS-STARTPTS")

            # Individual picture/clip color grading + digital video effects
            clip_cg = clip.get("colorGrade")
            if isinstance(clip_cg, dict) and clip_cg.get("enabled"):
                chain.extend(build_color_grade_filters(clip_cg))
            chain.extend(build_clip_effects_filters(clip.get("effects")))

            fusion_cfg = clip.get("fusion")
            if isinstance(fusion_cfg, dict) and fusion_cfg.get("enabled"):
                glow_amt = safe_float(fusion_cfg.get("glowAmount", 0.0), 0.0, 0.0, 1.0)
                if glow_amt > 0.05:
                    chain.append(f"eq=brightness={min(0.18, glow_amt * 0.12):.3f}:contrast={1.0 + glow_amt * 0.08:.3f}")

            if force_exact_box:
                chain.append("format=yuv420p,setsar=1")
                if not op_is_anim and opacity < 0.99:
                    chain.append(f"colorchannelmixer=rr={opacity:.3f}:gg={opacity:.3f}:bb={opacity:.3f}")
            else:
                chain.append("format=yuva420p,setsar=1")
                if not rot_is_anim and abs(rot_deg) > 0.2:
                    rad = rot_deg * math.pi / 180.0
                    chain.append(f"rotate={rad:.5f}:ow='rotw({rad:.5f})':oh='roth({rad:.5f})':c=none")
                if not op_is_anim and opacity < 0.99:
                    chain.append(f"colorchannelmixer=aa={opacity:.3f}")

            # For static images and single-PNG titles, expand frames BEFORE time-based keyframe animations;
            # animated title sequences already carry per-frame durations from ffconcat.
            if has_anim_frames:
                chain.append(f"fps={fps_expr},setpts=PTS-STARTPTS,settb={tb_expr}")
            elif c_kind in {"image", "title"} and not uses_zoompan:
                chain.append(f"loop=loop={max(0, total_frames - 1)}:size=1:start=0")
                chain.append(f"setpts=N/(({fps_expr})*TB),fps={fps_expr},settb={tb_expr}")

            out_lbl = f"vc{c_idx}"
            if force_exact_box:
                if fade_in > 0.03:
                    chain.append(f"fade=t=in:st=0:d={fade_in:.3f}")
                if fade_out > 0.03:
                    fo_st = max(0.0, dur - fade_out)
                    chain.append(f"fade=t=out:st={fo_st:.3f}:d={fade_out:.3f}")
                filter_parts.append(f"[{cur_inp}:v]{','.join(chain)}[{out_lbl}]")
            else:
                tail_chain: list[str] = []
                if scale_is_anim:
                    tail_chain.append(
                        f"scale=w='max(2\\,trunc((iw*({scale_expr}))/2)*2)':h='max(2\\,trunc((ih*({scale_expr}))/2)*2)':eval=frame"
                    )
                if rot_is_anim:
                    tail_chain.append(f"rotate=a='{rot_expr}':ow='hypot(iw\\,ih)':oh='hypot(iw\\,ih)':c=none")
                if fade_in > 0.03:
                    tail_chain.append(f"fade=t=in:st=0:d={fade_in:.3f}:alpha=1")
                if fade_out > 0.03:
                    fo_st = max(0.0, dur - fade_out)
                    tail_chain.append(f"fade=t=out:st={fo_st:.3f}:d={fade_out:.3f}:alpha=1")

                if op_is_anim:
                    # Fast animated alpha modulation: evaluate opacity on a 2x2 mask, scale via neighbor, multiply with existing alpha
                    preop_lbl = f"preop{c_idx}"
                    sp_a = f"opa{c_idx}"
                    sp_b = f"opb{c_idx}"
                    a0_lbl = f"a0_{c_idx}"
                    m2_lbl = f"m2_{c_idx}"
                    ms_lbl = f"ms_{c_idx}"
                    ref_lbl = f"ref_{c_idx}"
                    am_lbl = f"am_{c_idx}"
                    mask_dur = dur + (4.0 / fps_num)
                    filter_parts.append(f"[{cur_inp}:v]{','.join(chain)}[{preop_lbl}]")
                    filter_parts.append(f"[{preop_lbl}]split[{sp_a}][{sp_b}]")
                    filter_parts.append(f"[{sp_a}]alphaextract[{a0_lbl}]")
                    filter_parts.append(
                        f"color=c=white:s=2x2:r={fps_expr}:d={mask_dur:.3f},format=gray,geq=lum='255*({op_expr})'[{m2_lbl}]"
                    )
                    filter_parts.append(f"[{m2_lbl}][{sp_b}]scale2ref=flags=neighbor[{ms_lbl}][{ref_lbl}]")
                    filter_parts.append(f"[{a0_lbl}][{ms_lbl}]blend=all_mode=multiply:shortest=1[{am_lbl}]")
                    tail_str = ("," + ",".join(tail_chain)) if tail_chain else ""
                    filter_parts.append(f"[{ref_lbl}][{am_lbl}]alphamerge{tail_str}[{out_lbl}]")
                else:
                    chain.extend(tail_chain)
                    filter_parts.append(f"[{cur_inp}:v]{','.join(chain)}[{out_lbl}]")

            return out_lbl, cur_inp, dur, is_credits

        clip_counter = 0

        # Composite each visible video track bottom-to-top
        for trk in video_tracks_bottom_up:
            is_bottom_video_track = trk is video_tracks_bottom_up[0]
            trk_clips = sorted(
                [c for c in clips if c.get("trackId") == trk["id"] and c.get("kind") in {"image", "video", "title"}],
                key=lambda c: float(c.get("startTime", 0.0)),
            )
            if not trk_clips:
                continue

            # Group touching/overlapping full-frame clips that have xfade transitions into sequences
            i = 0
            while i < len(trk_clips):
                seq = [trk_clips[i]]
                while i + 1 < len(trk_clips):
                    prev_c = seq[-1]
                    next_c = trk_clips[i + 1]
                    prev_end = float(prev_c.get("startTime", 0)) + float(prev_c.get("duration", 0))
                    next_start = float(next_c.get("startTime", 0))
                    t_type, t_dur = extract_clip_transition(prev_c)
                    prev_transparent = (
                        float(prev_c.get("opacity", 1.0)) < 0.99
                        or float(prev_c.get("fadeIn", 0.0)) > 0.03
                        or float(prev_c.get("fadeOut", 0.0)) > 0.03
                    )
                    next_transparent = (
                        float(next_c.get("opacity", 1.0)) < 0.99
                        or float(next_c.get("fadeIn", 0.0)) > 0.03
                        or float(next_c.get("fadeOut", 0.0)) > 0.03
                    )
                    can_xfade = (
                        t_type != "cut"
                        and t_dur >= 0.05
                        and (is_bottom_video_track or (not prev_transparent and not next_transparent))
                        and prev_c.get("kind") != "title"
                        and next_c.get("kind") != "title"
                        and abs(float(prev_c.get("scale", 1.0)) - 1.0) < 0.02
                        and abs(float(next_c.get("scale", 1.0)) - 1.0) < 0.02
                        and abs(float(prev_c.get("scaleX", 1.0) or 1.0) - 1.0) < 0.02
                        and abs(float(next_c.get("scaleX", 1.0) or 1.0) - 1.0) < 0.02
                        and abs(float(prev_c.get("scaleY", 1.0) or 1.0) - 1.0) < 0.02
                        and abs(float(next_c.get("scaleY", 1.0) or 1.0) - 1.0) < 0.02
                        and abs(float(prev_c.get("x", 0.0))) < 0.5
                        and abs(float(next_c.get("x", 0.0))) < 0.5
                        and abs(float(prev_c.get("y", 0.0))) < 0.5
                        and abs(float(next_c.get("y", 0.0))) < 0.5
                        and abs(float(prev_c.get("rotation", 0.0))) < 0.2
                        and abs(float(next_c.get("rotation", 0.0))) < 0.2
                        and not (prev_c.get("effects") or {}).get("chromaKeyEnabled")
                        and not (next_c.get("effects") or {}).get("chromaKeyEnabled")
                        and not clip_has_keyframes(prev_c)
                        and not clip_has_keyframes(next_c)
                        and (prev_end - next_start) >= -0.08
                    )
                    if can_xfade:
                        seq.append(next_c)
                        i += 1
                    else:
                        break

                if len(seq) > 1:
                    seq_start = max(0.0, float(seq[0].get("startTime", 0.0)))
                    seq_labels: list[str] = []
                    seq_durs: list[float] = []
                    for sc in seq:
                        lbl, inp_used, s_dur, _ = prepare_visual_clip_input(sc, clip_counter, width, height, True)
                        clip_counter += 1
                        seq_labels.append(lbl)
                        seq_durs.append(s_dur)

                        # Video audio for this clip (input already seeked via -ss trim_start, master 48kHz sync)
                        if sc.get("kind") == "video" and sc.get("hasAudio") and not sc.get("muted") and not trk.get("muted"):
                            a_lbl = f"va{len(audio_mix_labels)}"
                            sc_start = max(0.0, float(sc.get("startTime", 0.0)))
                            sc_speed = safe_float(sc.get("speed", 1.0), 1.0, 0.25, 4.0)
                            a_chain = [
                                f"atrim=duration={s_dur * sc_speed:.3f}",
                                "asetpts=PTS-STARTPTS",
                                "aresample=async=1:min_hard_comp=0.100000:first_pts=0",
                                "aformat=sample_rates=48000:channel_layouts=stereo",
                            ]
                            if sc.get("reverse"):
                                a_chain.append("areverse")
                            a_chain.extend(build_atempo_chain(sc_speed))
                            track_mult = safe_float(float(trk.get("volume", 1.0)), 1.0, 0.0, 2.0)
                            a_chain.extend(build_audio_gain_filters(sc, s_dur, track_mult, clips, audio_track_map))
                            v_pan = safe_float(sc.get("pan", 0.0), 0.0, -1.0, 1.0)
                            if abs(v_pan) > 0.02:
                                l_gain = max(0.0, min(1.0, 1.0 - max(0.0, v_pan)))
                                r_gain = max(0.0, min(1.0, 1.0 + min(0.0, v_pan)))
                                a_chain.append(f"pan=stereo|c0={l_gain:.3f}*c0|c1={r_gain:.3f}*c1")
                            v_curve = map_afade_curve(sc.get("audioFadeCurve", "scurve"))
                            v_fi = safe_float(sc.get("fadeIn", 0.0), 0.0, 0.0, s_dur * 0.48)
                            v_fo = safe_float(sc.get("fadeOut", 0.0), 0.0, 0.0, s_dur * 0.48)
                            if v_fi > 0.02:
                                a_chain.append(f"afade=t=in:st=0:d={v_fi:.3f}:curve={v_curve}")
                            if v_fo > 0.02:
                                a_chain.append(f"afade=t=out:st={max(0.0, s_dur - v_fo):.3f}:d={v_fo:.3f}:curve={v_curve}")
                            d_ms = int(round(sc_start * 1000))
                            if d_ms > 0:
                                a_chain.append(f"adelay={d_ms}|{d_ms}")
                            filter_parts.append(f"[{inp_used}:a]{','.join(a_chain)}[{a_lbl}]")
                            audio_mix_labels.append(f"[{a_lbl}]")

                    prev_lbl = seq_labels[0]
                    cum_len = seq_durs[0]
                    for j in range(len(seq) - 1):
                        t_type, raw_td = extract_clip_transition(seq[j])
                        if t_type == "cut":
                            t_type = "fade"
                        t_dur = round(max(1.0 / fps_num, min(raw_td, seq_durs[j] * 0.45, seq_durs[j + 1] * 0.45)), 3)
                        prev_clip_end = seq_start + cum_len
                        next_clip_start = max(seq_start, float(seq[j + 1].get("startTime", prev_clip_end)))
                        actual_overlap = max(0.0, prev_clip_end - next_clip_start)
                        missing_overlap = round(max(0.0, t_dur - actual_overlap), 3)
                        if missing_overlap >= (0.5 / fps_num):
                            pad_lbl = f"xp{clip_counter}_{j}"
                            filter_parts.append(
                                f"[{prev_lbl}]tpad=stop_mode=clone:stop_duration={missing_overlap:.3f}[{pad_lbl}]"
                            )
                            prev_lbl = pad_lbl
                            cum_len += missing_overlap
                        offset = max(0.0, round(cum_len - t_dur, 3))
                        out_xf = f"xf{clip_counter}_{j}"
                        filter_parts.append(
                            f"[{prev_lbl}][{seq_labels[j + 1]}]xfade=transition={t_type}:duration={t_dur:.3f}:offset={offset:.3f}[{out_xf}]"
                        )
                        prev_lbl = out_xf
                        cum_len = offset + seq_durs[j + 1]

                    seq_end = round(seq_start + cum_len, 3)
                    if base_label is None and is_bottom_video_track and seq_start <= 0.04:
                        if seq_end < total_duration - 0.04:
                            pad_lbl = f"b_{clip_counter}"
                            tail_pad = round(max(0.05, total_duration - seq_end + (2.0 / fps_num)), 3)
                            filter_parts.append(
                                f"[{prev_lbl}]tpad=stop_mode=add:stop_duration={tail_pad:.3f}:color=black,fps={fps_expr},settb={tb_expr}[{pad_lbl}]"
                            )
                            base_label = pad_lbl
                        else:
                            base_label = prev_lbl
                    else:
                        cur_base = ensure_base_canvas()
                        shifted_lbl = f"sh{clip_counter}"
                        filter_parts.append(f"[{prev_lbl}]setpts=PTS-STARTPTS+{seq_start:.3f}/TB[{shifted_lbl}]")
                        next_base = f"b_{clip_counter}"
                        filter_parts.append(
                            f"[{cur_base}][{shifted_lbl}]overlay=0:0:enable='between(t,{seq_start:.3f},{seq_end:.3f})':eof_action=pass[{next_base}]"
                        )
                        base_label = next_base
                else:
                    sc = seq[0]
                    c_start = max(0.0, float(sc.get("startTime", 0.0)))
                    can_direct_bottom = (
                        base_label is None
                        and is_bottom_video_track
                        and c_start <= 0.04
                        and sc.get("kind") != "title"
                        and float(sc.get("opacity", 1.0)) >= 0.99
                        and abs(float(sc.get("scale", 1.0)) - 1.0) < 0.02
                        and abs(float(sc.get("scaleX", 1.0) or 1.0) - 1.0) < 0.02
                        and abs(float(sc.get("scaleY", 1.0) or 1.0) - 1.0) < 0.02
                        and abs(float(sc.get("x", 0.0))) < 0.5
                        and abs(float(sc.get("y", 0.0))) < 0.5
                        and abs(float(sc.get("rotation", 0.0))) < 0.2
                        and not (sc.get("effects") or {}).get("chromaKeyEnabled")
                        and not clip_has_keyframes(sc)
                    )
                    lbl, inp_used, c_dur, is_credits = prepare_visual_clip_input(
                        sc, clip_counter, width, height, can_direct_bottom
                    )
                    clip_counter += 1
                    c_end = round(c_start + c_dur, 3)

                    if sc.get("kind") == "video" and sc.get("hasAudio") and not sc.get("muted") and not trk.get("muted"):
                        a_lbl = f"va{len(audio_mix_labels)}"
                        sc_speed = safe_float(sc.get("speed", 1.0), 1.0, 0.25, 4.0)
                        a_chain = [
                            f"atrim=duration={c_dur * sc_speed:.3f}",
                            "asetpts=PTS-STARTPTS",
                            "aresample=async=1:min_hard_comp=0.100000:first_pts=0",
                            "aformat=sample_rates=48000:channel_layouts=stereo",
                        ]
                        if sc.get("reverse"):
                            a_chain.append("areverse")
                        a_chain.extend(build_atempo_chain(sc_speed))
                        track_mult = safe_float(float(trk.get("volume", 1.0)), 1.0, 0.0, 2.0)
                        a_chain.extend(build_audio_gain_filters(sc, c_dur, track_mult, clips, audio_track_map))
                        v_pan = safe_float(sc.get("pan", 0.0), 0.0, -1.0, 1.0)
                        if abs(v_pan) > 0.02:
                            l_gain = max(0.0, min(1.0, 1.0 - max(0.0, v_pan)))
                            r_gain = max(0.0, min(1.0, 1.0 + min(0.0, v_pan)))
                            a_chain.append(f"pan=stereo|c0={l_gain:.3f}*c0|c1={r_gain:.3f}*c1")
                        v_curve = map_afade_curve(sc.get("audioFadeCurve", "scurve"))
                        v_fi = safe_float(sc.get("fadeIn", 0.0), 0.0, 0.0, c_dur * 0.48)
                        v_fo = safe_float(sc.get("fadeOut", 0.0), 0.0, 0.0, c_dur * 0.48)
                        if v_fi > 0.02:
                            a_chain.append(f"afade=t=in:st=0:d={v_fi:.3f}:curve={v_curve}")
                        if v_fo > 0.02:
                            a_chain.append(f"afade=t=out:st={max(0.0, c_dur - v_fo):.3f}:d={v_fo:.3f}:curve={v_curve}")
                        d_ms = int(round(c_start * 1000))
                        if d_ms > 0:
                            a_chain.append(f"adelay={d_ms}|{d_ms}")
                        filter_parts.append(f"[{inp_used}:a]{','.join(a_chain)}[{a_lbl}]")
                        audio_mix_labels.append(f"[{a_lbl}]")

                    if can_direct_bottom and not is_credits:
                        if c_end < total_duration - 0.04:
                            pad_lbl = f"b_{clip_counter}"
                            tail_pad = round(max(0.05, total_duration - c_end + (2.0 / fps_num)), 3)
                            filter_parts.append(
                                f"[{lbl}]tpad=stop_mode=add:stop_duration={tail_pad:.3f}:color=black,fps={fps_expr},settb={tb_expr}[{pad_lbl}]"
                            )
                            base_label = pad_lbl
                        else:
                            base_label = lbl
                    else:
                        cur_base = ensure_base_canvas()
                        shifted_lbl = f"sh{clip_counter}"
                        filter_parts.append(f"[{lbl}]setpts=PTS-STARTPTS+{c_start:.3f}/TB[{shifted_lbl}]")

                        fusion_cfg = sc.get("fusion") if isinstance(sc.get("fusion"), dict) else {}
                        trk_off_x = safe_float(fusion_cfg.get("trackOffsetX", 0.0), 0.0, -50.0, 50.0) if fusion_cfg.get("enabled") else 0.0
                        trk_off_y = safe_float(fusion_cfg.get("trackOffsetY", 0.0), 0.0, -50.0, 50.0) if fusion_cfg.get("enabled") else 0.0
                        x_pct = safe_float(sc.get("x", 0.0), 0.0, -100.0, 100.0) / 100.0
                        y_pct = safe_float(sc.get("y", 0.0), 0.0, -100.0, 100.0) / 100.0
                        sc_kf = sc.get("keyframes") if isinstance(sc.get("keyframes"), dict) else {}
                        ov_x_expr, ov_x_anim = build_keyframe_ff_expr(
                            _sorted_kf_points(sc_kf, "x"), c_dur, f"(t-{c_start:.3f})", x_pct * 100.0, 0.01, -1.0, 1.0
                        )
                        ov_y_expr, ov_y_anim = build_keyframe_ff_expr(
                            _sorted_kf_points(sc_kf, "y"), c_dur, f"(t-{c_start:.3f})", y_pct * 100.0, 0.01, -1.0, 1.0
                        )
                        x_expr = f"(W-w)/2+((({ov_x_expr})+{trk_off_x / 100.0:.4f})*W)"
                        if is_credits:
                            y_expr = f"H-((t-{c_start:.3f})/{c_dur:.3f})*(H+h)"
                        else:
                            y_expr = f"(H-h)/2+((({ov_y_expr})+{trk_off_y / 100.0:.4f})*H)"

                        next_base = f"b_{clip_counter}"
                        filter_parts.append(
                            f"[{cur_base}][{shifted_lbl}]overlay=x='{x_expr}':y='{y_expr}':enable='between(t,{c_start:.3f},{c_end:.3f})':eof_action=pass[{next_base}]"
                        )
                        base_label = next_base

                i += 1

        # Master Color Grading Plug-in & final CFR fps normalization
        last_video_label = ensure_base_canvas()
        cg_filters = build_color_grade_filters(color_grade)
        if cg_filters:
            graded_lbl = "vgraded"
            filter_parts.append(f"[{last_video_label}]{','.join(cg_filters)},fps={fps_expr},format=yuv420p[{graded_lbl}]")
            last_video_label = graded_lbl
        elif last_video_label != "base0":
            fmt_lbl = "vfmt"
            filter_parts.append(f"[{last_video_label}]fps={fps_expr},format=yuv420p[{fmt_lbl}]")
            last_video_label = fmt_lbl

        # Process dedicated Audio Track clips on unified 48kHz master clock (honoring folder hierarchy, mute, solo, envelopes, ducking, transitions & Fairlight DSP)
        audio_clips = sorted(
            [c for c in clips if c.get("kind") == "audio"],
            key=lambda c: float(c.get("startTime", 0.0)),
        )
        audio_by_track: dict[str, list[dict]] = {}
        for c in audio_clips:
            audio_by_track.setdefault(c.get("trackId", ""), []).append(c)

        for a_idx, aclip in enumerate(audio_clips):
            trk = audio_track_map.get(aclip.get("trackId", ""), {})
            parent_folder = audio_track_map.get(trk.get("parentFolderId", ""), {}) if trk.get("parentFolderId") else {}
            if trk.get("muted") or parent_folder.get("muted") or aclip.get("muted"):
                continue
            if any_audio_solo and not (trk.get("solo") or parent_folder.get("solo")):
                continue

            start_time = max(0.0, safe_float(aclip.get("startTime", 0.0), 0.0, 0.0, 36000.0))
            if start_time >= total_duration:
                continue

            a_path = resolve_media_path(aclip["mediaId"])
            trim_start = max(0.0, safe_float(aclip.get("trimStart", 0.0), 0.0, 0.0, 36000.0))
            clip_dur = max(0.1, min(safe_float(aclip.get("duration", 10.0), 10.0, 0.1, 3600.0), total_duration - start_time))
            speed = safe_float(aclip.get("speed", 1.0), 1.0, 0.25, 4.0)
            src_dur = clip_dur * speed
            folder_vol = safe_float(parent_folder.get("volume", 1.0), 1.0, 0.0, 2.0) if parent_folder else 1.0
            track_mult = safe_float(float(trk.get("volume", 1.0)) * folder_vol, 1.0, 0.0, 2.5)
            pan = safe_float(aclip.get("pan", 0.0), 0.0, -1.0, 1.0)
            fade_in = safe_float(aclip.get("fadeIn", 0.0), 0.0, 0.0, clip_dur * 0.48)
            fade_out = safe_float(aclip.get("fadeOut", 0.0), 0.0, 0.0, clip_dur * 0.48)
            fade_curve = map_afade_curve(aclip.get("audioFadeCurve", "scurve"))

            # Check adjacent clips on same track for audio transition crossfades
            same_trk_clips = audio_by_track.get(aclip.get("trackId", ""), [])
            pos_in_trk = next((i for i, item in enumerate(same_trk_clips) if item.get("id") == aclip.get("id")), -1)
            in_tr_dur = 0.0
            in_tr_curve = "hsin"
            in_tr_type = "cut"
            if pos_in_trk > 0:
                prev_a = same_trk_clips[pos_in_trk - 1]
                prev_end = float(prev_a.get("startTime", 0.0)) + float(prev_a.get("duration", 0.0))
                if (start_time - prev_end) <= 0.25 and prev_a.get("audioTransitionOut", "cut") != "cut":
                    raw_td = safe_float(prev_a.get("audioTransitionDuration", 1.2), 1.2, 0.1, 5.0)
                    in_tr_dur = min(clip_dur * 0.85, raw_td)
                    in_tr_type = str(prev_a.get("audioTransitionOut", "crossfade_eq"))
                    in_tr_curve = resolve_xfade_afade_curve(prev_a)

            out_tr_dur = 0.0
            out_tr_curve = "hsin"
            out_tr_type = "cut"
            if pos_in_trk >= 0 and pos_in_trk + 1 < len(same_trk_clips):
                next_a = same_trk_clips[pos_in_trk + 1]
                next_start = float(next_a.get("startTime", 0.0))
                if (next_start - (start_time + clip_dur)) <= 0.25 and aclip.get("audioTransitionOut", "cut") != "cut":
                    raw_td = safe_float(aclip.get("audioTransitionDuration", 1.2), 1.2, 0.1, 5.0)
                    out_tr_dur = min(clip_dur * 0.85, raw_td)
                    out_tr_type = str(aclip.get("audioTransitionOut", "crossfade_eq"))
                    out_tr_curve = resolve_xfade_afade_curve(aclip)

            cmd.extend(["-i", str(a_path)])
            a_lbl = f"am{a_idx}"
            a_chain = [
                f"atrim=start={trim_start:.3f}:duration={src_dur:.3f}",
                "asetpts=PTS-STARTPTS",
                "aresample=async=1:min_hard_comp=0.100000:first_pts=0",
                "aformat=sample_rates=48000:channel_layouts=stereo",
            ]
            if aclip.get("reverse"):
                a_chain.append("areverse")
            a_chain.extend(build_atempo_chain(speed))
            a_chain.extend(build_track_dsp_filters(trk.get("audioDsp")))
            a_chain.extend(build_audio_gain_filters(aclip, clip_dur, track_mult, clips, audio_track_map))
            if abs(pan) > 0.02:
                l_gain = max(0.0, min(1.0, 1.0 - max(0.0, pan)))
                r_gain = max(0.0, min(1.0, 1.0 + min(0.0, pan)))
                a_chain.append(f"pan=stereo|c0={l_gain:.3f}*c0|c1={r_gain:.3f}*c1")
            if fade_in > 0.02:
                a_chain.append(f"afade=t=in:st=0:d={fade_in:.3f}:curve={fade_curve}")
            if fade_out > 0.02:
                fo_st = max(0.0, clip_dur - fade_out)
                a_chain.append(f"afade=t=out:st={fo_st:.3f}:d={fade_out:.3f}:curve={fade_curve}")
            if in_tr_dur > 0.05:
                if in_tr_type == "dip_swell":
                    a_chain.append(
                        f"volume='if(lte(t\\,{in_tr_dur:.3f})\\,0.15+0.85*0.5*(1-cos(PI*t/{in_tr_dur:.3f}))\\,1)':eval=frame"
                    )
                else:
                    a_chain.append(f"afade=t=in:st=0:d={in_tr_dur:.3f}:curve={in_tr_curve}")
            if out_tr_dur > 0.05:
                tr_st = max(0.0, clip_dur - out_tr_dur)
                if out_tr_type == "dip_swell":
                    a_chain.append(
                        f"volume='if(gte(t\\,{tr_st:.3f})\\,0.15+0.85*0.5*(1+cos(PI*(t-{tr_st:.3f})/{out_tr_dur:.3f}))\\,1)':eval=frame"
                    )
                else:
                    a_chain.append(f"afade=t=out:st={tr_st:.3f}:d={out_tr_dur:.3f}:curve={out_tr_curve}")
            d_ms = int(round(start_time * 1000))
            if d_ms > 0:
                a_chain.append(f"adelay={d_ms}|{d_ms}")

            filter_parts.append(f"[{input_idx}:a]{','.join(a_chain)}[{a_lbl}]")
            audio_mix_labels.append(f"[{a_lbl}]")
            input_idx += 1

        has_final_audio = len(audio_mix_labels) > 0
        if has_final_audio:
            master_norm = bool(export_cfg.get("normalizeAudio"))
            master_lufs = safe_float(export_cfg.get("normalizeTargetLufs", -14.0), -14.0, -30.0, -5.0)
            norm_tail = (
                f",loudnorm=I={master_lufs:.1f}:TP=-1.5:LRA=11,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo"
                if master_norm
                else ""
            )
            if len(audio_mix_labels) == 1:
                single = audio_mix_labels[0].strip("[]")
                filter_parts.append(
                    f"[{single}]apad=whole_dur={total_duration:.3f},atrim=0:{total_duration:.3f},asetpts=PTS-STARTPTS{norm_tail}[aout]"
                )
            else:
                filter_parts.append(
                    f"{''.join(audio_mix_labels)}amix=inputs={len(audio_mix_labels)}:duration=longest:dropout_transition=0:normalize=0,"
                    f"apad=whole_dur={total_duration:.3f},atrim=0:{total_duration:.3f},asetpts=PTS-STARTPTS{norm_tail}[aout]"
                )

        cmd.extend(["-filter_complex", ";".join(filter_parts)])
        cmd.extend(["-map", f"[{last_video_label}]"])
        if has_final_audio:
            cmd.extend(["-map", "[aout]"])

        if fmt == "webm":
            cmd.extend(["-c:v", "libvpx", "-b:v", "6M", "-deadline", "realtime", "-cpu-used", "6"])
            if has_final_audio:
                cmd.extend(["-c:a", "libvorbis", "-b:a", "192k"])
        else:
            if speed_preset == "ultrafast":
                x264_preset = "ultrafast"
                crf = "22"
            elif speed_preset in {"veryfast", "superfast"}:
                x264_preset = "superfast"
                crf = "21"
            else:
                x264_preset = "fast"
                crf = "19"
            cmd.extend(["-c:v", "libx264", "-preset", x264_preset, "-crf", crf, "-pix_fmt", "yuv420p"])
            if has_final_audio:
                cmd.extend(["-c:a", "aac", "-b:a", "192k", "-ar", "48000"])
            if fmt == "mp4":
                cmd.extend(["-movflags", "+faststart"])

        cmd.extend(["-r", fps_expr, "-vsync", "cfr", "-max_muxing_queue_size", "2048", "-t", f"{total_duration:.3f}", "-threads", "0", str(out_path)])

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )

        stderr_chunks: deque[str] = deque(maxlen=120)

        def drain_stderr():
            if proc.stderr:
                for err_line in proc.stderr:
                    stderr_chunks.append(err_line[:400])

        err_thread = threading.Thread(target=drain_stderr, daemon=True)
        err_thread.start()

        last_speed = ""
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("out_time_us="):
                try:
                    us = int(line.split("=", 1)[1])
                    pct = int(min(99, max(3, (us / 1_000_000.0 / total_duration) * 100.0)))
                    with JOBS_LOCK:
                        JOBS[job_id]["progress"] = pct
                except ValueError:
                    pass
            elif line.startswith("speed="):
                last_speed = line.split("=", 1)[1].strip()
                with JOBS_LOCK:
                    JOBS[job_id]["speed"] = last_speed

        proc.wait()
        err_thread.join(timeout=2.0)
        stderr_out = "".join(stderr_chunks)[-8192:]
        if proc.returncode != 0 or not out_path.exists():
            raise RuntimeError(stderr_out.strip() or f"FFmpeg exited with code {proc.returncode}")

        elapsed_ms = int((time.time() - t0) * 1000)
        size_bytes = out_path.stat().st_size

        with JOBS_LOCK:
            JOBS[job_id].update({
                "status": "completed",
                "progress": 100,
                "speed": last_speed or "done",
                "elapsedMs": elapsed_ms,
                "outputPath": str(out_path),
                "outputName": f"obsidiancut_export_{job_id[:8]}.{fmt}",
                "outputSize": size_bytes,
                "format": fmt,
            })

    except Exception as exc:
        with JOBS_LOCK:
            JOBS[job_id].update({
                "status": "failed",
                "error": str(exc),
                "elapsedMs": int((time.time() - t0) * 1000),
            })
    finally:
        for tf in temp_files:
            try:
                if tf.exists():
                    tf.unlink()
            except Exception:
                pass


class EngineHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args) -> None:
        pass

    def _send_json(self, code: int, data: dict) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/health":
            self._send_json(200, {"ok": True, "engine": "python-ffmpeg", "platform": os.name})
            return

        if path.startswith("/render/"):
            parts = path.strip("/").split("/")
            job_id = parts[1] if len(parts) >= 2 else ""
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                job_copy = dict(job) if job else None

            if not job_copy:
                self._send_json(404, {"error": "Render job not found"})
                return

            if len(parts) == 3 and parts[2] == "download":
                out_path = Path(job_copy.get("outputPath", ""))
                if job_copy.get("status") != "completed" or not out_path.exists():
                    self._send_json(409, {"error": "Render output not ready"})
                    return

                qs = urllib.parse.parse_qs(parsed.query)
                inline = qs.get("inline", ["0"])[0] == "1"
                fmt = job_copy.get("format", "mp4")
                mime = {
                    "mp4": "video/mp4",
                    "webm": "video/webm",
                    "mov": "video/quicktime",
                }.get(fmt, "application/octet-stream")

                file_size = out_path.stat().st_size
                range_hdr = self.headers.get("Range")
                max_chunk = 8 * 1024 * 1024
                out_name = job_copy.get("outputName", "obsidiancut_export.mp4")
                if range_hdr and file_size > 0:
                    m = re.match(r"bytes=(\d+)-(\d*)", range_hdr.strip())
                    if m:
                        start = int(m.group(1))
                        raw_end = int(m.group(2)) if m.group(2) else file_size - 1
                        end = min(raw_end, start + max_chunk - 1, file_size - 1)
                        if start >= file_size or start > end:
                            self.send_response(416)
                            self.send_header("Content-Range", f"bytes */{file_size}")
                            self.send_header("Content-Length", "0")
                            self.end_headers()
                            return
                        length = end - start + 1
                        self.send_response(206)
                        self.send_header("Content-Type", mime)
                        self.send_header("Accept-Ranges", "bytes")
                        self.send_header("Cache-Control", "no-store")
                        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                        self.send_header("Content-Length", str(length))
                        if not inline:
                            self.send_header("Content-Disposition", f'attachment; filename="{out_name}"')
                        self.end_headers()
                        with open(out_path, "rb") as f:
                            f.seek(start)
                            remaining = length
                            while remaining > 0:
                                chunk = f.read(min(65536, remaining))
                                if not chunk:
                                    break
                                self.wfile.write(chunk)
                                remaining -= len(chunk)
                        return

                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(file_size))
                if not inline:
                    self.send_header(
                        "Content-Disposition",
                        f'attachment; filename="{out_name}"',
                    )
                self.end_headers()
                with open(out_path, "rb") as f:
                    shutil.copyfileobj(f, self.wfile, length=65536)
                return

            job_copy.pop("outputPath", None)
            self._send_json(200, job_copy)
            return

        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            body = self._read_json()
        except Exception as exc:
            self._send_json(400, {"error": f"Invalid JSON: {exc}"})
            return

        if path == "/probe":
            try:
                file_path = body.get("filePath")
                asset_id = validate_safe_id(body.get("assetId"), "assetId")
                if not isinstance(file_path, str) or not file_path.strip() or not Path(file_path).is_file():
                    self._send_json(400, {"error": "Invalid or missing filePath"})
                    return
                meta = probe_media(file_path, asset_id)
                if meta["mediaType"] == "audio":
                    audio_info = analyze_audio_beats(file_path)
                    meta.update(audio_info)
                self._send_json(200, meta)
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return

        if path == "/analyze-audio":
            try:
                asset_id = validate_safe_id(body.get("assetId"), "assetId")
                m_path = resolve_media_path(asset_id)
                info = analyze_audio_beats(str(m_path))
                self._send_json(200, info)
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            except FileNotFoundError as exc:
                self._send_json(404, {"error": str(exc)})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return

        if path == "/generate-sample-audio":
            try:
                raw_id = body.get("assetId")
                asset_id = validate_safe_id(raw_id, "assetId") if raw_id is not None else uuid.uuid4().hex[:12]
                out_wav = UPLOAD_DIR / f"{asset_id}.wav"
                generate_sample_audio(out_wav, duration=16.0, bpm=120)
                meta = probe_media(str(out_wav), asset_id)
                audio_info = analyze_audio_beats(str(out_wav))
                meta.update(audio_info)
                meta["assetId"] = asset_id
                meta["filePath"] = str(out_wav)
                self._send_json(200, meta)
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return

        if path == "/render":
            if not isinstance(body, dict) or (
                not (isinstance(body.get("clips"), list) and len(body["clips"]) > 0)
                and not (isinstance(body.get("slides"), list) and len(body["slides"]) > 0)
            ):
                self._send_json(400, {"error": "Render payload requires a non-empty clips array"})
                return
            job_id = uuid.uuid4().hex[:12]
            with JOBS_LOCK:
                JOBS[job_id] = {
                    "jobId": job_id,
                    "status": "queued",
                    "progress": 0,
                    "speed": "",
                    "elapsedMs": 0,
                    "createdAt": time.time(),
                }
            EXECUTOR.submit(render_job_worker, job_id, body)
            self._send_json(202, {"jobId": job_id, "status": "queued"})
            return

        self._send_json(404, {"error": "Not found"})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), EngineHandler)
    print(f"[Obsidian Cut Python Engine] listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
