import {
  AudioFadeCurve,
  AudioVolumePoint,
  ClipCrop,
  ClipKeyframesMap,
  ClipTransitionMetadata,
  ColorGradeConfig,
  DEFAULT_CLIP_EFFECTS,
  KeyframeEasing,
  KeyframePoint,
  KeyframeProperty,
  MediaAsset,
  MotionType,
  TimelineClip,
  TimelineTrack,
  TitleSpec,
  TransitionType,
} from '../types/editor';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const centis = Math.floor((safe - Math.floor(safe)) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export function formatFrameTimecode(seconds: number, fps = 30): string {
  const safe = Math.max(0, seconds);
  const nominalFps = Math.max(1, Math.round(fps));
  const totalFrames = Math.round(safe * fps);
  const frames = totalFrames % nominalFps;
  const totalSecs = Math.floor(totalFrames / nominalFps);
  const secs = totalSecs % 60;
  const mins = Math.floor(totalSecs / 60) % 60;
  const hrs = Math.floor(totalSecs / 3600);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function computeTimelineDuration(clips: TimelineClip[]): number {
  if (clips.length === 0) return 0;
  let maxEnd = 0;
  for (const c of clips) {
    const end = c.startTime + Math.max(0.1, c.duration);
    if (end > maxEnd) maxEnd = end;
  }
  return Number(maxEnd.toFixed(3));
}

export function resolveFfmpegXfadeFilter(type: TransitionType): string {
  if (type === 'wipe') return 'wipeleft';
  return type;
}

export const DEFAULT_CLIP_CROP: ClipCrop = { top: 0, right: 0, bottom: 0, left: 0 };

export interface KeyframePropertyMeta {
  key: KeyframeProperty;
  label: string;
  shortLabel: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  displayMultiplier: number;
  color: string;
}

export const KEYFRAME_PROPERTY_META: Record<KeyframeProperty, KeyframePropertyMeta> = {
  opacity: {
    key: 'opacity',
    label: 'Opacity',
    shortLabel: 'Opacity',
    unit: '%',
    min: 0,
    max: 1,
    step: 0.01,
    displayMultiplier: 100,
    color: '#60a5fa',
  },
  scale: {
    key: 'scale',
    label: 'Scale',
    shortLabel: 'Scale',
    unit: '%',
    min: 0.1,
    max: 3.0,
    step: 0.01,
    displayMultiplier: 100,
    color: '#34d399',
  },
  x: {
    key: 'x',
    label: 'Position X',
    shortLabel: 'Pos X',
    unit: '%',
    min: -80,
    max: 80,
    step: 0.5,
    displayMultiplier: 1,
    color: '#f59e0b',
  },
  y: {
    key: 'y',
    label: 'Position Y',
    shortLabel: 'Pos Y',
    unit: '%',
    min: -80,
    max: 80,
    step: 0.5,
    displayMultiplier: 1,
    color: '#f472b6',
  },
  rotation: {
    key: 'rotation',
    label: 'Rotation',
    shortLabel: 'Rot',
    unit: '°',
    min: -180,
    max: 180,
    step: 1,
    displayMultiplier: 1,
    color: '#a78bfa',
  },
};

export const KEYFRAME_PROPERTY_ORDER: KeyframeProperty[] = ['opacity', 'scale', 'x', 'y', 'rotation'];

export function cloneClipKeyframes(kf?: ClipKeyframesMap): ClipKeyframesMap | undefined {
  if (!kf) return undefined;
  const out: ClipKeyframesMap = {};
  let hasAny = false;
  for (const prop of KEYFRAME_PROPERTY_ORDER) {
    const pts = kf[prop];
    if (pts && pts.length > 0) {
      out[prop] = pts.map((p) => ({ ...p }));
      hasAny = true;
    }
  }
  return hasAny ? out : undefined;
}

export function hasClipKeyframes(clip: Pick<TimelineClip, 'keyframes'>): boolean {
  if (!clip.keyframes) return false;
  return KEYFRAME_PROPERTY_ORDER.some((prop) => (clip.keyframes?.[prop]?.length ?? 0) > 0);
}

export function countClipKeyframes(clip: Pick<TimelineClip, 'keyframes'> | null | undefined): number {
  if (!clip?.keyframes) return 0;
  return KEYFRAME_PROPERTY_ORDER.reduce((sum, prop) => sum + (clip.keyframes?.[prop]?.length ?? 0), 0);
}

export function applyKeyframeEasing(u: number, easing: KeyframeEasing): number {
  const t = Math.max(0, Math.min(1, u));
  if (easing === 'easeIn') return t * t;
  if (easing === 'easeOut') return 1 - (1 - t) * (1 - t);
  if (easing === 'easeInOut') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return t;
}

export function evaluateKeyframeTrack(
  points: KeyframePoint[] | undefined,
  normTime: number,
  fallbackValue: number,
): number {
  if (!points || points.length === 0) return fallbackValue;
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const t = Math.max(0, Math.min(1, normTime));
  if (sorted.length === 1 || t <= sorted[0].time) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (t >= last.time) return last.value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      if (span <= 1e-6) return b.value;
      const eased = applyKeyframeEasing((t - a.time) / span, a.easing || 'linear');
      return a.value + (b.value - a.value) * eased;
    }
  }
  return last.value;
}

