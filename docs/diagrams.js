/**
 * Interactive SVG diagram definitions & node inspection metadata for docs/.
 * Clicking any node in an SVG updates the diagram inspector panel with files, ports, and flows.
 */
window.OBSIDIAN_DIAGRAMS = {
  architecture: {
    id: "architecture",
    title: "3-Tier System Architecture (Browser Client ↔ Express Gateway ↔ Python FFmpeg Engine)",
    nodes: {
      browser: {
        title: "1. Browser NLE Client (React 19 + 2D Canvas + Web Audio)",
        summary: "Zero-bloat client studio running on port 3000. Evaluates Fusion keyframes, 30 transitions, chroma key, color LUTs, stereo LUFS meters, 36 Hz–15.5 kHz RTA spectrum, and 1,600-bin PCM waveforms in real time.",
        chips: ["src/App.tsx", "PreviewCanvas.tsx", "TimelineEditor.tsx", "AudioSpectrumVisualizer.tsx", "AudioClipWaveform.tsx", "timelineMath.ts"]
      },
      gateway: {
        title: "2. Node / Express + Vite Gateway (server.ts — Port 3000)",
        summary: "Serves Vite dev middleware (or dist/ in prod), stores uploads, serves HTTP 206 byte-range proxy/master streams, enforces path-safe IDs, and forwards JSON RPC calls to Python over 127.0.0.1:3001.",
        chips: ["server.ts", "Multer (1GB / 100 files)", "HTTP 206 Range Streaming", "assets.json registry", "Vite Middleware"]
      },
      python: {
        title: "3. Python NLE & FFmpeg Compiler (backend/engine.py — Port 3001)",
        summary: "Standard-library HTTP server supervising ffprobe/ffmpeg subprocesses. Generates CFR editing proxies, analyzes spectral-flux BPM & waveforms, compiles filter_complex graphs, and executes async renders.",
        chips: ["backend/engine.py", "probe_media()", "analyze_audio_beats()", "render_job_worker()", "ffmpeg + ffprobe"]
      },
      storage: {
        title: "4. Local Workspace Storage (.obsidiancut_data/)",
        summary: "Persists untouched original uploads for master rendering alongside lightweight 480p proxies, JPEG thumbnails, and rendered exports. Override path via OBSIDIANCUT_DATA_DIR.",
        chips: [".obsidiancut_data/uploads/", ".obsidiancut_data/proxies/", ".obsidiancut_data/thumbs/", "assets.json"]
      },
      autoengine: {
        title: "5. Headless Batch Automation (autoengine CLI)",
        summary: "Zero-dependency HJSON manifest runner invoking backend/engine.py directly or submitting jobs to a running Express server for parallel batch video generation.",
        chips: ["autoengine/cli.py", "autoengine/wrapper.py", "autoengine/hjson_parser.py", "batch_videos.hjson"]
      }
    },
    svg: `
<svg viewBox="0 0 960 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Obsidian Cut 3-Tier Architecture Diagram">
  <defs>
    <marker id="arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#3b82f6"/>
    </marker>
    <marker id="arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981"/>
    </marker>
    <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b"/>
    </marker>
  </defs>

  <!-- Connection Arrows -->
  <path d="M 290 120 L 348 120" stroke="#3b82f6" stroke-width="2.2" fill="none" marker-end="url(#arrow-blue)" marker-start="url(#arrow-blue)"/>
  <text x="319" y="106" text-anchor="middle" font-size="10" font-family="monospace" fill="#60a5fa">HTTP /api/*</text>

  <path d="M 610 120 L 668 120" stroke="#f59e0b" stroke-width="2.2" fill="none" marker-end="url(#arrow-amber)" marker-start="url(#arrow-amber)"/>
  <text x="639" y="106" text-anchor="middle" font-size="10" font-family="monospace" fill="#fbbf24">127.0.0.1:3001</text>

  <path d="M 480 202 L 480 250" stroke="#10b981" stroke-width="2" stroke-dasharray="4 3" fill="none" marker-end="url(#arrow-emerald)"/>
  <path d="M 805 202 L 805 250" stroke="#10b981" stroke-width="2" fill="none" marker-end="url(#arrow-emerald)"/>
  <path d="M 640 296 L 670 296" stroke="#a78bfa" stroke-width="2" stroke-dasharray="4 3" fill="none" marker-end="url(#arrow-amber)"/>

  <!-- Node 1: Browser -->
  <g class="diagram-node is-selected" data-diagram="architecture" data-node="browser">
    <rect class="node-box" x="20" y="34" width="270" height="168" rx="12" fill="#0f172a" stroke="#3b82f6" stroke-width="2"/>
    <rect x="20" y="34" width="270" height="30" rx="12" fill="#1d4ed8"/>
    <text x="34" y="53" font-size="12" font-weight="700" fill="#ffffff">1. BROWSER STUDIO (:3000 UI)</text>
    <text x="34" y="84" font-size="11" fill="#e2e8f0" font-weight="600">React 19 + TypeScript SPA</text>
    <text x="34" y="104" font-size="10.5" fill="#94a3b8">• Boundless Tracks &amp; Rough Cut</text>
    <text x="34" y="121" font-size="10.5" fill="#94a3b8">• 2D Canvas Compositor &amp; LUTs</text>
    <text x="34" y="138" font-size="10.5" fill="#94a3b8">• Web Audio AnalyserNode FFT + PCM</text>
    <text x="34" y="155" font-size="10.5" fill="#94a3b8">• Fusion, Fairlight, MultiMaster, Quick</text>
    <text x="34" y="182" font-size="10" font-family="monospace" fill="#38bdf8">src/App.tsx · timelineMath.ts</text>
  </g>

  <!-- Node 2: Express Gateway -->
  <g class="diagram-node" data-diagram="architecture" data-node="gateway">
    <rect class="node-box" x="350" y="34" width="260" height="168" rx="12" fill="#0f172a" stroke="#475569" stroke-width="1.6"/>
    <rect x="350" y="34" width="260" height="30" rx="12" fill="#0e7490"/>
    <text x="364" y="53" font-size="12" font-weight="700" fill="#ffffff">2. EXPRESS GATEWAY (:3000)</text>
    <text x="364" y="84" font-size="11" fill="#e2e8f0" font-weight="600">Node / tsx + Vite Middleware</text>
    <text x="364" y="104" font-size="10.5" fill="#94a3b8">• Multer Uploads (100 files / 1GB)</text>
    <text x="364" y="121" font-size="10.5" fill="#94a3b8">• HTTP 206 Range Proxy/Master</text>
    <text x="364" y="138" font-size="10.5" fill="#94a3b8">• Spawns Python Child Process</text>
    <text x="364" y="155" font-size="10.5" fill="#94a3b8">• Safe ID Validation + Registry</text>
    <text x="364" y="182" font-size="10" font-family="monospace" fill="#22d3ee">server.ts</text>
  </g>

  <!-- Node 3: Python Engine -->
  <g class="diagram-node" data-diagram="architecture" data-node="python">
    <rect class="node-box" x="670" y="34" width="270" height="168" rx="12" fill="#0f172a" stroke="#475569" stroke-width="1.6"/>
    <rect x="670" y="34" width="270" height="30" rx="12" fill="#b45309"/>
    <text x="684" y="53" font-size="12" font-weight="700" fill="#ffffff">3. PYTHON NLE ENGINE (:3001)</text>
    <text x="684" y="84" font-size="11" fill="#e2e8f0" font-weight="600">Stdlib HTTP + FFmpeg Subprocess</text>
    <text x="684" y="104" font-size="10.5" fill="#94a3b8">• ffprobe VFR/CFR &amp; Proxy Build</text>
    <text x="684" y="121" font-size="10.5" fill="#94a3b8">• Spectral-Flux BPM + 220-bin Wave</text>
    <text x="684" y="138" font-size="10.5" fill="#94a3b8">• filter_complex + Keyframe Exprs</text>
    <text x="684" y="155" font-size="10.5" fill="#94a3b8">• Async Render Thread Queue</text>
    <text x="684" y="182" font-size="10" font-family="monospace" fill="#fbbf24">backend/engine.py</text>
  </g>

  <!-- Node 4: Storage -->
  <g class="diagram-node" data-diagram="architecture" data-node="storage">
    <rect class="node-box" x="350" y="252" width="290" height="88" rx="12" fill="#0f172a" stroke="#475569" stroke-width="1.6"/>
    <text x="366" y="276" font-size="12" font-weight="700" fill="#34d399">4. LOCAL WORKSPACE DISK (.obsidiancut_data/)</text>
    <text x="366" y="296" font-size="10.5" fill="#cbd5e1">uploads/ (Masters) · proxies/ (480p H.264 / 1280px JPG)</text>
    <text x="366" y="314" font-size="10.5" fill="#94a3b8">thumbs/ · renders/ · assets.json index</text>
    <text x="366" y="330" font-size="10" font-family="monospace" fill="#6ee7b7">OBSIDIANCUT_DATA_DIR override</text>
  </g>

  <!-- Node 5: autoengine -->
  <g class="diagram-node" data-diagram="architecture" data-node="autoengine">
    <rect class="node-box" x="670" y="252" width="270" height="88" rx="12" fill="#0f172a" stroke="#475569" stroke-width="1.6"/>
    <text x="686" y="276" font-size="12" font-weight="700" fill="#c084fc">5. HEADLESS BATCH CLI (autoengine)</text>
    <text x="686" y="296" font-size="10.5" fill="#cbd5e1">HJSON Declarative Multi-Video Automation</text>
    <text x="686" y="314" font-size="10.5" fill="#94a3b8">python -m autoengine run batch_videos.hjson</text>
    <text x="686" y="330" font-size="10" font-family="monospace" fill="#d8b4fe">autoengine/cli.py · wrapper.py</text>
  </g>
</svg>`
  },

  audioPipeline: {
    id: "audioPipeline",
    title: "Audio Signal Chain, Precision Waveform & Real-Time RTA Spectrum Architecture",
    nodes: {
      ingestAudio: {
        title: "Python Audio Analysis (analyze_audio_beats)",
        summary: "Decodes PCM at 22,050 Hz mono, calculates spectral flux beat timestamps + BPM (75–165 BPM), and downsamples 220 normalized peak bars saved in MediaAsset.waveform.",
        chips: ["backend/engine.py:365", "waveform[220]", "beats[]", "bpm"]
      },
      waveformCanvas: {
        title: "Timeline Waveform Canvas (AudioClipWaveform.tsx + waveformCache.ts)",
        summary: "Draws immediately from clip/asset waveform metadata while decoding audioBuf PCM (1,600 asymmetric min/max/RMS bins) in the background. Slices source by [trimStart, trimStart + duration * speed] and applies volumeEnvelope + fade curves.",
        chips: ["AudioClipWaveform.tsx", "waveformCache.ts", "1600 PCM bins", "trimStart slice"]
      },
      webAudioBus: {
        title: "Web Audio Playback & AnalyserNode Bus (PreviewCanvas + liveAudioSpectrum)",
        summary: "Connects HTMLAudioElement -> MediaElementAudioSourceNode -> GainNode (envelope/ducking/fades) -> StereoPannerNode -> MasterGainNode -> AnalyserNode (fftSize=512) -> ctx.destination.",
        chips: ["PreviewCanvas.tsx", "liveAudioSpectrum.ts", "AnalyserNode fftSize=512", "StereoPannerNode"]
      },
      spectrumRta: {
        title: "Real-Time Audio Spectrum & Stereo Meters",
        summary: "AudioSpectrumVisualizer reads live FFT data (36 Hz–15.5 kHz log bands) blended with computeAudioSpectrumBands() (3-band EQ, beats, compressor, loudnorm) across Fairlight, Preview, and Quick Render.",
        chips: ["AudioSpectrumVisualizer.tsx", "AudioMeterBar.tsx", "Bars / Curve / Mirror", "computeAudioSpectrumBands()"]
      }
    },
    svg: `
<svg viewBox="0 0 960 270" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Obsidian Cut Audio Signal and Spectrum Pipeline">
  <defs>
    <marker id="arr-c" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#06b6d4"/>
    </marker>
    <marker id="arr-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981"/>
    </marker>
  </defs>

  <!-- Paths -->
  <path d="M 220 95 L 254 95" stroke="#10b981" stroke-width="2" fill="none" marker-end="url(#arr-g)"/>
  <path d="M 474 95 L 508 95" stroke="#06b6d4" stroke-width="2" fill="none" marker-end="url(#arr-c)"/>
  <path d="M 728 95 L 758 95" stroke="#06b6d4" stroke-width="2" fill="none" marker-end="url(#arr-c)"/>
  <path d="M 120 172 L 120 205 L 855 205 L 855 174" stroke="#10b981" stroke-width="1.8" stroke-dasharray="5 3" fill="none" marker-end="url(#arr-g)"/>
  <text x="488" y="224" text-anchor="middle" font-size="10.5" font-family="monospace" fill="#6ee7b7">Deterministic DSP Fallback (EQ + Waveform + Beats + Loudnorm) when paused / scrubbed</text>

  <!-- Node 1 -->
  <g class="diagram-node is-selected" data-diagram="audioPipeline" data-node="ingestAudio">
    <rect class="node-box" x="16" y="28" width="204" height="142" rx="10" fill="#0f172a" stroke="#10b981" stroke-width="2"/>
    <text x="30" y="52" font-size="11.5" font-weight="700" fill="#34d399">A. Audio Ingest Analysis</text>
    <text x="30" y="74" font-size="10.5" fill="#cbd5e1">analyze_audio_beats()</text>
    <text x="30" y="94" font-size="10" fill="#94a3b8">• 22,050 Hz PCM decode</text>
    <text x="30" y="111" font-size="10" fill="#94a3b8">• Spectral-flux beats[]</text>
    <text x="30" y="128" font-size="10" fill="#94a3b8">• 220-bin waveform[]</text>
    <text x="30" y="152" font-size="9.5" font-family="monospace" fill="#6ee7b7">backend/engine.py</text>
  </g>

  <!-- Node 2 -->
  <g class="diagram-node" data-diagram="audioPipeline" data-node="waveformCanvas">
    <rect class="node-box" x="256" y="28" width="218" height="142" rx="10" fill="#0f172a" stroke="#475569" stroke-width="1.6"/>
    <text x="270" y="52" font-size="11.5" font-weight="700" fill="#6ee7b7">B. Timeline Waveform</text>
    <text x="270" y="74" font-size="10.5" fill="#cbd5e1">AudioClipWaveform.tsx</text>
    <text x="270" y="94" font-size="10" fill="#94a3b8">• Immediate metadata draw</text>
    <text x="270" y="111" font-size="10" fill="#94a3b8">• 1,600-bin PCM upgrade</text>
    <text x="270" y="128" font-size="10" fill="#94a3b8">• [trimStart .. +dur*speed]</text>
    <text x="270" y="152" font-size="9.5" font-family="monospace" fill="#38bdf8">waveformCache.ts</text>
  </g>

  <!-- Node 3 -->
  <g class="diagram-node" data-diagram="audioPipeline" data-node="webAudioBus">
    <rect class="node-box" x="510" y="28" width="218" height="142" rx="10" fill="#0f172a" stroke="#475569" stroke-width="1.6"/>
    <text x="524" y="52" font-size="11.5" font-weight="700" fill="#38bdf8">C. Web Audio Bus</text>
    <text x="524" y="74" font-size="10.5" fill="#cbd5e1">PreviewCanvas.tsx</text>
    <text x="524" y="94" font-size="10" fill="#94a3b8">• GainNode (fade/env/duck)</text>
    <text x="524" y="111" font-size="10" fill="#94a3b8">• StereoPannerNode (-1..1)</text>
    <text x="524" y="128" font-size="10" fill="#94a3b8">• AnalyserNode (512 FFT)</text>
    <text x="524" y="152" font-size="9.5" font-family="monospace" fill="#22d3ee">liveAudioSpectrum.ts</text>
  </g>

  <!-- Node 4 -->
  <g class="diagram-node" data-diagram="audioPipeline" data-node="spectrumRta">
    <rect class="node-box" x="760" y="28" width="184" height="142" rx="10" fill="#0f172a" stroke="#475569" stroke-width="1.6"/>
    <text x="774" y="52" font-size="11.5" font-weight="700" fill="#22d3ee">D. RTA &amp; Meters</text>
    <text x="774" y="74" font-size="10.5" fill="#cbd5e1">36 Hz – 15.5 kHz</text>
    <text x="774" y="94" font-size="10" fill="#94a3b8">• Bars / Curve / Mirror</text>
    <text x="774" y="111" font-size="10" fill="#94a3b8">• Peak-hold caps + dB</text>
    <text x="774" y="128" font-size="10" fill="#94a3b8">• Stereo L/R &amp; LUFS</text>
    <text x="774" y="152" font-size="9.5" font-family="monospace" fill="#6ee7b7">Fairlight · QuickRender</text>
  </g>
</svg>`
  },

  renderDag: {
    id: "renderDag",
    title: "FFmpeg Asynchronous Filter-Graph Compilation Pipeline (POST /api/render)",
    nodes: {
      submit: {
        title: "Step 1: Enqueue JSON Timeline (POST /api/render)",
        summary: "Browser sends tracks[], clips[], master colorGrade, and export config (resolution, rational fps, format, speedProfile, normalizeAudio, normalizeTargetLufs). Server returns 202 { jobId } immediately.",
        chips: ["POST /api/render", "HTTP 202 Accepted", "jobId"]
      },
      videoGraph: {
        title: "Step 2: Video & Keyframe DAG Compiler",
        summary: "Resolves master upload paths (ignoring low-res preview proxies), applies speed/reverse/crop/chroma/LUTs, compiles Fusion keyframes into FFmpeg eval=frame scale/rotate/geq/overlay expressions, chains xfade transitions, and composites bottom-to-top.",
        chips: ["rational CFR fps", "xfade=transition=...", "build_keyframe_ff_expr()", "PNG Title overlays"]
      },
      audioGraph: {
        title: "Step 3: Multi-Track Audio Mixing & Loudnorm",
        summary: "Builds piecewise volume='...':eval=frame envelopes + backgroundDucking between() expressions, maps crossfade afade curves (hsin/tri/exp), runs track EQ/comp/reverb/loudnorm, sums via 48kHz amix, and applies master loudnorm.",
        chips: ["build_audio_gain_filters()", "build_track_dsp_filters()", "amix=normalize=0", "loudnorm=I=-14|-16|-23"]
      },
      progressDownload: {
        title: "Step 4: Progress Streaming & HTTP 206 Delivery",
        summary: "Worker parses ffmpeg -progress pipe:1 telemetry (out_time_us & speed). Client polls GET /api/render/:jobId every ~700ms and downloads or streams inline via HTTP 206.",
        chips: ["GET /api/render/:jobId", "GET /api/render/:jobId/download", "?inline=1 HTTP 206"]
      }
    },
    svg: `
<svg viewBox="0 0 960 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="FFmpeg Render DAG Pipeline">
  <defs>
    <marker id="arr-r" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#3b82f6"/>
    </marker>
  </defs>
  <path d="M 218 110 L 250 110" stroke="#3b82f6" stroke-width="2" fill="none" marker-end="url(#arr-r)"/>
  <path d="M 466 110 L 498 110" stroke="#3b82f6" stroke-width="2" fill="none" marker-end="url(#arr-r)"/>
  <path d="M 714 110 L 746 110" stroke="#3b82f6" stroke-width="2" fill="none" marker-end="url(#arr-r)"/>

  <g class="diagram-node is-selected" data-diagram="renderDag" data-node="submit">
    <rect class="node-box" x="16" y="34" width="202" height="152" rx="10" fill="#0f172a" stroke="#3b82f6" stroke-width="2"/>
    <text x="30" y="60" font-size="11.5" font-weight="700" fill="#60a5fa">1. Job Enqueue</text>
    <text x="30" y="82" font-size="10.5" fill="#cbd5e1">POST /api/render</text>
    <text x="30" y="104" font-size="10" fill="#94a3b8">• Full tracks &amp; clips JSON</text>
    <text x="30" y="121" font-size="10" fill="#94a3b8">• Original master media IDs</text>
    <text x="30" y="138" font-size="10" fill="#94a3b8">• HTTP 202 { jobId }</text>
  </g>

  <g class="diagram-node" data-diagram="renderDag" data-node="videoGraph">
    <rect class="node-box" x="252" y="34" width="214" height="152" rx="10" fill="#0f172a" stroke="#475569" stroke-width="1.6"/>
    <text x="266" y="60" font-size="11.5" font-weight="700" fill="#c084fc">2. Video Filtergraph</text>
    <text x="266" y="82" font-size="10.5" fill="#cbd5e1">Bottom-to-Top Z-Order</text>
    <text x="266" y="104" font-size="10" fill="#94a3b8">• Crop, Chroma Key &amp; LUT</text>
    <text x="266" y="121" font-size="10" fill="#94a3b8">• Fusion Keyframe eval=frame</text>
    <text x="266" y="138" font-size="10" fill="#94a3b8">• 30 xfade + Rational CFR</text>
  </g>

  <g class="diagram-node" data-diagram="renderDag" data-node="audioGraph">
    <rect class="node-box" x="500" y="34" width="214" height="152" rx="10" fill="#0f172a" stroke="#475569" stroke-width="1.6"/>
    <text x="514" y="60" font-size="11.5" font-weight="700" fill="#34d399">3. Audio Mix &amp; LUFS</text>
    <text x="514" y="82" font-size="10.5" fill="#cbd5e1">Unified 48 kHz Stereo Bus</text>
    <text x="514" y="104" font-size="10" fill="#94a3b8">• Piecewise volume env + duck</text>
    <text x="514" y="121" font-size="10" fill="#94a3b8">• Track EQ / Comp / Reverb</text>
    <text x="514" y="138" font-size="10" fill="#94a3b8">• amix + EBU R128 loudnorm</text>
  </g>

  <g class="diagram-node" data-diagram="renderDag" data-node="progressDownload">
    <rect class="node-box" x="748" y="34" width="196" height="152" rx="10" fill="#0f172a" stroke="#475569" stroke-width="1.6"/>
    <text x="762" y="60" font-size="11.5" font-weight="700" fill="#fbbf24">4. Stream &amp; Download</text>
    <text x="762" y="82" font-size="10.5" fill="#cbd5e1">MP4 · MOV · WebM</text>
    <text x="762" y="104" font-size="10" fill="#94a3b8">• Live % &amp; speed polling</text>
    <text x="762" y="121" font-size="10" fill="#94a3b8">• Inline preview (?inline=1)</text>
    <text x="762" y="138" font-size="10" fill="#94a3b8">• Direct disk download</text>
  </g>
</svg>`
  }
};
