/**
 * Client-side Web Audio PCM peak cache for precision timeline waveform rendering.
 * Decodes audio assets once per URL into 1,600 min/max/rms bins while allowing
 * immediate first-paint rendering from clip/asset metadata waveforms.
 */

export interface DecodedWaveformPeaks {
  min: Float32Array;
  max: Float32Array;
  rms: Float32Array;
  duration: number;
  bins: number;
}

const PEAK_BINS = 1600;
const resolvedCache = new Map<string, DecodedWaveformPeaks | null>();
const inflightCache = new Map<string, Promise<DecodedWaveformPeaks | null>>();

let decodeCtx: AudioContext | null = null;

function getDecodeContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!decodeCtx || decodeCtx.state === 'closed') {
    decodeCtx = new Ctor();
  }
  return decodeCtx;
}

export function getCachedWaveformPeaks(url?: string | null): DecodedWaveformPeaks | null {
  if (!url) return null;
  return resolvedCache.get(url) ?? null;
}

export function loadDecodedWaveformPeaks(url?: string | null): Promise<DecodedWaveformPeaks | null> {
  if (!url) return Promise.resolve(null);
  if (resolvedCache.has(url)) {
    return Promise.resolve(resolvedCache.get(url) ?? null);
  }
  const existing = inflightCache.get(url);
  if (existing) return existing;

  const task = (async (): Promise<DecodedWaveformPeaks | null> => {
    try {
      const ctx = getDecodeContext();
      if (!ctx) {
        resolvedCache.set(url, null);
        return null;
      }
      const res = await fetch(url);
      if (!res.ok) {
        resolvedCache.set(url, null);
        return null;
      }
      const arrBuf = await res.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrBuf);
      const totalSamples = audioBuf.length;
      if (totalSamples < 16) {
        resolvedCache.set(url, null);
        return null;
      }

      const numChannels = Math.max(1, audioBuf.numberOfChannels);
      const channels: Float32Array[] = [];
      for (let c = 0; c < numChannels; c++) {
        channels.push(audioBuf.getChannelData(c));
      }

      const bins = PEAK_BINS;
      const minArr = new Float32Array(bins);
      const maxArr = new Float32Array(bins);
      const rmsArr = new Float32Array(bins);

      let globalMax = 0.0001;
      const samplesPerBin = totalSamples / bins;
      const stride = Math.max(1, Math.floor(samplesPerBin / 24));

      for (let b = 0; b < bins; b++) {
        const start = Math.floor(b * samplesPerBin);
        const end = Math.min(totalSamples, Math.max(start + 1, Math.floor((b + 1) * samplesPerBin)));
        let lo = 1;
        let hi = -1;
        let sumSq = 0;
        let count = 0;

        for (let i = start; i < end; i += stride) {
          let mono = 0;
          for (let c = 0; c < numChannels; c++) {
            mono += channels[c][i] || 0;
          }
          mono /= numChannels;
          if (mono < lo) lo = mono;
          if (mono > hi) hi = mono;
          sumSq += mono * mono;
          count++;
        }

        if (count === 0) {
          lo = 0;
          hi = 0;
        }
        minArr[b] = lo;
        maxArr[b] = hi;
        rmsArr[b] = count > 0 ? Math.sqrt(sumSq / count) : 0;
        const absPeak = Math.max(Math.abs(lo), Math.abs(hi));
        if (absPeak > globalMax) globalMax = absPeak;
      }

      // Normalize to full 0..1 headroom scale
      const invNorm = globalMax > 0.0001 ? 1 / globalMax : 1;
      for (let b = 0; b < bins; b++) {
        minArr[b] = Math.max(-1, Math.min(1, minArr[b] * invNorm));
        maxArr[b] = Math.max(-1, Math.min(1, maxArr[b] * invNorm));
        rmsArr[b] = Math.max(0, Math.min(1, rmsArr[b] * invNorm));
      }

      const result: DecodedWaveformPeaks = {
        min: minArr,
        max: maxArr,
        rms: rmsArr,
        duration: audioBuf.duration,
        bins,
      };
      resolvedCache.set(url, result);
      return result;
    } catch {
      resolvedCache.set(url, null);
      return null;
    } finally {
      inflightCache.delete(url);
    }
  })();

  inflightCache.set(url, task);
  return task;
}