export function evaluateAnimatedClipProps(
  clip: TimelineClip,
  localProgress: number,
): { opacity: number; scale: number; x: number; y: number; rotation: number } {
  const kf = clip.keyframes;
  if (!kf) {
    return {
      opacity: clip.opacity,
      scale: clip.scale,
      x: clip.x,
      y: clip.y,
      rotation: clip.rotation,
    };
  }
  const p = Math.max(0, Math.min(1, localProgress));
  return {
    opacity: evaluateKeyframeTrack(kf.opacity, p, clip.opacity),
    scale: evaluateKeyframeTrack(kf.scale, p, clip.scale),
    x: evaluateKeyframeTrack(kf.x, p, clip.x),
    y: evaluateKeyframeTrack(kf.y, p, clip.y),
    rotation: evaluateKeyframeTrack(kf.rotation, p, clip.rotation),
  };
}

export function applyAnimatedClipState(clip: TimelineClip, localProgress: number): TimelineClip {
  if (!hasClipKeyframes(clip)) return clip;
  return {
    ...clip,
    ...evaluateAnimatedClipProps(clip, localProgress),
  };
}

export function cloneVolumeEnvelope(env?: AudioVolumePoint[]): AudioVolumePoint[] | undefined {
  if (!env || env.length === 0) return undefined;
  return env.map((p) => ({ ...p }));
}

export function applyAudioFadeCurve(u: number, curve: AudioFadeCurve = 'scurve'): number {
  const t = Math.max(0, Math.min(1, u));
  if (curve === 'linear') return t;
  if (curve === 'exp') return t * t;
  if (curve === 'log') return Math.sqrt(t);
  // smooth S-curve (equal-power / quarter-sine style)
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

export function evaluateAudioEnvelopeGain(
  envelope: AudioVolumePoint[] | undefined,
  normTime: number,
  baseVolume = 1,
): number {
  if (!envelope || envelope.length === 0) return baseVolume;
  const sorted = [...envelope].sort((a, b) => a.time - b.time);
  const t = Math.max(0, Math.min(1, normTime));
  if (sorted.length === 1 || t <= sorted[0].time) return baseVolume * sorted[0].gain;
  const last = sorted[sorted.length - 1];
  if (t >= last.time) return baseVolume * last.gain;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      const u = span <= 1e-6 ? 1 : (t - a.time) / span;
      return baseVolume * (a.gain + (b.gain - a.gain) * u);
    }
  }
  return baseVolume * last.gain;
}

export function evaluateAudioClipGain(
  clip: TimelineClip,
  localTime: number,
  trackVolume = 1,
  folderVolume = 1,
  allClips?: TimelineClip[],
  tracks?: TimelineTrack[],
): number {
  const dur = Math.max(0.1, clip.duration);
  const normT = Math.max(0, Math.min(1, localTime / dur));
  let gain = evaluateAudioEnvelopeGain(clip.volumeEnvelope, normT, clip.volume) * trackVolume * folderVolume;
  const curve = clip.audioFadeCurve || 'scurve';

  if (clip.fadeIn > 0.01 && localTime < clip.fadeIn) {
    gain *= applyAudioFadeCurve(localTime / clip.fadeIn, curve);
  }
  const rem = dur - localTime;
  if (clip.fadeOut > 0.01 && rem < clip.fadeOut) {
    gain *= applyAudioFadeCurve(rem / clip.fadeOut, curve);
  }

  // Audio transition dip/swell at boundary with touching/overlapping next audio clip on same track
  if (allClips && clip.audioTransitionOut && clip.audioTransitionOut !== 'cut') {
    const tDur = Math.max(0.15, Math.min(dur * 0.45, clip.audioTransitionDuration || 0.8));
    if (rem <= tDur) {
      const p = Math.max(0, Math.min(1, (tDur - rem) / tDur));
      if (clip.audioTransitionOut === 'dip_swell') {
        gain *= 1 - 0.85 * p;
      } else if (clip.audioTransitionOut === 'crossfade_eq') {
        gain *= Math.cos(p * Math.PI * 0.5);
      } else {
        gain *= 1 - p;
      }
    }
  }

  // Incoming audio transition from previous clip on same track
  if (allClips) {
    const sameTrackClips = allClips
      .filter((c) => c.trackId === clip.trackId && c.kind === 'audio')
      .sort((a, b) => a.startTime - b.startTime);
    const idx = sameTrackClips.findIndex((c) => c.id === clip.id);
    const prev = idx > 0 ? sameTrackClips[idx - 1] : null;
    if (
      prev &&
      prev.audioTransitionOut &&
      prev.audioTransitionOut !== 'cut' &&
      prev.startTime + prev.duration - clip.startTime >= -0.15
    ) {
      const tDur = Math.max(0.15, Math.min(dur * 0.45, prev.audioTransitionDuration || 0.8));
      if (localTime <= tDur) {
        const p = Math.max(0, Math.min(1, localTime / tDur));
        if (prev.audioTransitionOut === 'crossfade_eq') {
          gain *= Math.sin(p * Math.PI * 0.5);
        } else {
          gain *= p;
        }
      }
    }
  }

  // Background Music Auto-Ducking when other audio/voiceover layers play simultaneously
  if (clip.backgroundDucking && allClips) {
    const absT = clip.startTime + localTime;
    const trackMap = tracks ? new Map(tracks.map((t) => [t.id, t])) : null;
    const foregroundActive = allClips.some((other) => {
      if (other.id === clip.id || other.muted) return false;
      if (other.kind !== 'audio' && !(other.kind === 'video' && other.hasAudio)) return false;
      if (other.backgroundDucking) return false; // don't duck against another BGM
      if (trackMap) {
        const ot = trackMap.get(other.trackId);
        if (ot?.muted || ot?.hidden) return false;
      }
      return absT >= other.startTime && absT <= other.startTime + other.duration;
    });
    if (foregroundActive) {
      gain *= Math.max(0.1, Math.min(0.9, clip.duckLevel ?? 0.28));
    }
  }

  return Math.max(0, Math.min(2.2, gain));
}

