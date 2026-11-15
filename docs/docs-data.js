/**
 * Structured knowledge base for the Obsidian Cut documentation website.
 * Edit this file to update module descriptions, installation commands, API references,
 * math parity mappings, or keyboard shortcuts on your website.
 */
window.OBSIDIAN_DOCS_DATA = {
  modules: [
    // Root & Gateway
    {
      path: "run.sh",
      layer: "backend",
      badge: "Launcher",
      summary: "One-command POSIX startup script that checks for node_modules (running npm install --legacy-peer-deps if missing) and boots the Node gateway + Python engine on http://localhost:3000.",
      symbols: ["bash", "npm install --legacy-peer-deps", "npm run dev"]
    },
    {
      path: "server.ts",
      layer: "backend",
      badge: "Express Gateway",
      summary: "Unified Node.js / Express + Vite server on port 3000. Spawns and monitors backend/engine.py on 127.0.0.1:3001, handles multipart uploads (Multer up to 100 files / 1GB each), streams HTTP 206 Partial Content byte ranges, validates safe asset/job IDs, and serves the React SPA.",
      symbols: ["resolvePythonCommand", "startPythonEngine", "streamFileWithRange", "callPythonJson", "/api/render", "/api/media/upload"]
    },
    {
      path: "backend/engine.py",
      layer: "backend",
      badge: "Python NLE",
      summary: "Zero-external-dependency Python 3 + FFmpeg processing server. Probes VFR/CFR metadata, builds 480p CFR H.264 video & 1280px JPEG photo proxies, extracts 220-bin waveforms and spectral-flux BPM beat markers, and compiles full FFmpeg filter_complex DAGs with keyframes, transitions, ducking, EQ, and loudnorm.",
      symbols: ["probe_media", "analyze_audio_beats", "build_color_grade_filters", "build_audio_gain_filters", "build_keyframe_ff_expr", "render_job_worker"]
    },
    {
      path: "package.json",
      layer: "backend",
      badge: "Config",
      summary: "Defines React 19, Vite 8, Tailwind CSS v4, Lucide icons, Express 4, Multer 2, and npm scripts (dev, start, build, lint).",
      symbols: ["dev: tsx server.ts", "start: node server.ts --prod", "build: vite build", "lint: tsc --noEmit"]
    },

    // Core Frontend State & Types
    {
      path: "src/App.tsx",
      layer: "frontend",
      badge: "Root State",
      summary: "Top-level workspace orchestrator managing 4 modes (auto, manual, advanced, quickrender), 60-step undo/redo history, Boundless Tracks state, project JSON save/load, background render polling, Dark/Light theme, and keyboard shuttle shortcuts.",
      symbols: ["mode", "advancedTab", "commitHistory", "handleAutoAssemble", "handleAutoSelectQuickRender", "handleStartRender"]
    },
    {
      path: "src/types/editor.ts",
      layer: "math",
      badge: "Schema",
      summary: "Authoritative TypeScript schema for MediaAsset, TimelineTrack, TimelineClip, ClipKeyframesMap, AudioVolumePoint, TrackAudioDsp, FusionVfxSpec, TitleSpec, ExportConfig, ColorGradeConfig, and all 30 FFmpeg xfade TransitionOptions.",
      symbols: ["MediaAsset", "TimelineClip", "TimelineTrack", "ClipKeyframesMap", "TrackAudioDsp", "TRANSITION_OPTIONS"]
    },
    {
      path: "src/index.css",
      layer: "frontend",
      badge: "Styling",
      summary: "Tailwind CSS v4 entry configuration, Light/Dark class theme overrides, tabular monospace utilities, and custom range slider styles.",
      symbols: ["@import tailwindcss", ".studio-slider", ".font-mono-tabular"]
    },

    // Math, Audio & Sandbox Utilities
    {
      path: "src/utils/timelineMath.ts",
      layer: "math",
      badge: "Core Math",
      summary: "Deterministic timeline evaluation engine mirrored 1:1 by backend/engine.py. Handles Fusion keyframe easing, volume envelopes, fade curves, auto-ducking, stereo dBFS/LUFS metering, 36 Hz–15.5 kHz DSP spectrum bands, crop boxes, clip splitting/ripple/roll/slip/extract, Auto Sync assembly, and Quick Render Auto-Select.",
      symbols: ["evaluateAnimatedClipProps", "evaluateAudioClipGain", "computeStereoMetersAtTime", "computeAudioSpectrumBands", "autoAssembleTimeline", "autoBuildQuickRenderTimeline"]
    },
    {
      path: "src/utils/waveformCache.ts",
      layer: "audio",
      badge: "PCM Cache",
      summary: "Client-side Web Audio API decodeAudioData cache that downloads audio files once per URL and extracts 1,600 asymmetric min, max, and RMS bins for razor-sharp zoomed timeline waveform editing.",
      symbols: ["DecodedWaveformPeaks", "getCachedWaveformPeaks", "loadDecodedWaveformPeaks"]
    },
    {
      path: "src/utils/liveAudioSpectrum.ts",
      layer: "audio",
      badge: "FFT Bus",
      summary: "Decoupled singleton Web Audio AnalyserNode bridge allowing 60fps Canvas RTA visualizers to poll 512-bin FFT frequency data mapped logarithmically across 32 Hz–16.5 kHz without triggering React state re-renders.",
      symbols: ["registerAudioAnalyser", "unregisterAudioAnalyser", "sampleLiveFftSpectrum"]
    },
    {
      path: "src/utils/titleRenderer.ts",
      layer: "math",
      badge: "Vector Titles",
      summary: "Draws vector motion titles (Main Cinema Title, Lower Third, Subtitle, Vector Crest, Scrolling Credits) onto 2D Canvas and exports transparent PNGs so FFmpeg composites exact typography.",
      symbols: ["drawVectorTitle", "renderTitleToExportPng"]
    },
    {
      path: "src/utils/pluginSandbox.ts",
      layer: "math",
      badge: "Fault Guard",
      summary: "Sanitizes clip effect ranges and color grade bounds while isolating per-frame Canvas plug-in passes so a faulty filter never crashes live preview.",
      symbols: ["sanitizeClipEffects", "sanitizeColorGrade", "runSandboxedCanvasStage"]
    },

    // Timeline, Preview & Quick Render Components
    {
      path: "src/components/TimelineEditor.tsx",
      layer: "frontend",
      badge: "Boundless NLE",
      summary: "Multi-track timeline editor with unlimited vertical Overlay (OL), Video (V), and Audio (A) tracks, freeform Rough Cut toggle, top/bottom auto-stack drop zones, curved fade masks, rubber-band audio volume draggers, diamond envelope nodes, and seam transition badges.",
      symbols: ["startClipDrag", "startAudioFadeDrag", "insertAudioEnvelopePoint", "beatMarkers", "horizonSec"]
    },
    {
      path: "src/components/PreviewCanvas.tsx",
      layer: "frontend",
      badge: "2D Compositor",
      summary: "Real-time HTML5 2D Canvas compositor + synchronized Web Audio playback pool (MediaElementSource -> GainNode -> StereoPannerNode -> MasterGain -> AnalyserNode). Includes direct canvas resize/crop handles, master stereo meter, and collapsible RTA Spectrum drawer.",
      symbols: ["renderFrame", "syncAudioAtTime", "startLayerDrag", "analyserNodeRef"]
    },
    {
      path: "src/components/QuickRenderPage.tsx",
      layer: "frontend",
      badge: "Fast Export",
      summary: "Dedicated streamlined export page with Auto-Select Everything presets (transitions, opacity fades, looped/ducked music), platform render presets (720p/1080p/Reels/Square), Audio Normalizer, live Stereo Meter + Master Spectrum, and embedded finished video playback.",
      symbols: ["QUICK_PRESETS", "normalizeAllAudioClips", "onAutoSelectQuickRender"]
    },
    {
      path: "src/components/MediaBin.tsx",
      layer: "frontend",
      badge: "Ingest UI",
      summary: "Drag-and-drop media library supporting 80+ photo, video, and audio formats, built-in 120 BPM Sample Pack loader, live search, asset color-grade launcher, and Vector Title builder.",
      symbols: ["handleUploadFiles", "onAddVisualToTimeline", "onOpenAssetColorGrade"]
    },
    {
      path: "src/components/ClipInspectorPanel.tsx",
      layer: "frontend",
      badge: "Inspector",
      summary: "Right-hand property panel for transform/crop, opacity fades, speed/reverse, Chroma Key, 30 transitions, music layer presets, interactive Waveform Volume Curve editor, and Per-Picture vs Master Color Grading.",
      symbols: ["volumeEnvelope", "backgroundDucking", "computeClipNormalizeGain", "ColorGradingPlugin"]
    },

    // Audio Visualization & Fairlight Post-Production
    {
      path: "src/components/AudioClipWaveform.tsx",
      layer: "audio",
      badge: "Waveform Canvas",
      summary: "High-DPI canvas renderer for timeline audio clips. Slices clip/asset waveform metadata or cached PCM peaks by [trimStart, trimStart + duration * speed], flips when reversed, draws outer peak + inner RMS core + 0 dB centerline, highlights near-clip peaks, and plots trimmed beat ticks.",
      symbols: ["sampleLinear", "decodedPeaks", "evaluateAudioEnvelopeGain", "applyAudioFadeCurve"]
    },
    {
      path: "src/components/AudioSpectrumVisualizer.tsx",
      layer: "audio",
      badge: "RTA Visualizer",
      summary: "Hardware-grade 28–48 band logarithmic Audio Spectrum Analyzer (36 Hz–15.5 kHz) with Bars, Curve (Area), and Mirror modes, peak-hold caps, dBFS grid, and seamless LIVE FFT + DSP timeline blending.",
      symbols: ["Bars", "Curve", "Mirror", "sampleLiveFftSpectrum", "computeAudioSpectrumBands"]
    },
    {
      path: "src/components/AudioMeterBar.tsx",
      layer: "audio",
      badge: "dBFS Meter",
      summary: "Reusable horizontal and vertical Stereo L/R Peak/RMS dBFS meter bar (-48 dB to 0 dB gradient) with 900ms peak-hold bars and hot/clipping alerts.",
      symbols: ["dbToMeterFraction", "peakL", "peakR", "clipping"]
    },
    {
      path: "src/components/FairlightAudioStudio.tsx",
      layer: "audio",
      badge: "Fairlight DAW",
      summary: "Full audio post-production suite featuring Folder-Track submix buses, multi-track faders with L/R meters, Fairlight Master RTA Spectrum, Clip Crossfade Editor (Linear / Exponential / S-Curve with overlap & seam audition), 3-band EQ, Compressor/Limiter, VST3 slots, LUFS normalizer, and ADR Booth.",
      symbols: ["applyCrossfadeToPair", "overlapPairToDuration", "normalizeAllAudioClips", "startAdrRecording"]
    },

    // Fusion, MultiMaster & Modals
    {
      path: "src/components/FusionVfxStudio.tsx",
      layer: "frontend",
      badge: "Fusion VFX",
      summary: "Node-based VFX workspace combining the Keyframe Animation Controller, 3D Particle emitter (Embers, Snow, Stardust, Sparks), interactive polygon Rotoscoping mask, planar Camera Tracker, and Krokodove motion overlays.",
      symbols: ["drawKrokodoveOverlay", "rotoscopePoints", "particlePreset"]
    },
    {
      path: "src/components/KeyframeGraphEditor.tsx",
      layer: "math",
      badge: "Spline Graph",
      summary: "Visual keyframe curve editor for animating Opacity, Scale, Position X/Y, and Rotation across clip duration with draggable diamond nodes, easing selectors (Linear, Ease In, Ease Out, Ease In/Out), and motion presets.",
      symbols: ["KEYFRAME_PROPERTY_META", "evaluateKeyframeTrack", "applyKeyframeEasing"]
    },
    {
      path: "src/components/MultiMasterEditStudio.tsx",
      layer: "frontend",
      badge: "MultiMaster",
      summary: "Precision finishing studio offering 5 trim modes (Pointer, Ripple, Roll, Slip, Slide), Mark In/Out extraction, Compound Nested Sequences, Multi-Cam angle switching, Power Bins, and rule-based Smart Bins.",
      symbols: ["TrimMode", "NestedSequence", "PowerBin", "SmartBinRule"]
    },
    {
      path: "src/components/TransitionLibraryPanel.tsx",
      layer: "frontend",
      badge: "Transitions",
      summary: "Grouped visual browser for all 30 FFmpeg xfade transitions with one-click single-clip or Apply-to-All timeline assignment.",
      symbols: ["TRANSITION_GROUPS", "TRANSITION_OPTIONS"]
    },
    {
      path: "src/components/ColorGradingPlugin.tsx",
      layer: "frontend",
      badge: "Color Grade",
      summary: "Per-picture and Master Timeline color grading rack (Exposure, Contrast, Saturation, Gamma, Temperature, Tint, Vignette + 5 film LUT presets) with Before/After bypass toggle.",
      symbols: ["resolveEffectiveColorGrade", "ColorPreset"]
    },
    {
      path: "src/components/TitleStyleControls.tsx",
      layer: "frontend",
      badge: "Typography",
      summary: "Vector title template, font family (Sans, Display, Serif, Mono), alignment, scale, and hex color controls shared across Media Bin and Inspector.",
      symbols: ["TITLE_FONT_OPTIONS", "TitleSpec"]
    },
    {
      path: "src/components/AutoModeBar.tsx",
      layer: "frontend",
      badge: "Auto Sync",
      summary: "One-click Beat Sync configuration bar choosing music bed, beat stride (1, 2, 4, Fit Song), transition family, and Ken Burns motion.",
      symbols: ["AutoAssembleOptions"]
    },
    {
      path: "src/components/ExportModal.tsx",
      layer: "frontend",
      badge: "Export Dialog",
      summary: "Full render configuration modal (720p–4K UHD, 23.976–60 fps, MP4/MOV/WebM, Ultrafast/Veryfast/Medium, EBU R128 Audio Normalizer) with background progress tracking.",
      symbols: ["ExportConfig", "RenderJobStatus"]
    },
    {
      path: "src/components/TutorialModal.tsx",
      layer: "frontend",
      badge: "Walkthrough",
      summary: "Built-in 7-step interactive onboarding tour linking directly into Sample Pack loading and workspace modes.",
      symbols: ["TutorialModal"]
    },

    // autoengine CLI
    {
      path: "autoengine/cli.py",
      layer: "cli",
      badge: "HJSON CLI",
      summary: "Command-line entry point (`python -m autoengine`) supporting `validate`, `run`, `--dry-run`, `--only`, `--workers`, `--server`, and JSON batch reports.",
      symbols: ["main", "cmd_validate", "cmd_run"]
    },
    {
      path: "autoengine/wrapper.py",
      layer: "cli",
      badge: "Batch Engine",
      summary: "Parallel batch orchestrator (`ObsidianAutoEngine`) supporting declarative `mode: auto` (beat-synced slideshows/globs) and `mode: timeline` (multi-track JSON) locally via backend/engine.py or remotely via HTTP.",
      symbols: ["ObsidianAutoEngine", "run_batch_from_hjson", "render_video"]
    },
    {
      path: "autoengine/hjson_parser.py",
      layer: "cli",
      badge: "Parser",
      summary: "Zero-dependency HJSON parser supporting `#`, `//`, and `/* */` comments, trailing commas, unquoted object keys, and multiline strings.",
      symbols: ["loads", "load"]
    }
  ],

  parityMap: [
    {
      feature: "Fusion Keyframe Curves",
      frontend: "evaluateAnimatedClipProps() in src/utils/timelineMath.ts",
      backend: "build_keyframe_ff_expr() -> eval=frame scale/rotate/geq/overlay in backend/engine.py"
    },
    {
      feature: "Audio Volume Envelopes",
      frontend: "evaluateAudioEnvelopeGain() piecewise interpolation",
      backend: "build_audio_gain_filters() -> piecewise linear volume='...':eval=frame"
    },
    {
      feature: "Auto-Ducking BGM",
      frontend: "evaluateAudioClipGain() foreground overlap check",
      backend: "between(t, ov_s, ov_e) attenuation injected into FFmpeg volume expr"
    },
    {
      feature: "Fade Curves & Crossfades",
      frontend: "applyAudioFadeCurve() (scurve / linear / exp / log)",
      backend: "map_afade_curve() -> FFmpeg afade curve=hsin|tri|exp|log & synchronized clip seams"
    },
    {
      feature: "Audio Normalizer (LUFS)",
      frontend: "computeClipNormalizeGain() & computeStereoMetersAtTime()",
      backend: "FFmpeg loudnorm=I=-14|-16|-23:TP=-1.5:LRA=11 per-track & master 48kHz bus"
    },
    {
      feature: "Color Grading LUTs",
      frontend: "resolveEffectiveColorGrade() + PreviewCanvas pixel pass",
      backend: "build_color_grade_filters() -> FFmpeg eq, colorbalance, hue, vignette"
    },
    {
      feature: "Video Transitions (30x)",
      frontend: "resolveFfmpegXfadeFilter() + Canvas composite alpha/wipes",
      backend: "FFmpeg xfade=transition=<name>:duration=<d>:offset=<off> with rational CFR"
    }
  ],

  endpoints: [
    {
      method: "GET",
      path: "/api/health",
      summary: "Check Express gateway and Python FFmpeg engine readiness & platform.",
      response: '{\n  "ok": true,\n  "node": true,\n  "python": { "ok": true, "engine": "python-ffmpeg", "platform": "posix" }\n}',
      curl: "curl -s http://localhost:3000/api/health"
    },
    {
      method: "GET",
      path: "/api/media",
      summary: "Return all imported MediaAsset records including resolution, FPS, VFR flag, BPM, beats[], waveform[], and proxy URLs.",
      response: '{ "assets": [ { "id": "a1b2c3d4", "mediaType": "audio", "bpm": 120, "waveform": [0.42, 0.88] } ] }',
      curl: "curl -s http://localhost:3000/api/media"
    },
    {
      method: "POST",
      path: "/api/media/upload",
      summary: "Upload up to 100 images, videos, or audio files via multipart/form-data field `files` (max 1GB per file). Triggers ffprobe, proxy transcoding, thumbnailing, BPM & 220-bin waveform extraction.",
      response: '{ "assets": [ ... ], "rejected": [] }',
      curl: 'curl -X POST http://localhost:3000/api/media/upload \\\n  -F "files=@./clip1.mp4" \\\n  -F "files=@./soundtrack.mp3"'
    },
    {
      method: "PATCH",
      path: "/api/media/:id/color-grade",
      summary: "Persist per-picture ColorGradeConfig on a stored asset so Media Bin & Timeline clips stay synced.",
      response: '{ "asset": { "id": "a1b2c3d4", "colorGrade": { "enabled": true, "preset": "cinematic_teal" } } }',
      curl: 'curl -X PATCH http://localhost:3000/api/media/a1b2c3d4/color-grade \\\n  -H "Content-Type: application/json" \\\n  -d \'{"colorGrade":{"enabled":true,"preset":"cinematic_teal","exposure":0.04,"contrast":1.12,"saturation":1.08,"gamma":1,"temperature":-0.05,"tint":0.02,"vignette":0.25}}\''
    },
    {
      method: "DELETE",
      path: "/api/media/:id",
      summary: "Delete stored upload, generated proxy, and thumbnail files from .obsidiancut_data/ and update assets.json.",
      response: '{ "deleted": "a1b2c3d4" }',
      curl: "curl -X DELETE http://localhost:3000/api/media/a1b2c3d4"
    },
    {
      method: "POST",
      path: "/api/sample-pack",
      summary: "Generate built-in HD sample photos + synthesized 120 BPM WAV audio track so users can preview and edit immediately.",
      response: '{ "assets": [ ...4 sample assets... ] }',
      curl: "curl -X POST http://localhost:3000/api/sample-pack"
    },
    {
      method: "GET",
      path: "/api/media/thumb/:id",
      summary: "Serve JPEG preview thumbnail generated during ingest.",
      response: "image/jpeg binary stream",
      curl: "curl -s -o thumb.jpg http://localhost:3000/api/media/thumb/a1b2c3d4"
    },
    {
      method: "GET",
      path: "/api/media/proxy/:id",
      summary: "Stream lightweight editing proxy (480p CFR H.264 / 1280px JPEG) with HTTP 206 Partial Content byte-range seeking.",
      response: "HTTP 200 / 206 byte range stream",
      curl: "curl -I -H 'Range: bytes=0-1023' http://localhost:3000/api/media/proxy/a1b2c3d4"
    },
    {
      method: "GET",
      path: "/api/media/file/:id",
      summary: "Stream untouched original master upload with HTTP 206 Range support (also used by AudioClipWaveform Web Audio PCM decoder).",
      response: "HTTP 200 / 206 original media stream",
      curl: "curl -I http://localhost:3000/api/media/file/a1b2c3d4"
    },
    {
      method: "POST",
      path: "/api/audio/analyze",
      summary: "Re-run spectral flux beat detection and 220-bin waveform peak extraction for an existing audio assetId.",
      response: '{ "duration": 16.0, "bpm": 120, "beats": [0.5, 1.0], "waveform": [...] }',
      curl: 'curl -X POST http://localhost:3000/api/audio/analyze \\\n  -H "Content-Type: application/json" \\\n  -d \'{"assetId":"a1b2c3d4"}\''
    },
    {
      method: "POST",
      path: "/api/render",
      summary: "Enqueue an asynchronous Python + FFmpeg multi-track render job containing tracks, clips, colorGrade, and export config (returns HTTP 202 Accepted).",
      response: '{ "jobId": "9f8e7d6c5b4a", "status": "queued" }',
      curl: 'curl -X POST http://localhost:3000/api/render \\\n  -H "Content-Type: application/json" \\\n  -d \'{"tracks":[],"clips":[],"export":{"resolution":"1920x1080","fps":30,"format":"mp4","speedProfile":"veryfast","normalizeAudio":true,"normalizeTargetLufs":-14}}\''
    },
    {
      method: "GET",
      path: "/api/render/:jobId",
      summary: "Poll async job status (`queued`, `rendering`, `completed`, `failed`), percentage progress, FFmpeg encoding speed, and output metadata.",
      response: '{ "jobId": "9f8e7d6c5b4a", "status": "completed", "progress": 100, "speed": "3.4x", "outputSize": 2481920 }',
      curl: "curl -s http://localhost:3000/api/render/9f8e7d6c5b4a"
    },
    {
      method: "GET",
      path: "/api/render/:jobId/download",
      summary: "Download rendered MP4/MOV/WebM (`?inline=1` serves inline HTTP 206 byte ranges for embedded <video> playback).",
      response: "video/mp4 | video/quicktime | video/webm",
      curl: "curl -L -o output.mp4 http://localhost:3000/api/render/9f8e7d6c5b4a/download"
    }
  ],

  installGuides: {
    runsh: {
      title: "Fastest Launch — Bundled run.sh (Linux / macOS / WSL)",
      note: "Checks whether node_modules exists, runs npm install --legacy-peer-deps automatically if missing, then launches Node + Python on port 3000.",
      commands: `chmod +x run.sh\n./run.sh`,
      codeTitle: "run.sh",
      rawCode: `#!/usr/bin/env bash\ncd "$(dirname "$0")"\n\nif [ ! -d "node_modules" ]; then\n  echo "Installing dependencies..."\n  npm install --legacy-peer-deps\nfi\n\necho "Starting Obsidian Cut → http://localhost:3000"\nnpm run dev`
    },
    linux: {
      title: "Ubuntu / Debian / WSL2 Installation",
      note: "Python uses only the built-in standard library — zero pip packages required. Ensure ffmpeg and ffprobe are on PATH.",
      commands: `# 1. Install system tools (FFmpeg, Python 3, Node.js)\nsudo apt update && sudo apt install -y ffmpeg python3 nodejs npm\n\n# 2. Verify prerequisites\nnode -v       # v20+ recommended\npython3 --version\nffmpeg -version\n\n# 3. Install & start Obsidian Cut\n./run.sh`
    },
    windows: {
      title: "Windows 10 / 11 PowerShell Installation",
      note: "server.ts automatically checks PYTHON_BIN, python, py -3, and python3 and handles Windows SIGBREAK shutdown cleanly.",
      commands: `# 1. Install FFmpeg & Python 3.12 via Winget (Node.js 20+ required)\nwinget install Gyan.FFmpeg Python.Python.3.12 OpenJS.NodeJS.LTS\n\n# 2. Restart PowerShell so PATH refreshes, then verify:\nffmpeg -version\npython --version\n\n# 3. Install npm packages & run\nnpm install --legacy-peer-deps\nnpm run dev`
    },
    macos: {
      title: "macOS (Homebrew) Installation",
      note: "Works on Apple Silicon (M1–M4) and Intel Macs using Homebrew.",
      commands: `# 1. Install prerequisites\nbrew install node python ffmpeg\n\n# 2. Launch with run.sh\n./run.sh`
    },
    production: {
      title: "Production Build & Batch CLI Setup",
      note: "Compile Vite static bundle to dist/ and start Express + Python in production mode.",
      commands: `# Build frontend bundle\nnpm run build\n\n# Type-check TypeScript\nnpm run lint\n\n# Start production server on port 3000\nnpm run start\n\n# Optional: Run headless HJSON batch renders\npython3 -m autoengine validate autoengine/examples/batch_videos.hjson\npython3 -m autoengine run autoengine/examples/batch_videos.hjson --workers 2`
    }
  },

  shortcuts: [
    ["Space", "Play / Pause synchronized 2D Canvas & Web Audio preview"],
    [", or Left Arrow", "Step backward 1 exact timeline frame"],
    [". or Right Arrow", "Step forward 1 exact timeline frame"],
    ["S", "Split / razor-cut selected clip cleanly at playhead"],
    ["I / O", "Mark In / Mark Out range in MultiMaster Edit Studio"],
    ["J / K / L", "Shuttle reverse / stop / forward in Advanced Studio"],
    ["Double-Click Audio Clip", "Insert diamond Volume Envelope node directly on waveform"],
    ["Shift+Click / Right-Click Node", "Delete an audio volume envelope diamond node"],
    ["Ctrl/Cmd + D", "Duplicate or loop selected clip"],
    ["Ctrl/Cmd + Z / Ctrl+Shift+Z", "60-step Undo / Redo"],
    ["Delete / Backspace", "Delete selected clip (ripples when Ripple Mode is ON)"],
    ["Alt+Drag / Middle Drag", "Pan Boundless Tracks horizontally & vertically"],
    ["Ctrl/Cmd + Scroll", "Zoom timeline horizontal scale (20 px/s – 180 px/s)"]
  ]
};
