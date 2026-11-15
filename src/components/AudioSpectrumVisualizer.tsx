import React, { useEffect, useRef, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { TimelineClip, TimelineTrack } from '../types/editor';
import {
  computeAudioSpectrumBands,
  formatFrequencyHz,
  linearToDb,
} from '../utils/timelineMath';
import { sampleLiveFftSpectrum } from '../utils/liveAudioSpectrum';

export type SpectrumDisplayMode = 'bars' | 'curve' | 'mirror';

interface AudioSpectrumVisualizerProps {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  playhead: number;
  isPlaying: boolean;
  masterMuted: boolean;
  normalizeAudio?: boolean;
  normalizeTargetLufs?: number;
  compact?: boolean;
  bandCount?: number;
  heightClass?: string;
  className?: string;
  title?: string;
}

const FREQ_TICKS = [
  { hz: 40, label: '40Hz' },
  { hz: 120, label: '120Hz' },
  { hz: 400, label: '400Hz' },
  { hz: 1000, label: '1k' },
  { hz: 3200, label: '3.2k' },
  { hz: 10000, label: '10k' },
];

function freqToFrac(hz: number): number {
  const minHz = 36;
  const maxHz = 15500;
  return Math.max(0, Math.min(1, Math.log(hz / minHz) / Math.log(maxHz / minHz)));
}

export const AudioSpectrumVisualizer: React.FC<AudioSpectrumVisualizerProps> = ({
  tracks,
  clips,
  playhead,
  isPlaying,
  masterMuted,
  normalizeAudio = false,
  normalizeTargetLufs = -14,
  compact = false,
  bandCount = compact ? 28 : 44,
  heightClass = compact ? 'h-12' : 'h-28',
  className = '',
  title = 'Real-Time Audio Spectrum (RTA · 36 Hz – 15.5 kHz)',
}) => {
  const [displayMode, setDisplayMode] = useState<SpectrumDisplayMode>('bars');
  const [sourceTag, setSourceTag] = useState<'LIVE FFT' | 'DSP RTA' | 'MUTED'>('DSP RTA');
  const [readout, setReadout] = useState<{ peakDb: number; dominantHz: string }>({
    peakDb: -60,
    dominantHz: '--',
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedRef = useRef<number[]>(new Array(bandCount).fill(0));
  const peaksRef = useRef<number[]>(new Array(bandCount).fill(0));
  const peakHoldTicksRef = useRef<number[]>(new Array(bandCount).fill(0));
  const fftBufferRef = useRef<number[]>(new Array(bandCount).fill(0));
  const propsRef = useRef({
    tracks,
    clips,
    playhead,
    isPlaying,
    masterMuted,
    normalizeAudio,
    normalizeTargetLufs,
    bandCount,
    displayMode,
    compact,
  });

  propsRef.current = {
    tracks,
    clips,
    playhead,
    isPlaying,
    masterMuted,
    normalizeAudio,
    normalizeTargetLufs,
    bandCount,
    displayMode,
    compact,
  };

  useEffect(() => {
    if (smoothedRef.current.length !== bandCount) {
      smoothedRef.current = new Array(bandCount).fill(0);
      peaksRef.current = new Array(bandCount).fill(0);
      peakHoldTicksRef.current = new Array(bandCount).fill(0);
      fftBufferRef.current = new Array(bandCount).fill(0);
    }
  }, [bandCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let rafId = 0;
    let frameCounter = 0;
    let lastSource: 'LIVE FFT' | 'DSP RTA' | 'MUTED' = 'DSP RTA';

    const syncCanvasSize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = parent.getBoundingClientRect();
      const targetW = Math.max(120, Math.round(rect.width * dpr));
      const targetH = Math.max(36, Math.round(rect.height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };

    syncCanvasSize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncCanvasSize) : null;
    if (ro && canvas.parentElement) ro.observe(canvas.parentElement);

    const drawFrame = () => {
      const p = propsRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const count = p.bandCount;

      const smoothed = smoothedRef.current;
      const peaks = peaksRef.current;
      const holdTicks = peakHoldTicksRef.current;
      const fftBands = fftBufferRef.current;

      const dspSnap = computeAudioSpectrumBands(
        p.tracks,
        p.clips,
        p.playhead,
        p.masterMuted,
        p.isPlaying,
        p.normalizeAudio,
        p.normalizeTargetLufs,
        count,
      );

      let usedLiveFft = false;
      if (!p.masterMuted && p.isPlaying) {
        usedLiveFft = sampleLiveFftSpectrum(fftBands, count);
      }

      const nextSource: 'LIVE FFT' | 'DSP RTA' | 'MUTED' = p.masterMuted
        ? 'MUTED'
        : usedLiveFft
          ? 'LIVE FFT'
          : 'DSP RTA';
      if (nextSource !== lastSource) {
        lastSource = nextSource;
        setSourceTag(nextSource);
      }

      // Blend live Web Audio FFT when active, otherwise follow deterministic DSP + waveform model
      let maxBandVal = 0;
      let maxBandIdx = 0;
      let stillSettling = false;

      for (let i = 0; i < count; i++) {
        const target = p.masterMuted
          ? 0
          : usedLiveFft
            ? Math.min(1, fftBands[i] * 0.8 + dspSnap.bands[i] * 0.25)
            : dspSnap.bands[i];

        const cur = smoothed[i] || 0;
        const rate = target >= cur ? (p.isPlaying ? 0.58 : 0.42) : p.isPlaying ? 0.24 : 0.2;
        const nextVal = cur + (target - cur) * rate;
        smoothed[i] = nextVal < 0.002 ? 0 : nextVal;
        if (Math.abs(target - nextVal) > 0.004) stillSettling = true;

        if (smoothed[i] >= peaks[i]) {
          peaks[i] = smoothed[i];
          holdTicks[i] = 20;
        } else if (holdTicks[i] > 0) {
          holdTicks[i] -= 1;
          stillSettling = true;
        } else if (peaks[i] > 0.004) {
          peaks[i] = Math.max(smoothed[i], peaks[i] - 0.016);
          stillSettling = true;
        } else {
          peaks[i] = 0;
        }

        if (smoothed[i] > maxBandVal) {
          maxBandVal = smoothed[i];
          maxBandIdx = i;
        }
      }

      if (frameCounter % 5 === 0 || !p.isPlaying) {
        const domHz = 36 * Math.pow(15500 / 36, maxBandIdx / Math.max(1, count - 1));
        setReadout({
          peakDb: maxBandVal <= 0.01 ? -60 : linearToDb(maxBandVal),
          dominantHz: maxBandVal > 0.025 ? formatFrequencyHz(domHz) : '--',
        });
      }
      frameCounter += 1;

      // Clear & paint background
      ctx.clearRect(0, 0, w, h);
      const isDark = document.documentElement.classList.contains('dark');
      ctx.fillStyle = isDark ? '#070a0f' : '#0f172a';
      ctx.fillRect(0, 0, w, h);

      // Subtle dB & frequency gridlines
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.11)';
      ctx.lineWidth = Math.max(1, dpr * 0.75);
      const rows = p.compact ? 2 : 3;
      for (let r = 1; r <= rows; r++) {
        const gy = Math.round((r / (rows + 1)) * h) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }
      if (!p.compact) {
        for (const tick of FREQ_TICKS) {
          const gx = Math.round(freqToFrac(tick.hz) * w) + 0.5;
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, h);
          ctx.stroke();
        }
      }

      const padX = Math.round(4 * dpr);
      const padY = Math.round(3 * dpr);
      const drawW = Math.max(10, w - padX * 2);
      const drawH = Math.max(10, h - padY * 2);

      // Vertical bar gradient: emerald -> cyan/sky -> amber -> red top
      const grad = ctx.createLinearGradient(0, padY + drawH, 0, padY);
      grad.addColorStop(0.0, '#10b981');
      grad.addColorStop(0.45, '#06b6d4');
      grad.addColorStop(0.76, '#f59e0b');
      grad.addColorStop(1.0, '#ef4444');

      const mode = p.compact && p.displayMode === 'curve' ? 'bars' : p.displayMode;

      if (mode === 'curve') {
        ctx.beginPath();
        ctx.moveTo(padX, padY + drawH);
        for (let i = 0; i < count; i++) {
          const x = padX + (i / Math.max(1, count - 1)) * drawW;
          const y = padY + drawH - smoothed[i] * drawH;
          if (i === 0) {
            ctx.lineTo(x, y);
          } else {
            const prevX = padX + ((i - 1) / Math.max(1, count - 1)) * drawW;
            const prevY = padY + drawH - smoothed[i - 1] * drawH;
            const cx = (prevX + x) * 0.5;
            ctx.quadraticCurveTo(prevX, prevY, cx, (prevY + y) * 0.5);
            if (i === count - 1) ctx.lineTo(x, y);
          }
        }
        ctx.lineTo(padX + drawW, padY + drawH);
        ctx.closePath();
        ctx.save();
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();

        // Crisp glowing top stroke
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const x = padX + (i / Math.max(1, count - 1)) * drawW;
          const y = padY + drawH - smoothed[i] * drawH;
          if (i === 0) ctx.moveTo(x, y);
          else {
            const prevX = padX + ((i - 1) / Math.max(1, count - 1)) * drawW;
            const prevY = padY + drawH - smoothed[i - 1] * drawH;
            const cx = (prevX + x) * 0.5;
            ctx.quadraticCurveTo(prevX, prevY, cx, (prevY + y) * 0.5);
            if (i === count - 1) ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = Math.max(1.5, 1.8 * dpr);
        ctx.stroke();

        // Peak-hold envelope line
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const x = padX + (i / Math.max(1, count - 1)) * drawW;
          const py = padY + drawH - peaks[i] * drawH;
          if (i === 0) ctx.moveTo(x, py);
          else ctx.lineTo(x, py);
        }
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.stroke();
      } else if (mode === 'mirror') {
        const slotW = drawW / count;
        const barW = Math.max(1.5 * dpr, slotW * 0.72);
        const midY = padY + drawH * 0.5;
        const mirrorGrad = ctx.createLinearGradient(0, padY, 0, padY + drawH);
        mirrorGrad.addColorStop(0.0, '#ef4444');
        mirrorGrad.addColorStop(0.22, '#f59e0b');
        mirrorGrad.addColorStop(0.5, '#10b981');
        mirrorGrad.addColorStop(0.78, '#f59e0b');
        mirrorGrad.addColorStop(1.0, '#ef4444');
        ctx.fillStyle = mirrorGrad;

        for (let i = 0; i < count; i++) {
          const val = Math.max(0.02, smoothed[i]);
          const halfH = Math.max(1.5 * dpr, val * (drawH * 0.48));
          const x = padX + i * slotW + (slotW - barW) * 0.5;
          ctx.fillRect(x, midY - halfH, barW, halfH * 2);

          if (peaks[i] > 0.03) {
            const pHalf = peaks[i] * (drawH * 0.48);
            ctx.fillStyle = peaks[i] > 0.9 ? '#f87171' : 'rgba(248,250,252,0.85)';
            ctx.fillRect(x, midY - pHalf - dpr, barW, Math.max(1.5, dpr * 1.4));
            ctx.fillRect(x, midY + pHalf, barW, Math.max(1.5, dpr * 1.4));
            ctx.fillStyle = mirrorGrad;
          }
        }
      } else {
        // Default Bars + Peak Hold caps
        const slotW = drawW / count;
        const barW = Math.max(1.5 * dpr, slotW * 0.72);

        for (let i = 0; i < count; i++) {
          const val = smoothed[i];
          const barH = Math.max(val > 0.005 ? 2 * dpr : dpr, val * drawH);
          const x = padX + i * slotW + (slotW - barW) * 0.5;
          const y = padY + drawH - barH;

          ctx.fillStyle = val > 0.005 ? grad : 'rgba(51, 65, 85, 0.45)';
          ctx.fillRect(x, y, barW, barH);

          // Segmented LED cut lines for hardware analyzer aesthetic
          if (!p.compact && barH > 6 * dpr) {
            ctx.fillStyle = 'rgba(7, 10, 15, 0.38)';
            const stepY = Math.max(4, Math.round(4 * dpr));
            for (let sy = padY + drawH - stepY; sy > y; sy -= stepY) {
              ctx.fillRect(x, sy, barW, Math.max(1, dpr));
            }
          }

          if (peaks[i] > 0.025) {
            const peakY = Math.max(padY, padY + drawH - peaks[i] * drawH - 1.5 * dpr);
            ctx.fillStyle = peaks[i] > 0.9 ? '#f87171' : '#f8fafc';
            ctx.fillRect(x, peakY, barW, Math.max(1.5, 1.8 * dpr));
          }
        }
      }

      if (p.isPlaying || stillSettling) {
        rafId = window.requestAnimationFrame(drawFrame);
      } else {
        rafId = 0;
      }
    };

    rafId = window.requestAnimationFrame(drawFrame);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      ro?.disconnect();
    };
  }, [tracks, clips, playhead, isPlaying, masterMuted, normalizeAudio, normalizeTargetLufs, bandCount, displayMode, compact]);

  const modeButtons: { id: SpectrumDisplayMode; label: string }[] = [
    { id: 'bars', label: 'Bars' },
    { id: 'curve', label: 'Curve' },
    { id: 'mirror', label: 'Mirror' },
  ];

  return (
    <div
      className={`rounded-md border border-slate-200 dark:border-[#232936] bg-white dark:bg-[#0e1218] overflow-hidden ${className}`}
    >
      <div
        className={`px-2.5 ${compact ? 'py-1' : 'py-1.5'} border-b border-slate-200 dark:border-[#1e2430] bg-slate-50 dark:bg-[#121720] flex flex-wrap items-center justify-between gap-2`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <AudioLines className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
          <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate">
            {title}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono-tabular font-semibold ${
              sourceTag === 'MUTED'
                ? 'bg-red-500/15 text-red-600 dark:text-red-300'
                : sourceTag === 'LIVE FFT'
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
            }`}
          >
            {sourceTag}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono-tabular text-slate-600 dark:text-slate-300 whitespace-nowrap">
            Peak {readout.peakDb <= -58 ? '-∞' : `${readout.peakDb.toFixed(1)} dB`} · {readout.dominantHz}
          </span>
          <div className="inline-flex items-center p-0.5 rounded bg-slate-200/80 dark:bg-[#090c12] border border-slate-300 dark:border-[#242b38]">
            {modeButtons.map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setDisplayMode(btn.id)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-medium cursor-pointer transition-colors ${
                  displayMode === btn.id
                    ? 'bg-cyan-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`relative w-full ${heightClass}`}>
        <canvas ref={canvasRef} className="w-full h-full block" aria-label="Audio Frequency Spectrum Visualizer" />
        {!compact && (
          <div className="pointer-events-none absolute top-1 left-1.5 bottom-4 flex flex-col justify-between text-[8px] font-mono-tabular text-slate-400/75">
            <span>0 dB</span>
            <span>-24</span>
            <span>-48</span>
          </div>
        )}
      </div>

      {!compact && (
        <div className="relative h-4 bg-slate-900 dark:bg-[#070a0f] border-t border-slate-800 dark:border-[#1a202c] px-2">
          {FREQ_TICKS.map((tick) => (
            <span
              key={tick.hz}
              style={{ left: `${(freqToFrac(tick.hz) * 100).toFixed(1)}%` }}
              className="absolute top-0.5 -translate-x-1/2 text-[8px] font-mono-tabular text-slate-400"
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