export function sanitizeClipCrop(raw?: Partial<ClipCrop> | null): ClipCrop {
  const clamp = (v: unknown) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(0.9, n));
  };
  let left = clamp(raw?.left);
  let right = clamp(raw?.right);
  let top = clamp(raw?.top);
  let bottom = clamp(raw?.bottom);

  if (left + right > 0.9) {
    const excess = left + right - 0.9;
    left = Math.max(0, left - excess / 2);
    right = Math.max(0, right - excess / 2);
  }
  if (top + bottom > 0.9) {
    const excess = top + bottom - 0.9;
    top = Math.max(0, top - excess / 2);
    bottom = Math.max(0, bottom - excess / 2);
  }
  return {
    top: Number(top.toFixed(4)),
    right: Number(right.toFixed(4)),
    bottom: Number(bottom.toFixed(4)),
    left: Number(left.toFixed(4)),
  };
}

export function isClipCropped(crop?: Partial<ClipCrop> | null): boolean {
  const c = sanitizeClipCrop(crop);
  return c.top > 0.002 || c.right > 0.002 || c.bottom > 0.002 || c.left > 0.002;
}

export interface ClipRenderBox {
  cx: number;
  cy: number;
  drawW: number;
  drawH: number;
  boxW: number;
  boxH: number;
  effScaleX: number;
  effScaleY: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  crop: ClipCrop;
}

export function computeClipRenderBox(
  clip: TimelineClip,
  srcW: number,
  srcH: number,
  cw: number,
  ch: number,
): ClipRenderBox {
  const crop = sanitizeClipCrop(clip.crop);
  const safeSrcW = Math.max(2, srcW || cw);
  const safeSrcH = Math.max(2, srcH || ch);
  const sx = safeSrcW * crop.left;
  const sy = safeSrcH * crop.top;
  const sw = Math.max(2, safeSrcW * (1 - crop.left - crop.right));
  const sh = Math.max(2, safeSrcH * (1 - crop.top - crop.bottom));

  const srcRatio = sw / sh;
  const dstRatio = cw / ch;
  let drawW = cw;
  let drawH = ch;

  if (clip.fit === 'contain') {
    if (srcRatio > dstRatio) {
      drawW = cw;
      drawH = cw / srcRatio;
    } else {
      drawH = ch;
      drawW = ch * srcRatio;
    }
  } else {
    if (srcRatio > dstRatio) {
      drawH = ch;
      drawW = ch * srcRatio;
    } else {
      drawW = cw;
      drawH = cw / srcRatio;
    }
  }

  const baseScale = Math.max(0.08, Math.min(3.5, clip.scale || 1));
  const scaleX = Math.max(0.15, Math.min(3.0, clip.scaleX ?? 1));
  const scaleY = Math.max(0.15, Math.min(3.0, clip.scaleY ?? 1));
  const effScaleX = baseScale * scaleX;
  const effScaleY = baseScale * scaleY;

  return {
    cx: cw / 2 + (clip.x / 100) * cw,
    cy: ch / 2 + (clip.y / 100) * ch,
    drawW,
    drawH,
    boxW: drawW * effScaleX,
    boxH: drawH * effScaleY,
    effScaleX,
    effScaleY,
    sx,
    sy,
    sw,
    sh,
    crop,
  };
}

