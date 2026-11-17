import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Film,
  FolderPlus,
  Loader2,
  Music,
  Sliders,
  Sparkles,
  Upload,
  Wand2,
  Zap,
} from 'lucide-react';
import {
  ACCEPTED_MEDIA_ACCEPT,
  ColorGradeConfig,
  ExportConfig,
  ExportFps,
  MediaAsset,
  PreviewClarityMode,
  RenderJobStatus,
  TimelineClip,
  TimelineTrack,
} from '../types/editor';
import {
  computeClipNormalizeGain,
  computeStereoMetersAtTime,
  formatBytes,
  formatTimecode,
  QuickAutoSelectOptions,
} from '../utils/timelineMath';
import { downloadRenderedVideo } from '../utils/downloadFile';
import { PreviewCanvas } from './PreviewCanvas';

interface QuickRenderPageProps {
  assets: MediaAsset[];
  assetsMap: Map<string, MediaAsset>;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  selectedClipId: string | null;
  colorGrade: ColorGradeConfig;
  bypassGrade: boolean;
  totalDuration: number;
  playhead: number;
  isPlaying: boolean;
  masterMuted: boolean;
  exportConfig: ExportConfig;
  renderJob: RenderJobStatus | null;
  loadingSample?: boolean;
  uploading?: boolean;
  onChangeConfig: (next: ExportConfig) => void;
  onStartRender: () => void;
  onTogglePlay: () => void;
  onSeekPlayhead: (t: number) => void;
  onPlayheadChange: (t: number) => void;
  onToggleMasterMute: () => void;
  onSelectClip: (id: string | null) => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onCommitHistory?: () => void;
  onLoadSamplePack: () => void;
  onUploadFiles: (files: FileList | File[]) => void;
  onOpenTimelineMode: () => void;
  onAutoSelectQuickRender: (opts: QuickAutoSelectOptions, renderNow?: boolean) => void;
  clarityMode?: PreviewClarityMode;
  isPreviewDetached?: boolean;
  extendedScreenCount?: number;
  onClarityModeChange?: (mode: PreviewClarityMode) => void;
  onDetachPreview?: () => void;
}

interface QuickPreset {
  id: string;
  label: string;
  subtitle: string;
  patch: Partial<ExportConfig>;
}

const QUICK_PRESETS: QuickPreset[] = [
  {
    id: 'lightning_720',
    label: 'Lightning Draft 720p',
    subtitle: '1280×720 · 30fps · Ultrafast MP4',
    patch: { resolution: '1280x720', fps: 30, format: 'mp4', speedProfile: 'ultrafast' },
  },
  {
    id: 'youtube_1080',
    label: 'Fast YouTube 1080p',
    subtitle: '1920×1080 · 30fps · Veryfast MP4',
    patch: { resolution: '1920x1080', fps: 30, format: 'mp4', speedProfile: 'veryfast' },
  },
  {
    id: 'reels_vertical',
    label: 'Vertical Reels / Shorts',
    subtitle: '1080×1920 · 30fps · Veryfast MP4',
    patch: { resolution: '1080x1920', fps: 30, format: 'mp4', speedProfile: 'veryfast' },
  },
  {
    id: 'square_social',
    label: 'Square Social 1:1',
    subtitle: '1080×1080 · 30fps · Ultrafast MP4',
    patch: { resolution: '1080x1080', fps: 30, format: 'mp4', speedProfile: 'ultrafast' },
  },
];

