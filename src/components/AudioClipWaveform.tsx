import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MediaAsset, TimelineClip } from '../types/editor';
import { applyAudioFadeCurve, evaluateAudioEnvelopeGain } from '../utils/timelineMath';
import {
  DecodedWaveformPeaks,
  getCachedWaveformPeaks,
  loadDecodedWaveformPeaks,
} from '../utils/waveformCache';

interface AudioClipWaveformProps {
  clip: TimelineClip;
  asset?: MediaAsset;
  widthPx: number;
  pxPerSec: number;
}

function sampleLinear(arr: ArrayLike<number>, frac: number): number {
  const n = arr.length;
  if (n === 0) return 0;
  const clamped = Math.max(0, Math.min(1, frac));
  const fIdx = clamped * (n - 1);
  const lo = Math.floor(fIdx);
  const hi = Math.min(n - 1, lo + 1);
  const t = fIdx - lo;
  return (arr[lo] ?? 0) * (1 - t) + (arr[hi] ?? 0) * t;
}

export const AudioClipWaveform: React.FC<AudioClipWaveformProps> = ({
  clip,
  asset,
  widthPx,
  pxPerSec,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaUrl = asset?.fileUrl || asset?.proxyUrl || null;
  const [decodedPeaks, setDecodedPeaks] = useState<DecodedWaveformPeaks | null>(() =>
    getCachedWaveformPeaks(mediaUrl),
  );
  const [heightPx, setHeightPx] = useState<number>(56);

  useEffect(() => {
    if (!mediaUrl) {
      setDecodedPeaks(null);
      return;
    }
    const cached = getCachedWaveformPeaks(mediaUrl);
    if (cached) {
      setDecodedPeaks(cached);
      return;
    }
    let alive = true;
    loadDecodedWaveformPeaks(mediaUrl).then((peaks) => {
      if (alive && peaks) setDecodedPeaks(peaks);
    });
    return () => {
      alive = false;
    };
  }, [mediaUrl]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const syncSize = () => {
      const h = Math.max(24, canvas.clientHeight || 56);
      setHeightPx(h);
    };
    syncSize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
    if (ro) ro.observe(canvas);
    return () => ro?.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(24, Math.round(widthPx));
    const cssH = Math.max(24, Math.round(heightPx));
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.clearRect(0, 0, targetW, targetH);

    const midY = targetH * 0.5;
    const maxHalfH = Math.max(4, targetH * 0.44);

    // Subtle 0 dB center axis line for zero-crossing & silence reference
    ctx.strokeStyle = clip.muted
      ? 'rgba(148, 163, 184, 0.22)'
      : 'rgba(52, 211, 153, 0.24)';
    ctx.lineWidth = Math.max(1, dpr * 0.75);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(midY) + 0.5);
    ctx.lineTo(targetW, Math.round(midY) + 0.5);
    ctx.stroke();

    const metaBars =
      clip.waveform && clip.waveform.length > 0
        ? clip.waveform
        : asset?.waveform && asset.waveform.length > 0
          ? asset.waveform
          : null;

    if (!decodedPeaks && !metaBars) {
      return;
    }

    const speed = Math.max(0.1, clip.speed || 1);
    const trimStart = Math.max(0, clip.trimStart || 0);
    const sourceWindowDur = clip.duration * speed;
    const sourceTotalDur = Math.max(
      0.1,
      decodedPeaks?.duration ||
        asset?.duration ||
        clip.maxSourceDuration ||
        trimStart + sourceWindowDur,
    );

    const srcStartFrac = Math.max(0, Math.min(0.995, trimStart / sourceTotalDur));
    const srcEndFrac = Math.max(
      srcStartFrac + 0.001,
      Math.min(1, (trimStart + sourceWindowDur) / sourceTotalDur),
    );

    const fadeCurve = clip.audioFadeCurve || 'scurve';
    const fadeInDur = Math.max(0, clip.fadeIn || 0);
    const fadeOutDur = Math.max(0, clip.fadeOut || 0);
    const baseVol = clip.volume ?? 1;

    // Sample column count capped nicely for ultra-wide zoomed timelines while preserving 1px sharpness
    const numCols = Math.max(16, Math.min(2400, Math.round(cssW)));
    const upperY = new Float32Array(numCols);
    const lowerY = new Float32Array(numCols);
    const rmsUpperY = new Float32Array(numCols);
    const rmsLowerY = new Float32Array(numCols);
    const hotMask = new Uint8Array(numCols);

    for (let i = 0; i < numCols; i++) {
      const norm = numCols > 1 ? i / (numCols - 1) : 0;
      const srcProgress = clip.reverse ? 1 - norm : norm;
      const srcFrac = srcStartFrac + srcProgress * (srcEndFrac - srcStartFrac);

      const localSec = norm * clip.duration;
      const envGain = evaluateAudioEnvelopeGain(clip.volumeEnvelope, norm, baseVol);

      let fadeMult = 1;
      if (fadeInDur > 0.01 && localSec < fadeInDur) {
        fadeMult *= applyAudioFadeCurve(localSec / fadeInDur, fadeCurve);
      }
      if (fadeOutDur > 0.01 && localSec > clip.duration - fadeOutDur) {
        fadeMult *= applyAudioFadeCurve((clip.duration - localSec) / fadeOutDur, fadeCurve);
      }

      const gainFactor = Math.min(1.85, Math.max(0.02, envGain * fadeMult));

      let posPeak: number;
      let negPeak: number;
      let rmsAmp: number;

      if (decodedPeaks) {
        // Asymmetric true PCM min/max envelope
        posPeak = Math.max(0.02, sampleLinear(decodedPeaks.max, srcFrac));
        negPeak = Math.max(0.02, Math.abs(sampleLinear(decodedPeaks.min, srcFrac)));
        rmsAmp = Math.max(0.015, sampleLinear(decodedPeaks.rms, srcFrac));
      } else {
        // Symmetric peak envelope from clip/asset metadata with smooth linear interpolation
        const barVal = Math.max(0.03, Math.min(1, sampleLinear(metaBars!, srcFrac)));
        posPeak = barVal;
        negPeak = barVal;
        rmsAmp = barVal * 0.62;
      }

      const effPos = Math.min(1.05, posPeak * gainFactor);
      const effNeg = Math.min(1.05, negPeak * gainFactor);
      const effRms = Math.min(1.0, rmsAmp * gainFactor);

      upperY[i] = midY - Math.min(1, effPos) * maxHalfH;
      lowerY[i] = midY + Math.min(1, effNeg) * maxHalfH;
      rmsUpperY[i] = midY - effRms * maxHalfH;
      rmsLowerY[i] = midY + effRms * maxHalfH;

      if (!clip.muted && (effPos > 0.96 || effNeg > 0.96)) {
        hotMask[i] = 1;
      }
    }

    const colStepX = targetW / Math.max(1, numCols - 1);

    // 1. Outer peak waveform silhouette path
    ctx.beginPath();
    for (let i = 0; i < numCols; i++) {
      const x = i * colStepX;
      if (i === 0) ctx.moveTo(x, upperY[i]);
      else ctx.lineTo(x, upperY[i]);
    }
    for (let i = numCols - 1; i >= 0; i--) {
      const x = i * colStepX;
      ctx.lineTo(x, lowerY[i]);
    }
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, midY - maxHalfH, 0, midY + maxHalfH);
    if (clip.muted) {
      grad.addColorStop(0, 'rgba(148, 163, 184, 0.35)');
      grad.addColorStop(0.5, 'rgba(100, 116, 139, 0.45)');
      grad.addColorStop(1, 'rgba(148, 163, 184, 0.35)');
    } else if (clip.backgroundDucking) {
      grad.addColorStop(0, 'rgba(110, 231, 183, 0.52)');
      grad.addColorStop(0.5, 'rgba(16, 185, 129, 0.68)');
      grad.addColorStop(1, 'rgba(110, 231, 183, 0.52)');
    } else {
      grad.addColorStop(0, 'rgba(52, 211, 153, 0.58)');
      grad.addColorStop(0.5, 'rgba(16, 185, 129, 0.78)');
      grad.addColorStop(1, 'rgba(52, 211, 153, 0.58)');
    }
    ctx.fillStyle = grad;
    ctx.fill();

    // Crisp waveform boundary stroke
    ctx.strokeStyle = clip.muted
      ? 'rgba(148, 163, 184, 0.55)'
      : 'rgba(110, 231, 183, 0.78)';
    ctx.lineWidth = Math.max(1, 0.9 * dpr);
    ctx.stroke();

    // 2. Inner RMS energy core path
    ctx.beginPath();
    for (let i = 0; i < numCols; i++) {
      const x = i * colStepX;
      if (i === 0) ctx.moveTo(x, rmsUpperY[i]);
      else ctx.lineTo(x, rmsUpperY[i]);
    }
    for (let i = numCols - 1; i >= 0; i--) {
      const x = i * colStepX;
      ctx.lineTo(x, rmsLowerY[i]);
    }
    ctx.closePath();
    ctx.fillStyle = clip.muted
      ? 'rgba(148, 163, 184, 0.25)'
      : 'rgba(167, 243, 208, 0.32)';
    ctx.fill();

    // 3. Hot / near-clipping peak highlights (> -0.35 dBFS)
    ctx.fillStyle = 'rgba(251, 191, 36, 0.85)';
    for (let i = 0; i < numCols; i++) {
      if (!hotMask[i]) continue;
      const x = i * colStepX;
      ctx.fillRect(x - dpr * 0.5, upperY[i], Math.max(1.5, dpr * 1.4), 2 * dpr);
      ctx.fillRect(x - dpr * 0.5, lowerY[i] - 2 * dpr, Math.max(1.5, dpr * 1.4), 2 * dpr);
    }

    // 4. Beat transient grid markers mapped inside this clip's trimmed window
    const beats = clip.beats && clip.beats.length > 0 ? clip.beats : asset?.beats;
    if (beats && beats.length > 0 && pxPerSec >= 28) {
      const srcEndSec = trimStart + sourceWindowDur;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.34)';
      ctx.lineWidth = Math.max(1, dpr * 0.8);
      for (let b = 0; b < beats.length; b++) {
        const bt = beats[b];
        if (bt < trimStart || bt > srcEndSec) continue;
        const localSec = clip.reverse
          ? clip.duration - (bt - trimStart) / speed
          : (bt - trimStart) / speed;
        const bx = Math.round(localSec * pxPerSec * dpr) + 0.5;
        ctx.beginPath();
        ctx.moveTo(bx, 0);
        ctx.lineTo(bx, targetH);
        ctx.stroke();
      }
    }
  }, [
    decodedPeaks,
    clip.waveform,
    asset?.waveform,
    asset?.duration,
    asset?.beats,
    clip.beats,
    clip.duration,
    clip.trimStart,
    clip.maxSourceDuration,
    clip.speed,
    clip.reverse,
    clip.volume,
    clip.volumeEnvelope,
    clip.fadeIn,
    clip.fadeOut,
    clip.audioFadeCurve,
    clip.muted,
    clip.backgroundDucking,
    widthPx,
    pxPerSec,
    heightPx,
  ]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={`Audio waveform for ${clip.name}`}
      className="absolute inset-0 w-full h-full pointer-events-none opacity-85"
    />
  );
};