export function computeAspectCropPreset(
  targetAspect: number,
  srcW: number,
  srcH: number,
): ClipCrop {
  const safeW = Math.max(2, srcW || 16);
  const safeH = Math.max(2, srcH || 9);
  const srcAspect = safeW / safeH;
  if (Math.abs(srcAspect - targetAspect) < 0.01) {
    return { ...DEFAULT_CLIP_CROP };
  }
  if (srcAspect > targetAspect) {
    // Source is wider than target -> crop left & right evenly
    const keepFrac = Math.max(0.1, targetAspect / srcAspect);
    const side = Number(((1 - keepFrac) / 2).toFixed(4));
    return sanitizeClipCrop({ top: 0, right: side, bottom: 0, left: side });
  }
  // Source is taller than target -> crop top & bottom evenly
  const keepFrac = Math.max(0.1, srcAspect / targetAspect);
  const vert = Number(((1 - keepFrac) / 2).toFixed(4));
  return sanitizeClipCrop({ top: vert, right: 0, bottom: vert, left: 0 });
}

export function buildClipTransitionMetadata(
  clip: TimelineClip,
  nextClipOnTrack: TimelineClip | null,
): ClipTransitionMetadata {
  const type = clip.transitionOut || 'cut';
  const duration =
    type === 'cut' ? 0 : Number(Math.max(0.1, Math.min(1.8, clip.transitionDuration || 0.45)).toFixed(3));
  const touchesOrOverlaps =
    Boolean(nextClipOnTrack) &&
    clip.kind !== 'audio' &&
    clip.kind !== 'title' &&
    nextClipOnTrack!.kind !== 'audio' &&
    nextClipOnTrack!.kind !== 'title' &&
    clip.startTime + clip.duration - nextClipOnTrack!.startTime >= -0.08;
  const rawOverlap =
    touchesOrOverlaps && nextClipOnTrack
      ? Math.max(0, clip.startTime + clip.duration - nextClipOnTrack.startTime)
      : 0;

  return {
    type,
    duration,
    targetClipId: touchesOrOverlaps && nextClipOnTrack ? nextClipOnTrack.id : null,
    overlapSec: Number(rawOverlap.toFixed(3)),
    ffmpegFilter: resolveFfmpegXfadeFilter(type),
  };
}

export function normalizeTimelineTransitions(clips: TimelineClip[]): TimelineClip[] {
  const byTrack = new Map<string, TimelineClip[]>();
  for (const c of clips) {
    const arr = byTrack.get(c.trackId) || [];
    arr.push(c);
    byTrack.set(c.trackId, arr);
  }
  for (const arr of byTrack.values()) {
    arr.sort((a, b) => a.startTime - b.startTime);
  }

  return clips.map((clip) => {
    if (clip.kind === 'audio' || clip.kind === 'title') {
      return {
        ...clip,
        transition: buildClipTransitionMetadata(clip, null),
      };
    }
    const trackClips = byTrack.get(clip.trackId) || [];
    const idx = trackClips.findIndex((c) => c.id === clip.id);
    const nextClip = idx >= 0 && idx + 1 < trackClips.length ? trackClips[idx + 1] : null;
    const transitionOut = clip.transitionOut || 'cut';
    const transitionDuration =
      transitionOut === 'cut' ? 0 : Number(Math.max(0.1, clip.transitionDuration || 0.45).toFixed(3));
    const updated: TimelineClip = {
      ...clip,
      transitionOut,
      transitionDuration,
    };
    updated.transition = buildClipTransitionMetadata(updated, nextClip);
    return updated;
  });
}

export function createDefaultTracks(): TimelineTrack[] {
  return [
    { id: 'trk_v2', name: 'OV1 Overlay', kind: 'video', layerRole: 'overlay', muted: false, solo: false, hidden: false, volume: 1 },
    { id: 'trk_v1', name: 'V1 Main', kind: 'video', layerRole: 'video', muted: false, solo: false, hidden: false, volume: 1 },
    { id: 'trk_a1', name: 'A1 Music', kind: 'audio', layerRole: 'audio', muted: false, solo: false, hidden: false, volume: 1 },
  ];
}