export const QuickRenderPage: React.FC<QuickRenderPageProps> = ({
  assets,
  assetsMap,
  tracks,
  clips,
  selectedClipId,
  colorGrade,
  bypassGrade,
  totalDuration,
  playhead,
  isPlaying,
  masterMuted,
  exportConfig,
  renderJob,
  loadingSample = false,
  uploading = false,
  onChangeConfig,
  onStartRender,
  onTogglePlay,
  onSeekPlayhead,
  onPlayheadChange,
  onToggleMasterMute,
  onSelectClip,
  onUpdateClip,
  onCommitHistory,
  onLoadSamplePack,
  onUploadFiles,
  onOpenTimelineMode,
  onAutoSelectQuickRender,
  clarityMode = 'hd',
  isPreviewDetached = false,
  extendedScreenCount = 1,
  onClarityModeChange,
  onDetachPreview,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const opacityCommittedRef = useRef(false);
  const [dropActive, setDropActive] = useState(false);
  const [downloadingPct, setDownloadingPct] = useState<number | null>(null);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  const [autoOpts, setAutoOpts] = useState<QuickAutoSelectOptions>({
    transitionStyle: 'dynamic',
    transitionDuration: 0.45,
    clipOpacity: 1.0,
    autoOpacityFade: true,
    audioMode: 'auto',
    loopMusic: true,
    enableMotion: true,
    autoNormalize: true,
    targetLufs: exportConfig.normalizeTargetLufs ?? -14,
  });

  const isWorking = renderJob?.status === 'queued' || renderJob?.status === 'rendering';
  const isDone = renderJob?.status === 'completed';
  const isFailed = renderJob?.status === 'failed';

  const handleDownloadFile = async () => {
    if (!renderJob || downloadingPct !== null) return;
    setDownloadErr(null);
    setDownloadingPct(0);
    const outName = renderJob.outputName || `obsidiancut_export.${exportConfig.format}`;
    const res = await downloadRenderedVideo(renderJob.jobId, outName, (pct) => setDownloadingPct(pct));
    setDownloadingPct(null);
    if (!res.ok) {
      setDownloadErr(res.error || 'Download failed');
    }
  };

  const visualAssets = useMemo(
    () => assets.filter((a) => a.mediaType === 'image' || a.mediaType === 'video'),
    [assets],
  );
  const audioAssets = useMemo(
    () => assets.filter((a) => a.mediaType === 'audio'),
    [assets],
  );

  const visualClipCount = useMemo(
    () => clips.filter((c) => c.kind !== 'audio').length,
    [clips],
  );
  const audioClipCount = useMemo(
    () => clips.filter((c) => c.kind === 'audio' || (c.kind === 'video' && c.hasAudio)).length,
    [clips],
  );

  const meter = useMemo(
    () =>
      computeStereoMetersAtTime(
        tracks,
        clips,
        playhead,
        masterMuted,
        isPlaying,
        Boolean(exportConfig.normalizeAudio),
        exportConfig.normalizeTargetLufs ?? -14,
      ),
    [
      tracks,
      clips,
      playhead,
      masterMuted,
      isPlaying,
      exportConfig.normalizeAudio,
      exportConfig.normalizeTargetLufs,
    ],
  );

  const normalizeAllAudioClips = () => {
    const audible = clips.filter((c) => c.kind === 'audio' || (c.kind === 'video' && c.hasAudio));
    if (audible.length === 0) return;
    onCommitHistory?.();
    const targetLufs = exportConfig.normalizeTargetLufs ?? -14;
    const targetPeak = targetLufs <= -20 ? 0.72 : targetLufs <= -15 ? 0.82 : 0.88;
    for (const c of audible) {
      onUpdateClip(c.id, { volume: computeClipNormalizeGain(c.waveform, targetPeak) });
    }
  };

  const applyLiveClipOpacity = (nextOpacity: number) => {
    setAutoOpts((prev) => ({ ...prev, clipOpacity: nextOpacity }));
    const visualClips = clips.filter((c) => c.kind !== 'audio');
    if (visualClips.length > 0) {
      if (!opacityCommittedRef.current) {
        opacityCommittedRef.current = true;
        onCommitHistory?.();
      }
      for (const c of visualClips) {
        onUpdateClip(c.id, { opacity: Number(nextOpacity.toFixed(2)) });
      }
    }
  };

  const activePresetId = QUICK_PRESETS.find(
    (p) =>
      p.patch.resolution === exportConfig.resolution &&
      p.patch.fps === exportConfig.fps &&
      p.patch.format === exportConfig.format &&
      p.patch.speedProfile === exportConfig.speedProfile,
  )?.id;

  const syncedAutoOpts: QuickAutoSelectOptions = {
    ...autoOpts,
    targetLufs: exportConfig.normalizeTargetLufs ?? autoOpts.targetLufs,
  };

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
      {/* Left: Auto-Select Everything + Presets + Normalizer Setup */}
      <section className="lg:col-span-5 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#171b22] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Quick Render Setup
            </h2>
          </div>
          <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
            {visualAssets.length} media · {audioAssets.length} music
          </span>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Auto-Select Everything Panel */}
          <div className="p-3.5 rounded-md border border-blue-200 dark:border-blue-500/35 bg-blue-50/70 dark:bg-[#101724] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Auto-Select Everything
                </span>
              </div>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                Transitions · Opacity · Music
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                <span>Transitions Mix</span>
                <select
                  disabled={isWorking}
                  value={autoOpts.transitionStyle}
                  onChange={(e) =>
                    setAutoOpts((prev) => ({
                      ...prev,
                      transitionStyle: e.target.value as QuickAutoSelectOptions['transitionStyle'],
                    }))
                  }
                  className="h-8 px-2 rounded bg-white dark:bg-[#0b1018] border border-slate-300 dark:border-[#2a3344] text-[11px] text-slate-900 dark:text-slate-100"
                >
                  <option value="dynamic">Dynamic Auto Mix</option>
                  <option value="crossfade">Smooth Dissolves</option>
                  <option value="directional">Slides &amp; Wipes</option>
                  <option value="geometric">Iris &amp; Radial</option>
                  <option value="cut">Hard Beat Cuts</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                <span>Music Track</span>
                <select
                  disabled={isWorking}
                  value={autoOpts.audioMode}
                  onChange={(e) => setAutoOpts((prev) => ({ ...prev, audioMode: e.target.value }))}
                  className="h-8 px-2 rounded bg-white dark:bg-[#0b1018] border border-slate-300 dark:border-[#2a3344] text-[11px] text-slate-900 dark:text-slate-100"
                >
                  <option value="auto">
                    Auto ({audioAssets[0]?.name || 'Best / Sample 120 BPM'})
                  </option>
                  {audioAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({Math.round(a.duration)}s)
                    </option>
                  ))}
                  <option value="none">No Music (Visuals Only)</option>
                </select>
              </label>
            </div>

            {/* Opacity Slider + Smart Toggles */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-600 dark:text-slate-300">Visual Opacity Level</span>
                <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                  {Math.round(autoOpts.clipOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.35}
                max={1.0}
                step={0.05}
                disabled={isWorking}
                value={autoOpts.clipOpacity}
                onChange={(e) => applyLiveClipOpacity(Number(e.target.value))}
                onPointerUp={() => {
                  opacityCommittedRef.current = false;
                }}
                onPointerCancel={() => {
                  opacityCommittedRef.current = false;
                }}
                onBlur={() => {
                  opacityCommittedRef.current = false;
                }}
                className="studio-slider w-full"
              />

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-slate-700 dark:text-slate-300 pt-0.5">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoOpts.autoOpacityFade}
                    onChange={(e) =>
                      setAutoOpts((prev) => ({ ...prev, autoOpacityFade: e.target.checked }))
                    }
                    className="rounded border-slate-300 dark:border-[#2a3344] text-blue-600"
                  />
                  <span>Auto Opacity Fades</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoOpts.loopMusic}
                    onChange={(e) =>
                      setAutoOpts((prev) => ({ ...prev, loopMusic: e.target.checked }))
                    }
                    className="rounded border-slate-300 dark:border-[#2a3344] text-blue-600"
                  />
                  <span>Loop &amp; Crossfade Music</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoOpts.enableMotion}
                    onChange={(e) =>
                      setAutoOpts((prev) => ({ ...prev, enableMotion: e.target.checked }))
                    }
                    className="rounded border-slate-300 dark:border-[#2a3344] text-blue-600"
                  />
                  <span>Ken Burns Motion</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoOpts.autoNormalize}
                    onChange={(e) =>
                      setAutoOpts((prev) => ({ ...prev, autoNormalize: e.target.checked }))
                    }
                    className="rounded border-slate-300 dark:border-[#2a3344] text-blue-600"
                  />
                  <span>Auto-Normalize Audio</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                disabled={isWorking || loadingSample || uploading}
                onClick={() => onAutoSelectQuickRender(syncedAutoOpts, false)}
                className="py-2 px-3 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                title="Automatically pick media, transitions, opacity ramps, motion, and playback music, then preview"
              >
                {loadingSample ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                <span>Auto-Select &amp; Play Music</span>
              </button>
              <button
                type="button"
                disabled={isWorking || loadingSample || uploading}
                onClick={() => onAutoSelectQuickRender(syncedAutoOpts, true)}
                className="py-2 px-3 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                title="Automatically assemble transitions, opacity, and music, then render immediately"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Auto-Build &amp; Render</span>
              </button>
            </div>
          </div>

          {/* 1-Click Speed Presets */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
              1-Click Speed &amp; Format Presets
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {QUICK_PRESETS.map((preset) => {
                const active = activePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isWorking}
                    onClick={() => onChangeConfig({ ...exportConfig, ...preset.patch })}
                    className={`p-2.5 rounded border text-left transition-colors cursor-pointer disabled:opacity-50 ${
                      active
                        ? 'bg-blue-600/15 dark:bg-blue-600/20 border-blue-500 dark:border-blue-400 text-slate-900 dark:text-white'
                        : 'bg-slate-50 dark:bg-[#0e1116] border-slate-200 dark:border-[#242a36] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                    }`}
                  >
                    <p className="text-xs font-semibold leading-snug">{preset.label}</p>
                    <p className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 mt-0.5">
                      {preset.subtitle}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Core Output Controls */}
          <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-slate-200 dark:border-[#222733]">
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              <span>Resolution</span>
              <select
                disabled={isWorking}
                value={exportConfig.resolution}
                onChange={(e) =>
                  onChangeConfig({
                    ...exportConfig,
                    resolution: e.target.value as ExportConfig['resolution'],
                  })
                }
                className="h-8 px-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="1280x720">720p HD (1280×720)</option>
                <option value="1920x1080">1080p Full HD (1920×1080)</option>
                <option value="3840x2160">4K UHD (3840×2160)</option>
                <option value="1080x1920">Vertical Reels (1080×1920)</option>
                <option value="1080x1080">Square Social (1080×1080)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              <span>Frame Rate</span>
              <select
                disabled={isWorking}
                value={exportConfig.fps}
                onChange={(e) =>
                  onChangeConfig({ ...exportConfig, fps: Number(e.target.value) as ExportFps })
                }
                className="h-8 px-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100"
              >
                <option value={23.976}>23.976 fps (NTSC Film)</option>
                <option value={24}>24 fps (True Cinema)</option>
                <option value={29.97}>29.97 fps (Broadcast)</option>
                <option value={30}>30 fps (Standard)</option>
                <option value={59.94}>59.94 fps (Broadcast High)</option>
                <option value={60}>60 fps (Ultra Smooth)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              <span>Container Format</span>
              <select
                disabled={isWorking}
                value={exportConfig.format}
                onChange={(e) =>
                  onChangeConfig({
                    ...exportConfig,
                    format: e.target.value as ExportConfig['format'],
                  })
                }
                className="h-8 px-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="mp4">MP4 (H.264 + AAC)</option>
                <option value="mov">MOV (QuickTime)</option>
                <option value="webm">WebM (VP8 + Vorbis)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              <span>Encoder Speed</span>
              <select
                disabled={isWorking}
                value={exportConfig.speedProfile}
                onChange={(e) =>
                  onChangeConfig({
                    ...exportConfig,
                    speedProfile: e.target.value as ExportConfig['speedProfile'],
                  })
                }
                className="h-8 px-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="ultrafast">Lightning (Ultrafast)</option>
                <option value="veryfast">Fast Balanced (Recommended)</option>
                <option value="medium">Archival Compression</option>
              </select>
            </label>
          </div>

          {/* Audio Normalizer Setup */}
          <div className="p-3.5 rounded border border-slate-200 dark:border-[#242c39] bg-slate-50 dark:bg-[#0e1218] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  EBU R128 Audio Normalizer
                </span>
              </div>
              <button
                type="button"
                disabled={isWorking}
                onClick={() =>
                  onChangeConfig({
                    ...exportConfig,
                    normalizeAudio: !exportConfig.normalizeAudio,
                    normalizeTargetLufs: exportConfig.normalizeTargetLufs ?? -14,
                  })
                }
                className={`px-2.5 py-1 rounded text-[11px] font-semibold border cursor-pointer disabled:opacity-50 ${
                  exportConfig.normalizeAudio
                    ? 'bg-emerald-600/15 dark:bg-emerald-600/30 border-emerald-500 dark:border-emerald-400 text-emerald-800 dark:text-emerald-100'
                    : 'bg-white dark:bg-[#141923] border-slate-300 dark:border-[#2a3242] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {exportConfig.normalizeAudio ? 'Normalizer ON' : 'Normalizer OFF'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { lufs: -14, label: '-14 LUFS', desc: 'YouTube / Web' },
                { lufs: -16, label: '-16 LUFS', desc: 'Social / Mobile' },
                { lufs: -23, label: '-23 LUFS', desc: 'Broadcast EBU' },
              ].map((opt) => {
                const selected =
                  exportConfig.normalizeAudio &&
                  (exportConfig.normalizeTargetLufs ?? -14) === opt.lufs;
                return (
                  <button
                    key={opt.lufs}
                    type="button"
                    disabled={isWorking}
                    onClick={() =>
                      onChangeConfig({
                        ...exportConfig,
                        normalizeAudio: true,
                        normalizeTargetLufs: opt.lufs,
                      })
                    }
                    className={`p-2 rounded border text-center cursor-pointer disabled:opacity-50 ${
                      selected
                        ? 'bg-emerald-600/15 dark:bg-emerald-600/20 border-emerald-500 dark:border-emerald-400 text-emerald-800 dark:text-emerald-100'
                        : 'bg-white dark:bg-[#11151d] border-slate-200 dark:border-[#242b38] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                    }`}
                  >
                    <span className="block text-[11px] font-mono-tabular font-semibold">
                      {opt.label}
                    </span>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={audioClipCount === 0 || isWorking}
              onClick={normalizeAllAudioClips}
              className="w-full py-1.5 px-3 rounded bg-blue-50 dark:bg-[#162030] hover:bg-blue-100 dark:hover:bg-blue-600/30 disabled:opacity-40 border border-blue-300 dark:border-blue-500/40 text-xs font-medium text-blue-800 dark:text-blue-200 cursor-pointer transition-colors"
            >
              Auto-Level All {audioClipCount} Audio Clip{audioClipCount === 1 ? '' : 's'}
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={exportConfig.autoDownload}
              onChange={(e) => onChangeConfig({ ...exportConfig, autoDownload: e.target.checked })}
              className="rounded border-slate-300 dark:border-[#2a303d] bg-white dark:bg-[#0e1116] text-blue-600"
            />
            <span>Auto-download rendered file when complete</span>
          </label>
        </div>
      </section>

      {/* Right: Live Transitions & Music Playback + Direct In-Page Render */}
      <section className="lg:col-span-7 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#171b22] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Live Playback, Spectrum &amp; Direct Render
            </h2>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono-tabular text-slate-500 dark:text-slate-400">
            <span>{visualClipCount} visual</span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1">
              <Music className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              {audioClipCount} audio
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-900 dark:text-slate-200 font-semibold">
              {totalDuration.toFixed(2)}s
            </span>
          </div>
        </div>

        <div className="p-4 flex-1 flex flex-col justify-between gap-3.5 overflow-y-auto">
          {clips.length === 0 ? (
            <div
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault();
                  setDropActive(true);
                }
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(e) => {
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  e.preventDefault();
                  setDropActive(false);
                  onUploadFiles(e.dataTransfer.files);
                }
              }}
              className={`flex-1 min-h-[320px] rounded-md border border-dashed p-6 flex flex-col items-center justify-center text-center gap-3.5 transition-colors ${
                dropActive
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/25'
                  : 'border-slate-300 dark:border-[#2b3342] bg-slate-50 dark:bg-[#0d1016]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_MEDIA_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onUploadFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Drop Media or Load Sample Assets
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md leading-relaxed">
                Upload photos, videos, or music tracks here—or click <strong className="font-semibold">Auto-Select &amp; Play Music</strong> in the setup panel to build a beat-synced edit instantly.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={loadingSample || uploading}
                  onClick={onLoadSamplePack}
                  className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {loadingSample ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderPlus className="w-3.5 h-3.5" />
                  )}
                  <span>Load Sample Pack (120 BPM)</span>
                </button>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded bg-white dark:bg-[#1b2029] hover:bg-slate-100 dark:hover:bg-[#252c38] border border-slate-300 dark:border-[#2f3746] disabled:opacity-50 text-slate-800 dark:text-slate-100 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  {uploading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  )}
                  <span>{uploading ? 'Uploading...' : 'Upload Your Media'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-3.5">
              {/* Live Audio + Transition + Opacity + Spectrum Preview Stage */}
              {!isPreviewDetached && (
                <div className="h-[310px] sm:h-[360px] flex flex-col">
                  <PreviewCanvas
                    tracks={tracks}
                    clips={clips}
                    assetsMap={assetsMap}
                    selectedClipId={selectedClipId}
                    colorGrade={colorGrade}
                    bypassGrade={bypassGrade}
                    resolution={exportConfig.resolution}
                    fps={exportConfig.fps}
                    playhead={playhead}
                    isPlaying={isPlaying}
                    masterMuted={masterMuted}
                    normalizeAudio={Boolean(exportConfig.normalizeAudio)}
                    normalizeTargetLufs={exportConfig.normalizeTargetLufs ?? -14}
                    loadingSample={loadingSample}
                    uploading={uploading}
                    defaultShowSpectrum
                    clarityMode={clarityMode}
                    extendedScreenCount={extendedScreenCount}
                    onClarityModeChange={onClarityModeChange}
                    onDetachPreview={onDetachPreview}
                    onPlayheadChange={onPlayheadChange}
                    onSelectClip={onSelectClip}
                    onUpdateClip={onUpdateClip}
                    onCommitHistory={onCommitHistory}
                    onTogglePlay={onTogglePlay}
                    onToggleMute={onToggleMasterMute}
                    onLoadSamplePack={onLoadSamplePack}
                    onUploadFiles={onUploadFiles}
                  />
                </div>
              )}

              {/* Dedicated Scrubber Strip */}
              {totalDuration > 0 && (
                <div className="px-3.5 py-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-200 dark:border-[#232935] flex items-center gap-3">
                  <span className="text-[11px] font-mono-tabular text-slate-700 dark:text-slate-300 shrink-0">
                    {formatTimecode(playhead)} / {formatTimecode(totalDuration)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={totalDuration}
                    step={0.05}
                    value={Math.min(playhead, totalDuration)}
                    onChange={(e) => onSeekPlayhead(Number(e.target.value))}
                    className="studio-slider flex-1"
                    title="Scrub timeline to inspect transitions, opacity & audio meters"
                  />
                  <span className="text-[11px] font-mono-tabular text-emerald-700 dark:text-emerald-300 shrink-0">
                    {masterMuted || meter.estimatedLufs <= -58
                      ? '-∞ LUFS'
                      : `${meter.estimatedLufs.toFixed(1)} LUFS`}
                  </span>
                </div>
              )}

              {/* Summary Strip + Primary Render Button */}
              <div className="p-3.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-200 dark:border-[#252b36] flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Ready to Render · {exportConfig.resolution.replace('x', '×')} @ {exportConfig.fps} fps (
                    {exportConfig.format.toUpperCase()})
                  </p>
                  <p className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                    Profile: {exportConfig.speedProfile} · Opacity: {Math.round(autoOpts.clipOpacity * 100)}% · Audio:{' '}
                    {exportConfig.normalizeAudio
                      ? `Normalized (${exportConfig.normalizeTargetLufs ?? -14} LUFS)`
                      : 'Direct 48 kHz Mix'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onOpenTimelineMode}
                    className="px-3 py-2 rounded bg-slate-200 dark:bg-[#181d26] hover:bg-slate-300 dark:hover:bg-[#222936] border border-slate-300 dark:border-[#2c3442] text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer whitespace-nowrap"
                  >
                    Edit Timeline
                  </button>
                  <button
                    type="button"
                    disabled={isWorking || clips.length === 0}
                    onClick={onStartRender}
                    className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {isWorking ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isWorking
                        ? `Rendering (${renderJob?.progress ?? 0}%)...`
                        : isDone
                          ? 'Render Again'
                          : 'Start Fast Render'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Live FFmpeg Progress & In-Page Video Output Player */}
              {renderJob && (
                <div className="p-3.5 rounded bg-slate-50 dark:bg-[#0b0e14] border border-slate-200 dark:border-[#232935] flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      {isWorking && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                      {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      {isFailed && <AlertCircle className="w-4 h-4 text-red-500" />}
                      <span>
                        {isWorking
                          ? 'FFmpeg Render Running on Server...'
                          : isDone
                            ? 'Render Complete — Ready to Watch & Save'
                            : 'Render Failed'}
                      </span>
                    </span>
                    <span className="font-mono-tabular text-slate-600 dark:text-slate-300">
                      {renderJob.progress}%{renderJob.speed ? ` · ${renderJob.speed}` : ''}
                      {renderJob.elapsedMs
                        ? ` · ${(renderJob.elapsedMs / 1000).toFixed(1)}s`
                        : ''}
                    </span>
                  </div>

                  <div className="h-2 rounded-full bg-slate-200 dark:bg-[#1a202c] overflow-hidden">
                    <div
                      style={{ width: `${renderJob.progress}%` }}
                      className={`h-full transition-all duration-200 ${
                        isFailed ? 'bg-red-500' : isDone ? 'bg-emerald-500' : 'bg-blue-500'
                      }`}
                    />
                  </div>

                  {isFailed && (
                    <div className="p-3 rounded bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-700/50 text-xs text-red-800 dark:text-red-200 break-words">
                      {renderJob.error}
                    </div>
                  )}

                  {isDone ? (
                    <div className="flex flex-col gap-2.5 pt-1">
                      <video
                        key={renderJob.jobId}
                        src={`/api/render/${renderJob.jobId}/download?inline=1`}
                        controls
                        className="w-full max-h-[260px] rounded bg-black border border-slate-300 dark:border-[#242b38]"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400">
                          {renderJob.outputName} · {formatBytes(renderJob.outputSize || 0)} ·{' '}
                          {((renderJob.elapsedMs || 0) / 1000).toFixed(1)}s render time
                        </span>
                        <button
                          type="button"
                          disabled={downloadingPct !== null}
                          onClick={handleDownloadFile}
                          className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          {downloadingPct !== null ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {downloadingPct !== null
                              ? `Downloading ${downloadingPct}%...`
                              : 'Download Video File'}
                          </span>
                        </button>
                      </div>
                      {downloadErr && (
                        <p className="text-xs text-red-600 dark:text-red-400">{downloadErr}</p>
                      )}
                    </div>
                  ) : (
                    !isFailed && (
                      <div className="min-h-[72px] rounded border border-slate-200 dark:border-[#1d232f] bg-slate-100 dark:bg-[#080a0f] flex items-center justify-center text-xs text-slate-600 dark:text-slate-400 px-3 text-center">
                        {isWorking
                          ? 'Compiling frames & audio filters — rendered video will appear here automatically.'
                          : 'Queued for FFmpeg processing...'}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
