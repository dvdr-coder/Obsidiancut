import React from 'react';
import { CheckCircle2, Download, Loader2, Minimize2, X, AlertCircle } from 'lucide-react';
import { ExportConfig, ExportFps, RenderJobStatus } from '../types/editor';
import { formatBytes } from '../utils/timelineMath';

interface ExportModalProps {
  isOpen: boolean;
  config: ExportConfig;
  job: RenderJobStatus | null;
  slideCount: number;
  totalDuration: number;
  onChangeConfig: (next: ExportConfig) => void;
  onStartRender: () => void;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  config,
  job,
  slideCount,
  totalDuration,
  onChangeConfig,
  onStartRender,
  onClose,
}) => {
  if (!isOpen) return null;

  const isWorking = job?.status === 'queued' || job?.status === 'rendering';
  const isDone = job?.status === 'completed';
  const isFailed = job?.status === 'failed';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#282e3b] rounded-lg overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#232832] flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Export High-Definition Video</h3>
          <button
            type="button"
            onClick={onClose}
            title={isWorking ? 'Minimize (continues rendering in background)' : 'Close'}
            className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#232832] cursor-pointer"
          >
            {isWorking ? <Minimize2 className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Summary */}
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pb-3 border-b border-slate-200 dark:border-[#232832]">
            <span>Master Output · 48kHz CFR Sync</span>
            <span className="font-mono-tabular text-slate-800 dark:text-slate-200">
              {slideCount} clips · {totalDuration.toFixed(2)}s total
            </span>
          </div>

          {/* Export Configuration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 dark:text-slate-400">Resolution</label>
              <select
                disabled={isWorking}
                value={config.resolution}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    resolution: e.target.value as ExportConfig['resolution'],
                  })
                }
                className="h-9 px-2.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="1280x720">720p HD (1280×720)</option>
                <option value="1920x1080">1080p Full HD (1920×1080)</option>
                <option value="3840x2160">4K UHD (3840×2160)</option>
                <option value="1080x1920">Vertical Reels (1080×1920)</option>
                <option value="1080x1080">Square Social (1080×1080)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 dark:text-slate-400">Frame Rate (CFR Locked)</label>
              <select
                disabled={isWorking}
                value={config.fps}
                onChange={(e) =>
                  onChangeConfig({ ...config, fps: Number(e.target.value) as ExportFps })
                }
                className="h-9 px-2.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100"
              >
                <option value={23.976}>23.976 fps (NTSC Film)</option>
                <option value={24}>24 fps (True Cinema)</option>
                <option value={29.97}>29.97 fps (NTSC Broadcast)</option>
                <option value={30}>30 fps (Standard)</option>
                <option value={59.94}>59.94 fps (Broadcast High)</option>
                <option value={60}>60 fps (Ultra Smooth)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 dark:text-slate-400">Video Format</label>
              <select
                disabled={isWorking}
                value={config.format}
                onChange={(e) =>
                  onChangeConfig({ ...config, format: e.target.value as ExportConfig['format'] })
                }
                className="h-9 px-2.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="mp4">MP4 (H.264 + AAC 48kHz)</option>
                <option value="mov">MOV (QuickTime H.264)</option>
                <option value="webm">WebM (VP8 + Vorbis)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-600 dark:text-slate-400">Render Speed Profile</label>
              <select
                disabled={isWorking}
                value={config.speedProfile}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    speedProfile: e.target.value as ExportConfig['speedProfile'],
                  })
                }
                className="h-9 px-2.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="ultrafast">Lightning (Ultrafast)</option>
                <option value="veryfast">Balanced Fast (Recommended)</option>
                <option value="medium">Archival Compression</option>
              </select>
            </div>
          </div>

          <div className="p-3 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-200 dark:border-[#232935] flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-800 dark:text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                disabled={isWorking}
                checked={Boolean(config.normalizeAudio)}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    normalizeAudio: e.target.checked,
                    normalizeTargetLufs: config.normalizeTargetLufs ?? -14,
                  })
                }
                className="rounded border-slate-300 dark:border-[#2a303d] bg-white dark:bg-[#0e1116] text-emerald-500"
              />
              <span>Normalize Master Audio (EBU R128 Loudness)</span>
            </label>
            <select
              disabled={isWorking || !config.normalizeAudio}
              aria-label="Master Normalization Target LUFS"
              value={config.normalizeTargetLufs ?? -14}
              onChange={(e) =>
                onChangeConfig({
                  ...config,
                  normalizeTargetLufs: Number(e.target.value),
                })
              }
              className="h-7 px-2 rounded bg-white dark:bg-[#141821] border border-slate-300 dark:border-[#2a303d] text-xs font-mono-tabular text-slate-900 dark:text-slate-100 disabled:opacity-45"
            >
              <option value={-14}>-14 LUFS (Web / YouTube)</option>
              <option value={-16}>-16 LUFS (Mobile / Podcast)</option>
              <option value={-23}>-23 LUFS (Broadcast EBU)</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={config.autoDownload}
              onChange={(e) => onChangeConfig({ ...config, autoDownload: e.target.checked })}
              className="rounded border-slate-300 dark:border-[#2a303d] bg-white dark:bg-[#0e1116] text-blue-600"
            />
            <span>Automatically download video to local storage when rendering completes</span>
          </label>

          {/* Render Job Progress / Result */}
          {job && (
            <div className="p-3.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-200 dark:border-[#252b36] space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  {isWorking && <Loader2 className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 animate-spin" />}
                  {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />}
                  {isFailed && <AlertCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />}
                  {isWorking
                    ? 'Rendering in background via Python + FFmpeg...'
                    : isDone
                      ? 'Render complete'
                      : 'Render failed'}
                </span>
                <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                  {job.progress}% {job.speed ? `· ${job.speed}` : ''}
                </span>
              </div>

              <div className="h-2 rounded-full bg-slate-200 dark:bg-[#1c212b] overflow-hidden">
                <div
                  style={{ width: `${job.progress}%` }}
                  className={`h-full transition-all duration-200 ${
                    isFailed ? 'bg-red-500' : isDone ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}
                />
              </div>

              {isFailed && <p className="text-xs text-red-600 dark:text-red-400 break-words">{job.error}</p>}

              {isDone && (
                <div className="space-y-2 pt-1">
                  <video
                    src={`/api/render/${job.jobId}/download?inline=1`}
                    controls
                    className="w-full max-h-44 rounded bg-black border border-slate-300 dark:border-[#232832]"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono-tabular">
                      {job.outputName} · {formatBytes(job.outputSize || 0)} ·{' '}
                      {((job.elapsedMs || 0) / 1000).toFixed(1)}s
                    </span>
                    <a
                      href={`/api/render/${job.jobId}/download`}
                      download={job.outputName}
                      className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Save File</span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#111419] flex items-center justify-end gap-2.5">
          {isWorking && (
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded border border-slate-300 dark:border-[#2a303d] text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Continue Editing in Background
            </button>
          )}
          <button
            type="button"
            disabled={isWorking || slideCount === 0}
            onClick={onStartRender}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isWorking ? 'Rendering...' : isDone ? 'Render Again' : 'Start HD Render'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