export function createClipFromAsset(
  asset: MediaAsset,
  trackId: string,
  startTime: number,
  isOverlay = false,
): TimelineClip {
  if (asset.mediaType === 'audio') {
    const dur = Math.max(1, asset.duration || 10);
    return {
      id: uid('cl'),
      trackId,
      kind: 'audio',
      mediaId: asset.id,
      name: asset.name,
      startTime: Number(Math.max(0, startTime).toFixed(3)),
      duration: Number(dur.toFixed(3)),
      trimStart: 0,
      maxSourceDuration: dur,
      hasAudio: true,
      muted: false,
      fit: 'cover',
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      motion: 'none',
      transitionOut: 'cut',
      transitionDuration: 0,
      fadeIn: 0.3,
      fadeOut: 0.8,
      speed: 1,
      reverse: false,
      volume: 1,
      pan: 0,
      bpm: asset.bpm,
      beats: asset.beats,
      waveform: asset.waveform,
      effects: { ...DEFAULT_CLIP_EFFECTS },
    };
  }

  const dur =
    asset.mediaType === 'video' && asset.duration > 0 ? Math.min(6, asset.duration) : 3.5;

  return {
    id: uid('cl'),
    trackId,
    kind: asset.mediaType === 'video' ? 'video' : 'image',
    mediaId: asset.id,
    name: asset.name,
    startTime: Number(Math.max(0, startTime).toFixed(3)),
    duration: Number(dur.toFixed(3)),
    trimStart: 0,
    maxSourceDuration: asset.mediaType === 'video' && asset.duration > 0 ? asset.duration : undefined,
    hasAudio: asset.hasAudio,
    muted: isOverlay,
    fit: isOverlay ? 'contain' : 'cover',
    scale: isOverlay ? 0.32 : 1,
    x: isOverlay ? 32 : 0,
    y: isOverlay ? -32 : 0,
    rotation: 0,
    opacity: 1,
    motion: 'none',
    transitionOut: isOverlay ? 'cut' : 'fade',
    transitionDuration: isOverlay ? 0 : 0.45,
    fadeIn: isOverlay ? 0.25 : 0,
    fadeOut: isOverlay ? 0.25 : 0,
    speed: 1,
    reverse: false,
    volume: 1,
    pan: 0,
    effects: { ...DEFAULT_CLIP_EFFECTS },
    colorGrade: asset.colorGrade ? { ...asset.colorGrade } : undefined,
  };
}

export function createTitleClip(
  spec: TitleSpec,
  trackId: string,
  startTime: number,
  duration = 4.0,
): TimelineClip {
  const labelMap: Record<TitleSpec['template'], string> = {
    main_title: 'Main Title',
    lower_third: 'Lower Third',
    subtitle: 'Subtitle',
    vector_badge: 'Vector Crest',
    scrolling_credits: 'Rolling Credits',
  };
  return {
    id: uid('tl'),
    trackId,
    kind: 'title',
    name: spec.heading ? `${labelMap[spec.template]}: ${spec.heading}` : labelMap[spec.template],
    startTime: Number(Math.max(0, startTime).toFixed(3)),
    duration: Number(Math.max(0.5, duration).toFixed(3)),
    trimStart: 0,
    muted: true,
    fit: 'contain',
    scale: 1,
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    motion: 'none',
    transitionOut: 'cut',
    transitionDuration: 0,
    fadeIn: spec.template === 'scrolling_credits' ? 0.2 : 0.3,
    fadeOut: spec.template === 'scrolling_credits' ? 0.2 : 0.3,
    speed: 1,
    reverse: false,
    volume: 1,
    pan: 0,
    effects: { ...DEFAULT_CLIP_EFFECTS },
    title: { ...spec },
  };
}

