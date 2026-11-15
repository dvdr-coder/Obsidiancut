/**
 * Shared Web Audio AnalyserNode bus for real-time 20 Hz - 16 kHz FFT audio spectrum visualization.
 * Decouples 60fps canvas spectrum polling from React component state updates.
 */

let activeAnalyser: AnalyserNode | null = null;
let activeContext: AudioContext | null = null;
let fftScratch: Uint8Array<ArrayBuffer> | null = null;

export function registerAudioAnalyser(ctx: AudioContext, analyser: AnalyserNode): void {
  activeContext = ctx;
  activeAnalyser = analyser;
  const needed = analyser.frequencyBinCount;
  if (!fftScratch || fftScratch.length !== needed) {
    fftScratch = new Uint8Array(new ArrayBuffer(needed));
  }
}

export function unregisterAudioAnalyser(analyser?: AnalyserNode | null): void {
  if (!analyser || activeAnalyser === analyser) {
    activeAnalyser = null;
    activeContext = null;
  }
}

/**
 * Samples the active Web Audio AnalyserNode into `bandCount` logarithmically spaced
 * frequency bins (~32 Hz .. ~16 kHz). Returns true if live non-silent FFT data was captured.
 */
export function sampleLiveFftSpectrum(outBands: number[], bandCount: number): boolean {
  if (!activeAnalyser || !activeContext || activeContext.state !== 'running') {
    return false;
  }

  const binCount = activeAnalyser.frequencyBinCount;
  if (binCount <= 0) return false;

  if (!fftScratch || fftScratch.length !== binCount) {
    fftScratch = new Uint8Array(new ArrayBuffer(binCount));
  }

  activeAnalyser.getByteFrequencyData(fftScratch);

  const sampleRate = activeContext.sampleRate || 48000;
  const nyquist = sampleRate * 0.5;
  const minHz = 32;
  const maxHz = Math.min(16500, nyquist * 0.92);
  const logSpan = Math.log(maxHz / minHz);

  let maxVal = 0;
  if (outBands.length !== bandCount) {
    outBands.length = bandCount;
  }

  for (let b = 0; b < bandCount; b++) {
    const fLo = minHz * Math.exp((b / bandCount) * logSpan);
    const fHi = minHz * Math.exp(((b + 1) / bandCount) * logSpan);
    const idxLo = Math.max(0, Math.min(binCount - 1, Math.floor((fLo / nyquist) * binCount)));
    const idxHi = Math.max(idxLo, Math.min(binCount - 1, Math.ceil((fHi / nyquist) * binCount)));

    let peak = 0;
    let sum = 0;
    let count = 0;
    for (let i = idxLo; i <= idxHi; i++) {
      const v = fftScratch[i] / 255;
      if (v > peak) peak = v;
      sum += v;
      count++;
    }
    const avg = count > 0 ? sum / count : 0;
    const val = Math.min(1, peak * 0.65 + avg * 0.35);
    outBands[b] = val;
    if (val > maxVal) maxVal = val;
  }

  return maxVal > 0.015;
}