export function splitClipAtTime(clip: TimelineClip, splitTime: number): [TimelineClip, TimelineClip] | null {
  const rel = splitTime - clip.startTime;
  if (rel <= 0.15 || rel >= clip.duration - 0.15) return null;

  const isTimedMedia = clip.kind === 'video' || clip.kind === 'audio';
  const secondDur = Number((clip.duration - rel).toFixed(3));

  // When playback is reversed, the first timeline segment plays the later part of the source range
  const firstTrimStart =
    isTimedMedia && clip.reverse
      ? Number((clip.trimStart + secondDur * clip.speed).toFixed(3))
      : clip.trimStart;
  const secondTrimStart =
    isTimedMedia && !clip.reverse
      ? Number((clip.trimStart + rel * clip.speed).toFixed(3))
      : clip.trimStart;

  const splitFrac = Math.max(0.01, Math.min(0.99, rel / clip.duration));
  let firstKf: ClipKeyframesMap | undefined;
  let secondKf: ClipKeyframesMap | undefined;
  if (clip.keyframes) {
    for (const prop of KEYFRAME_PROPERTY_ORDER) {
      const pts = clip.keyframes[prop];
      if (!pts || pts.length === 0) continue;
      const sorted = [...pts].sort((a, b) => a.time - b.time);
      const boundaryVal = evaluateKeyframeTrack(sorted, splitFrac, clip[prop]);
      const leftPts: KeyframePoint[] = sorted
        .filter((p) => p.time <= splitFrac)
        .map((p) => ({ ...p, time: Number(Math.max(0, Math.min(1, p.time / splitFrac)).toFixed(4)) }));
      if (!leftPts.some((p) => p.time >= 0.999)) {
        leftPts.push({ id: uid('kf'), time: 1, value: Number(boundaryVal.toFixed(4)), easing: 'linear' });
      }
      const rightPts: KeyframePoint[] = sorted
        .filter((p) => p.time >= splitFrac)
        .map((p) => ({
          ...p,
          id: uid('kf'),
          time: Number(Math.max(0, Math.min(1, (p.time - splitFrac) / (1 - splitFrac))).toFixed(4)),
        }));
      if (!rightPts.some((p) => p.time <= 0.001)) {
        rightPts.unshift({ id: uid('kf'), time: 0, value: Number(boundaryVal.toFixed(4)), easing: 'linear' });
      }
      if (!firstKf) firstKf = {};
      if (!secondKf) secondKf = {};
      firstKf[prop] = leftPts;
      secondKf[prop] = rightPts;
    }
  }

  let firstEnv: AudioVolumePoint[] | undefined;
  let secondEnv: AudioVolumePoint[] | undefined;
  if (clip.volumeEnvelope && clip.volumeEnvelope.length > 0) {
    const sortedEnv = [...clip.volumeEnvelope].sort((a, b) => a.time - b.time);
    const boundaryGain = evaluateAudioEnvelopeGain(sortedEnv, splitFrac, 1);
    firstEnv = sortedEnv
      .filter((p) => p.time <= splitFrac)
      .map((p) => ({ ...p, time: Number(Math.max(0, Math.min(1, p.time / splitFrac)).toFixed(4)) }));
    if (!firstEnv.some((p) => p.time >= 0.999)) {
      firstEnv.push({ id: uid('av'), time: 1, gain: Number(boundaryGain.toFixed(4)) });
    }
    secondEnv = sortedEnv
      .filter((p) => p.time >= splitFrac)
      .map((p) => ({
        ...p,
        id: uid('av'),
        time: Number(Math.max(0, Math.min(1, (p.time - splitFrac) / (1 - splitFrac))).toFixed(4)),
      }));
    if (!secondEnv.some((p) => p.time <= 0.001)) {
      secondEnv.unshift({ id: uid('av'), time: 0, gain: Number(boundaryGain.toFixed(4)) });
    }
  }

  const first: TimelineClip = {
    ...clip,
    duration: Number(rel.toFixed(3)),
    trimStart: firstTrimStart,
    transitionOut: 'cut',
    transitionDuration: 0,
    fadeOut: 0,
    effects: { ...clip.effects },
    crop: clip.crop ? { ...clip.crop } : undefined,
    colorGrade: clip.colorGrade ? { ...clip.colorGrade } : undefined,
    keyframes: firstKf,
    volumeEnvelope: firstEnv,
  };

  const second: TimelineClip = {
    ...clip,
    id: uid('cl'),
    name: `${clip.name} (2)`,
    startTime: Number(splitTime.toFixed(3)),
    duration: secondDur,
    trimStart: secondTrimStart,
    fadeIn: 0,
    effects: { ...clip.effects },
    crop: clip.crop ? { ...clip.crop } : undefined,
    colorGrade: clip.colorGrade ? { ...clip.colorGrade } : undefined,
    keyframes: secondKf,
    volumeEnvelope: secondEnv,
  };

  return [first, second];
}

export function rippleDeleteClipFromList(clips: TimelineClip[], clipId: string): TimelineClip[] {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return clips;
  const shift = target.duration;
  return clips
    .filter((c) => c.id !== clipId)
    .map((c) => {
      if (c.trackId === target.trackId && c.startTime > target.startTime) {
        return {
          ...c,
          startTime: Number(Math.max(0, c.startTime - shift).toFixed(3)),
        };
      }
      return c;
    });
}

/** Roll edit: move the boundary between outgoing clipA and incoming clipB on the same track. */
export function nudgeClipRoll(
  clips: TimelineClip[],
  clipAId: string,
  clipBId: string,
  deltaSec: number,
): TimelineClip[] {
  const clipA = clips.find((c) => c.id === clipAId);
  const clipB = clips.find((c) => c.id === clipBId);
  if (!clipA || !clipB || Math.abs(deltaSec) < 0.001) return clips;

  const minDelta = -(clipA.duration - 0.25);
  let maxDelta = clipB.duration - 0.25;
  if (clipB.kind === 'video' || clipB.kind === 'audio') {
    const minTrimShift = -clipB.trimStart / Math.max(0.05, clipB.speed);
    if (deltaSec < minTrimShift) {
      deltaSec = minTrimShift;
    }
  }
  if ((clipA.kind === 'video' || clipA.kind === 'audio') && clipA.maxSourceDuration) {
    const avail = (clipA.maxSourceDuration - clipA.trimStart) / Math.max(0.05, clipA.speed) - clipA.duration;
    maxDelta = Math.min(maxDelta, Math.max(0, avail));
  }
  const d = Math.max(minDelta, Math.min(maxDelta, deltaSec));
  if (Math.abs(d) < 0.001) return clips;

  return normalizeTimelineTransitions(
    clips.map((c) => {
      if (c.id === clipAId) {
        return { ...c, duration: Number((c.duration + d).toFixed(3)) };
      }
      if (c.id === clipBId) {
        const nextTrim =
          c.kind === 'video' || c.kind === 'audio'
            ? Number(Math.max(0, c.trimStart + d * c.speed).toFixed(3))
            : c.trimStart;
        return {
          ...c,
          startTime: Number((c.startTime + d).toFixed(3)),
          duration: Number((c.duration - d).toFixed(3)),
          trimStart: nextTrim,
        };
      }
      return c;
    }),
  );
}

/** Slip edit: shift trimStart inside the clip without changing timeline startTime or duration. */
export function nudgeClipSlip(clips: TimelineClip[], clipId: string, deltaSec: number): TimelineClip[] {
  return clips.map((c) => {
    if (c.id !== clipId || (c.kind !== 'video' && c.kind !== 'audio')) return c;
    const maxStart =
      c.maxSourceDuration && c.maxSourceDuration > 0
        ? Math.max(0, c.maxSourceDuration - c.duration * c.speed)
        : Number.POSITIVE_INFINITY;
    const nextTrim = Math.max(0, Math.min(maxStart, c.trimStart + deltaSec * c.speed));
    return { ...c, trimStart: Number(nextTrim.toFixed(3)) };
  });
}

/** Extract/Ripple-remove an In..Out time range across unlocked clips. */
export function extractTimelineRange(
  clips: TimelineClip[],
  inSec: number,
  outSec: number,
  rippleClose = true,
): TimelineClip[] {
  const lo = Math.max(0, Math.min(inSec, outSec));
  const hi = Math.max(lo, Math.max(inSec, outSec));
  const span = hi - lo;
  if (span < 0.05) return clips;

  const next: TimelineClip[] = [];
  for (const c of clips) {
    const cEnd = c.startTime + c.duration;
    if (cEnd <= lo || c.startTime >= hi) {
      if (rippleClose && c.startTime >= hi) {
        next.push({ ...c, startTime: Number(Math.max(0, c.startTime - span).toFixed(3)) });
      } else {
        next.push(c);
      }
      continue;
    }
    if (c.startTime >= lo && cEnd <= hi) {
      continue; // fully inside removed range
    }
    if (c.startTime < lo && cEnd > hi) {
      const leftDur = Number((lo - c.startTime).toFixed(3));
      const rightDur = Number((cEnd - hi).toFixed(3));
      if (leftDur >= 0.2) {
        next.push({ ...c, duration: leftDur, transitionOut: 'cut', transitionDuration: 0 });
      }
      if (rightDur >= 0.2) {
        const rightStart = rippleClose ? lo : hi;
        const cutOffset = hi - c.startTime;
        next.push({
          ...c,
          id: uid('cl'),
          name: `${c.name} (2)`,
          startTime: Number(rightStart.toFixed(3)),
          duration: rightDur,
          trimStart:
            c.kind === 'video' || c.kind === 'audio'
              ? Number((c.trimStart + cutOffset * c.speed).toFixed(3))
              : c.trimStart,
        });
      }
      continue;
    }
    if (c.startTime < lo) {
      const newDur = Number((lo - c.startTime).toFixed(3));
      if (newDur >= 0.2) next.push({ ...c, duration: newDur });
      continue;
    }
    // Overlaps right edge of [lo, hi]
    const cutIn = hi - c.startTime;
    const newDur = Number((cEnd - hi).toFixed(3));
    if (newDur >= 0.2) {
      next.push({
        ...c,
        startTime: Number((rippleClose ? lo : hi).toFixed(3)),
        duration: newDur,
        trimStart:
          c.kind === 'video' || c.kind === 'audio'
            ? Number((c.trimStart + cutIn * c.speed).toFixed(3))
            : c.trimStart,
      });
    }
  }
  return normalizeTimelineTransitions(next);
}

export interface AutoAssembleOptions {
  beatStride: 1 | 2 | 4 | 'fit';
  transitionStyle: 'dynamic' | 'crossfade' | 'directional' | 'geometric' | 'cut';
  transitionDuration: number;
  enableMotion: boolean;
  maxSongDuration?: number;
}

const TRANSITION_POOLS: Record<AutoAssembleOptions['transitionStyle'], TransitionType[]> = {
  dynamic: ['fade', 'smoothleft', 'dissolve', 'circleopen', 'wipeleft', 'radial', 'smoothright'],
  crossfade: ['fade', 'dissolve', 'fadeblack'],
  directional: ['slideleft', 'slideright', 'wipeleft', 'wiperight', 'smoothleft', 'smoothright'],
  geometric: ['circleopen', 'circleclose', 'radial', 'diagtl', 'squeezeh'],
  cut: ['cut'],
};

const MOTIONS: MotionType[] = ['zoomIn', 'panRight', 'zoomOut', 'panLeft'];

export function autoAssembleTimeline(
  visualAssets: MediaAsset[],
  audioAsset: MediaAsset | null,
  options: AutoAssembleOptions,
  targetVideoTrackId = 'trk_v1',
  targetAudioTrackId = 'trk_a1',
): { clips: TimelineClip[] } {
  if (visualAssets.length === 0) {
    return { clips: [] };
  }

  const pool = TRANSITION_POOLS[options.transitionStyle];
  const baseTransDur = options.transitionStyle === 'cut' ? 0 : options.transitionDuration;
  const clips: TimelineClip[] = [];

  let cutTimes: number[] = [];
  if (audioAsset && audioAsset.beats && audioAsset.beats.length >= 2) {
    const songDur = Math.max(2.0, audioAsset.duration || 16);
    const targetLimit = options.maxSongDuration ? Math.min(songDur, options.maxSongDuration) : songDur;
    const beats = audioAsset.beats.filter((b) => b <= targetLimit);

    if (options.beatStride === 'fit') {
      const count = visualAssets.length;
      const step = targetLimit / count;
      for (let i = 0; i <= count; i++) {
        cutTimes.push(Number((i * step).toFixed(3)));
      }
    } else {
      const stride = options.beatStride;
      cutTimes.push(0);
      for (let i = stride; i < beats.length; i += stride) {
        const bt = beats[i];
        if (bt - cutTimes[cutTimes.length - 1] >= 0.55) {
          cutTimes.push(bt);
        }
      }
      if (cutTimes.length - 1 < visualAssets.length) {
        cutTimes = [0];
        const count = visualAssets.length;
        const step = Math.max(1.2, Math.min(3.5, targetLimit / count));
        for (let i = 1; i <= count; i++) {
          cutTimes.push(Number((i * step).toFixed(3)));
        }
      }
    }
  } else {
    cutTimes = [0];
    for (let i = 1; i <= visualAssets.length; i++) {
      cutTimes.push(Number((i * 2.5).toFixed(3)));
    }
  }

  const maxSlides = Math.min(48, Math.max(visualAssets.length, cutTimes.length - 1));
  let cursor = 0;
  for (let i = 0; i < maxSlides; i++) {
    const asset = visualAssets[i % visualAssets.length];
    const tStart = cutTimes[i] ?? cursor;
    const tEnd = cutTimes[i + 1] ?? tStart + 2.0;
    const interval = Math.max(0.6, tEnd - tStart);
    const trans = pool[i % pool.length];
    const effTransDur = i < maxSlides - 1 && trans !== 'cut' ? Math.min(baseTransDur, interval * 0.4) : 0;

    let dur = Number((interval + effTransDur).toFixed(3));
    if (asset.mediaType === 'video' && asset.duration > 0.5) {
      dur = Math.min(dur, asset.duration);
    }

    const base = createClipFromAsset(asset, targetVideoTrackId, cursor, false);
    base.duration = dur;
    base.muted = Boolean(audioAsset);
    base.motion = options.enableMotion && asset.mediaType === 'image' ? MOTIONS[i % MOTIONS.length] : 'none';
    base.transitionOut = i < maxSlides - 1 ? trans : 'cut';
    base.transitionDuration = Number((effTransDur || 0).toFixed(2));

    clips.push(base);
    cursor = Number((cursor + dur - effTransDur).toFixed(3));
  }

  const totalDur = computeTimelineDuration(clips);
  if (audioAsset) {
    const songDur = Math.max(1, audioAsset.duration || totalDur);
    const aClip = createClipFromAsset(audioAsset, targetAudioTrackId, 0, false);
    aClip.duration = Number(Math.min(songDur, totalDur).toFixed(3));
    aClip.fadeIn = 0.35;
    aClip.fadeOut = Number(Math.min(1.5, totalDur * 0.15).toFixed(2));
    clips.push(aClip);
  }

  return { clips: normalizeTimelineTransitions(clips) };
}

export function resolveEffectiveColorGrade(cg: ColorGradeConfig): {
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  temperature: number;
  tint: number;
  vignette: number;
} {
  let brightness = cg.exposure;
  let contrast = cg.contrast;
  let saturation = cg.saturation;
  let gamma = cg.gamma;
  let temperature = cg.temperature;
  let tint = cg.tint;
  let vignette = cg.vignette;

  switch (cg.preset) {
    case 'cinematic_teal':
      contrast *= 1.12;
      saturation *= 1.08;
      temperature -= 0.06;
      tint += 0.04;
      break;
    case 'kodak_warm':
      saturation *= 1.12;
      gamma *= 1.04;
      temperature += 0.14;
      break;
    case 'mono_noir':
      saturation = 0;
      contrast *= 1.28;
      brightness -= 0.04;
      vignette = Math.max(vignette, 0.45);
      break;
    case 'matte_fade':
      contrast *= 0.86;
      brightness += 0.06;
      saturation *= 0.85;
      break;
    case 'vivid_hdr':
      contrast *= 1.18;
      saturation *= 1.32;
      break;
    default:
      break;
  }

  return { brightness, contrast, saturation, gamma, temperature, tint, vignette };
}
