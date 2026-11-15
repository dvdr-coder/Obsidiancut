import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Crop,
  FolderPlus,
  Loader2,
  Move,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ACCEPTED_MEDIA_ACCEPT,
  ClipCrop,
  ColorGradeConfig,
  ExportConfig,
  MediaAsset,
  TimelineClip,
  TimelineTrack,
} from '../types/editor';
import {
  applyAnimatedClipState,
  computeClipRenderBox,
  computeStereoMetersAtTime,
  computeTimelineDuration,
  DEFAULT_CLIP_CROP,
  evaluateAudioClipGain,
  formatFrameTimecode,
  isClipCropped,
  resolveEffectiveColorGrade,
  sanitizeClipCrop,
} from '../utils/timelineMath';
import { AudioMeterBar } from './AudioMeterBar';
import { AudioSpectrumVisualizer } from './AudioSpectrumVisualizer';
import { drawVectorTitle } from '../utils/titleRenderer';
import { drawKrokodoveOverlay } from './FusionVfxStudio';
import { registerAudioAnalyser, unregisterAudioAnalyser } from '../utils/liveAudioSpectrum';
import {
  runSandboxedCanvasStage,
  sanitizeClipEffects,
  sanitizeColorGrade,
} from '../utils/pluginSandbox';

interface PreviewCanvasProps {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  assetsMap: Map<string, MediaAsset>;
  selectedClipId?: string | null;
  canvasTool?: 'resize' | 'crop';
  colorGrade: ColorGradeConfig;
  bypassGrade: boolean;
  resolution: ExportConfig['resolution'];
  fps: ExportConfig['fps'];
  playhead: number;
  isPlaying: boolean;
  masterMuted: boolean;
  normalizeAudio?: boolean;
  normalizeTargetLufs?: number;
  loadingSample?: boolean;
  uploading?: boolean;
  onPlayheadChange: (t: number) => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onSelectClip?: (id: string | null) => void;
  onUpdateClip?: (id: string, patch: Partial<TimelineClip>) => void;
  onCommitHistory?: () => void;
  onCanvasToolChange?: (tool: 'resize' | 'crop') => void;
  onLoadSamplePack?: () => void;
  onUploadFiles?: (files: FileList | File[]) => void;
  onOpenTutorial?: () => void;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [0, 255, 0];
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 255,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

function drawTransformedMedia(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  cw: number,
  ch: number,
  clip: TimelineClip,
  localProgress: number,
  chromaCanvas: HTMLCanvasElement,
  extraOffsetX = 0,
  extraOffsetY = 0,
  extraScaleX = 1,
  extraScaleY = 1,
  extraAlpha = 1,
  bypassGrade = false,
  gradeCanvas?: HTMLCanvasElement | null,
) {
  if (!srcW || !srcH) return;

  const box = computeClipRenderBox(clip, srcW, srcH, cw, ch);

  // Determine source to draw (apply crop + fast chroma key offscreen pass if enabled)
  let drawSource: CanvasImageSource = source;
  let srcCropX = box.sx;
  let srcCropY = box.sy;
  let srcCropW = box.sw;
  let srcCropH = box.sh;

  if (clip.effects.chromaKeyEnabled) {
    const ckW = Math.min(480, Math.max(120, Math.round(cw * 0.55)));
    const ckH = Math.max(60, Math.round(ckW * (box.sh / box.sw)));
    if (chromaCanvas.width !== ckW || chromaCanvas.height !== ckH) {
      chromaCanvas.width = ckW;
      chromaCanvas.height = ckH;
    }
    const ckCtx = chromaCanvas.getContext('2d', { willReadFrequently: true });
    if (ckCtx) {
      ckCtx.clearRect(0, 0, ckW, ckH);
      ckCtx.drawImage(source, box.sx, box.sy, box.sw, box.sh, 0, 0, ckW, ckH);
      const imgData = ckCtx.getImageData(0, 0, ckW, ckH);
      const data = imgData.data;
      const [kr, kg, kb] = hexToRgb(clip.effects.chromaKeyColor);
      const sim = clip.effects.chromaKeySimilarity * 442; // Euclidean RGB max ~441.6
      const blend = Math.max(8, clip.effects.chromaKeyBlend * 442);

      for (let i = 0; i < data.length; i += 4) {
        const dr = data[i] - kr;
        const dg = data[i + 1] - kg;
        const db = data[i + 2] - kb;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist < sim) {
          data[i + 3] = 0;
        } else if (dist < sim + blend) {
          const alphaFactor = (dist - sim) / blend;
          data[i + 3] = Math.round(data[i + 3] * alphaFactor);
        }
      }
      ckCtx.putImageData(imgData, 0, 0);
      drawSource = chromaCanvas;
      srcCropX = 0;
      srcCropY = 0;
      srcCropW = ckW;
      srcCropH = ckH;
    }
  }

  ctx.save();

  // Compute fadeIn / fadeOut envelope
  const elapsed = localProgress * clip.duration;
  const remaining = clip.duration - elapsed;
  let fadeAlpha = 1;
  if (clip.fadeIn > 0.02 && elapsed < clip.fadeIn) {
    fadeAlpha *= Math.max(0, elapsed / clip.fadeIn);
  }
  if (clip.fadeOut > 0.02 && remaining < clip.fadeOut) {
    fadeAlpha *= Math.max(0, remaining / clip.fadeOut);
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, clip.opacity * extraAlpha * fadeAlpha));

  // Per-clip digital video effects + individual picture color grading via Canvas filter
  const fx = sanitizeClipEffects(clip.effects);
  const clipGradeActive = Boolean(clip.colorGrade?.enabled && !bypassGrade);
  const clipEff = clipGradeActive ? resolveEffectiveColorGrade(sanitizeColorGrade(clip.colorGrade)) : null;

  const filterTokens: string[] = [];
  const totalBrightMul =
    (1 + fx.brightness) *
    (clipEff ? 1 + clipEff.brightness : 1) *
    (1 + (fx.gamma - 1) * 0.25) *
    (clipEff ? 1 + (clipEff.gamma - 1) * 0.25 : 1);
  if (Math.abs(totalBrightMul - 1) > 0.01) {
    filterTokens.push(`brightness(${Math.max(10, Math.round(totalBrightMul * 100))}%)`);
  }

  const totalContrast = fx.contrast * (clipEff ? clipEff.contrast : 1);
  if (Math.abs(totalContrast - 1) > 0.01) {
    filterTokens.push(`contrast(${Math.max(10, Math.round(totalContrast * 100))}%)`);
  }

  const baseSat = fx.greyscale ? 0 : fx.saturation;
  const totalSat = baseSat * (clipEff ? clipEff.saturation : 1);
  if (Math.abs(totalSat - 1) > 0.01) {
    filterTokens.push(`saturate(${Math.max(0, Math.round(totalSat * 100))}%)`);
  }

  if (Math.abs(fx.hue) > 0.5) {
    filterTokens.push(`hue-rotate(${Math.round(fx.hue)}deg)`);
  }
  const combinedFilter = filterTokens.length > 0 ? filterTokens.join(' ') : 'none';

  const posX = box.cx + extraOffsetX;
  const posY = box.cy + extraOffsetY;

  ctx.translate(posX, posY);
  if (Math.abs(clip.rotation) > 0.1) {
    ctx.rotate((clip.rotation * Math.PI) / 180);
  }
  ctx.scale(extraScaleX * box.effScaleX, extraScaleY * box.effScaleY);

  // Ken Burns motion
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  const p = Math.max(0, Math.min(1, localProgress));
  if (clip.motion === 'zoomIn') zoom = 1 + 0.12 * p;
  else if (clip.motion === 'zoomOut') zoom = 1.12 - 0.12 * p;
  else if (clip.motion === 'panLeft') {
    zoom = 1.1;
    panX = (0.5 - p) * cw * 0.08;
  } else if (clip.motion === 'panRight') {
    zoom = 1.1;
    panX = (p - 0.5) * cw * 0.08;
  }

  const { drawW, drawH } = box;
  ctx.scale(zoom, zoom);

  const needsColorPasses =
    Boolean(clipEff) &&
    (Math.abs(clipEff!.temperature) > 0.01 || Math.abs(clipEff!.tint) > 0.01 || clipEff!.vignette > 0.02);

  if (needsColorPasses && clipEff && gradeCanvas) {
    const gw = Math.max(4, Math.min(cw, Math.round(drawW)));
    const gh = Math.max(4, Math.min(ch, Math.round(drawH)));
    if (gradeCanvas.width !== gw || gradeCanvas.height !== gh) {
      gradeCanvas.width = gw;
      gradeCanvas.height = gh;
    }
    const gCtx = gradeCanvas.getContext('2d');
    if (gCtx) {
      gCtx.save();
      gCtx.clearRect(0, 0, gw, gh);
      gCtx.filter = combinedFilter;
      gCtx.drawImage(drawSource, srcCropX, srcCropY, srcCropW, srcCropH, 0, 0, gw, gh);
      gCtx.filter = 'none';

      if (Math.abs(clipEff.temperature) > 0.01) {
        gCtx.globalCompositeOperation = 'soft-light';
        gCtx.fillStyle =
          clipEff.temperature > 0
            ? `rgba(255, 165, 65, ${Math.min(0.45, clipEff.temperature * 0.7)})`
            : `rgba(60, 145, 255, ${Math.min(0.45, Math.abs(clipEff.temperature) * 0.7)})`;
        gCtx.fillRect(0, 0, gw, gh);
      }
      if (Math.abs(clipEff.tint) > 0.01) {
        gCtx.globalCompositeOperation = 'soft-light';
        gCtx.fillStyle =
          clipEff.tint > 0
            ? `rgba(70, 210, 110, ${Math.min(0.35, clipEff.tint * 0.6)})`
            : `rgba(215, 70, 190, ${Math.min(0.35, Math.abs(clipEff.tint) * 0.6)})`;
        gCtx.fillRect(0, 0, gw, gh);
      }
      if (clipEff.vignette > 0.02) {
        gCtx.globalCompositeOperation = 'source-over';
        const grad = gCtx.createRadialGradient(
          gw / 2,
          gh / 2,
          Math.min(gw, gh) * 0.28,
          gw / 2,
          gh / 2,
          Math.hypot(gw / 2, gh / 2),
        );
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, `rgba(0,0,0,${Math.min(0.88, clipEff.vignette * 0.9)})`);
        gCtx.fillStyle = grad;
        gCtx.fillRect(0, 0, gw, gh);
      }
      // Preserve source transparency (e.g. PNG watermarks / chroma key)
      gCtx.globalCompositeOperation = 'destination-in';
      gCtx.drawImage(drawSource, srcCropX, srcCropY, srcCropW, srcCropH, 0, 0, gw, gh);
      gCtx.restore();

      ctx.drawImage(gradeCanvas, -drawW / 2 + panX, -drawH / 2 + panY, drawW, drawH);
    } else {
      if (combinedFilter !== 'none') ctx.filter = combinedFilter;
      ctx.drawImage(drawSource, srcCropX, srcCropY, srcCropW, srcCropH, -drawW / 2 + panX, -drawH / 2 + panY, drawW, drawH);
    }
  } else {
    if (combinedFilter !== 'none') ctx.filter = combinedFilter;
    ctx.drawImage(drawSource, srcCropX, srcCropY, srcCropW, srcCropH, -drawW / 2 + panX, -drawH / 2 + panY, drawW, drawH);
  }
  ctx.restore();
}

export const PreviewCanvas: React.FC<PreviewCanvasProps> = ({
  tracks,
  clips,
  assetsMap,
  selectedClipId = null,
  canvasTool: controlledTool,
  colorGrade,
  bypassGrade,
  resolution,
  fps,
  playhead,
  isPlaying,
  masterMuted,
  normalizeAudio = false,
  normalizeTargetLufs = -14,
  loadingSample = false,
  uploading = false,
  onPlayheadChange,
  onTogglePlay,
  onToggleMute,
  onSelectClip,
  onUpdateClip,
  onCommitHistory,
  onCanvasToolChange,
  onLoadSamplePack,
  onUploadFiles,
  onOpenTutorial,
}) => {
  const emptyUploadRef = useRef<HTMLInputElement | null>(null);
  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [internalTool, setInternalTool] = useState<'resize' | 'crop'>('resize');
  const activeTool = controlledTool ?? internalTool;
  const setActiveTool = (next: 'resize' | 'crop') => {
    setInternalTool(next);
    onCanvasToolChange?.(next);
  };
  const [emptyDropActive, setEmptyDropActive] = useState(false);
  const [showSpectrum, setShowSpectrum] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chromaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackBufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const clipGradeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const videoCacheRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Audio playback pool with Web Audio StereoPannerNode + shared AnalyserNode for live spectrum
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const audioPoolRef = useRef<
    Map<
      string,
      {
        el: HTMLAudioElement;
        url: string;
        sourceNode?: MediaElementAudioSourceNode;
        gainNode?: GainNode;
        pannerNode?: StereoPannerNode;
      }
    >
  >(new Map());

  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const renderFrameRef = useRef<(t: number) => void>(() => {});
  const syncAudioRef = useRef<(t: number, playing: boolean) => void>(() => {});

  const totalDuration = useMemo(() => computeTimelineDuration(clips), [clips]);

  const { canvasW, canvasH } = useMemo(() => {
    if (resolution === '1080x1920') return { canvasW: 360, canvasH: 640 };
    if (resolution === '1080x1080') return { canvasW: 512, canvasH: 512 };
    return { canvasW: 854, canvasH: 480 };
  }, [resolution]);

  // Preload media elements using lightweight proxies when available, keyed per clip for videos, and evict deleted items
  useEffect(() => {
    const activeImageIds = new Set<string>();
    const activeVideoClipIds = new Set<string>();

    for (const c of clips) {
      if (!c.mediaId) continue;
      const asset = assetsMap.get(c.mediaId);
      if (!asset) continue;
      if (asset.mediaType !== 'image' && asset.mediaType !== 'video') continue;
      const targetUrl = asset.proxyUrl || asset.fileUrl;

      if (asset.mediaType === 'image') {
        activeImageIds.add(c.mediaId);
        const existing = imageCacheRef.current.get(c.mediaId);
        if (!existing || existing.dataset.srcUrl !== targetUrl) {
          const img = new Image();
          img.decoding = 'async';
          img.dataset.srcUrl = targetUrl;
          img.onload = () => {
            if (!isPlayingRef.current) {
              renderFrameRef.current(playheadRef.current);
            }
          };
          img.src = targetUrl;
          imageCacheRef.current.set(c.mediaId, img);
        }
      } else if (asset.mediaType === 'video' && c.kind === 'video') {
        activeVideoClipIds.add(c.id);
        const existing = videoCacheRef.current.get(c.id);
        if (!existing || existing.dataset.srcUrl !== targetUrl) {
          if (existing) {
            existing.pause();
            existing.removeAttribute('src');
            existing.load();
          }
          const vid = document.createElement('video');
          vid.dataset.srcUrl = targetUrl;
          vid.onloadeddata = () => {
            if (!isPlayingRef.current) {
              renderFrameRef.current(playheadRef.current);
            }
          };
          vid.src = targetUrl;
          vid.preload = 'auto';
          vid.muted = true;
          vid.playsInline = true;
          videoCacheRef.current.set(c.id, vid);
        }
      }
    }

    for (const [id, img] of imageCacheRef.current.entries()) {
      if (!activeImageIds.has(id)) {
        img.onload = null;
        img.src = '';
        imageCacheRef.current.delete(id);
      }
    }
    for (const [clipId, vid] of videoCacheRef.current.entries()) {
      if (!activeVideoClipIds.has(clipId)) {
        vid.onloadeddata = null;
        vid.pause();
        vid.removeAttribute('src');
        vid.load();
        videoCacheRef.current.delete(clipId);
      }
    }
  }, [clips, assetsMap]);

  // Manage audio elements
  useEffect(() => {
    const pool = audioPoolRef.current;
    const audioClips = clips.filter((c) => c.kind === 'audio' && c.mediaId);
    const activeIds = new Set(audioClips.map((c) => c.id));

    const disposeNode = (node: {
      el: HTMLAudioElement;
      sourceNode?: MediaElementAudioSourceNode;
      gainNode?: GainNode;
      pannerNode?: StereoPannerNode;
    }) => {
      node.el.pause();
      node.el.removeAttribute('src');
      node.el.load();
      try {
        node.sourceNode?.disconnect();
        node.gainNode?.disconnect();
        node.pannerNode?.disconnect();
      } catch {
        // ignore disconnect errors
      }
    };

    for (const [clipId, node] of pool.entries()) {
      if (!activeIds.has(clipId)) {
        disposeNode(node);
        pool.delete(clipId);
      }
    }

    for (const clip of audioClips) {
      if (!clip.mediaId) continue;
      const asset = assetsMap.get(clip.mediaId);
      if (!asset) continue;
      const targetUrl = asset.proxyUrl || asset.fileUrl;
      const existing = pool.get(clip.id);
      if (existing) {
        if (existing.url !== targetUrl) {
          disposeNode(existing);
          const el = new Audio(targetUrl);
          el.preload = 'auto';
          pool.set(clip.id, { el, url: targetUrl });
        }
        continue;
      }
      const el = new Audio(targetUrl);
      el.preload = 'auto';
      pool.set(clip.id, { el, url: targetUrl });
    }
  }, [clips, assetsMap]);

  const syncAudioAtTime = (t: number, playing: boolean) => {
    const pool = audioPoolRef.current;
    const audioTracks = tracks.filter((tr) => tr.kind === 'audio');
    const anySolo = audioTracks.some((tr) => tr.solo);
    const trackMap = new Map(audioTracks.map((tr) => [tr.id, tr]));

    for (const clip of clips) {
      if (clip.kind !== 'audio') continue;
      const entry = pool.get(clip.id);
      if (!entry) continue;

      const trk = trackMap.get(clip.trackId);
      const parentFolder = trk?.parentFolderId ? trackMap.get(trk.parentFolderId) : undefined;
      const trackMuted =
        !trk ||
        trk.muted ||
        Boolean(parentFolder?.muted) ||
        (anySolo && !trk.solo && !parentFolder?.solo);
      const inWindow = t >= clip.startTime && t <= clip.startTime + clip.duration;

      if (!playing || !inWindow || masterMuted || clip.muted || trackMuted) {
        if (!entry.el.paused) entry.el.pause();
        continue;
      }

      // Lazy-attach Web Audio panner & shared FFT AnalyserNode on first play gesture
      if (!entry.pannerNode && typeof AudioContext !== 'undefined') {
        try {
          if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
          const ctx = audioCtxRef.current;
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          if (!masterGainNodeRef.current || !analyserNodeRef.current) {
            const mGain = ctx.createGain();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.78;
            analyser.minDecibels = -74;
            analyser.maxDecibels = -4;
            mGain.connect(analyser);
            analyser.connect(ctx.destination);
            masterGainNodeRef.current = mGain;
            analyserNodeRef.current = analyser;
            registerAudioAnalyser(ctx, analyser);
          }
          const src = ctx.createMediaElementSource(entry.el);
          const gainNode = ctx.createGain();
          const pannerNode = ctx.createStereoPanner();
          src.connect(gainNode);
          gainNode.connect(pannerNode);
          pannerNode.connect(masterGainNodeRef.current);
          entry.sourceNode = src;
          entry.gainNode = gainNode;
          entry.pannerNode = pannerNode;
        } catch {
          // Fallback to direct HTMLAudioElement volume
        }
      }

      const localT = t - clip.startTime;
      const mappedOffset = clip.reverse
        ? Math.max(0, (clip.duration - localT) * clip.speed)
        : localT * clip.speed;
      const targetSrcT = clip.trimStart + mappedOffset;

      const audioDriftThresh = playing ? 0.28 : 0.08;
      if (Math.abs(entry.el.currentTime - targetSrcT) > audioDriftThresh) {
        try {
          entry.el.currentTime = Math.max(0, targetSrcT);
        } catch {
          // ignore
        }
      }

      try {
        entry.el.playbackRate = Math.max(0.25, Math.min(4.0, clip.speed));
      } catch {
        // ignore unsupported rate
      }

      const folderGain = parentFolder ? parentFolder.volume : 1;
      const gain = evaluateAudioClipGain(clip, localT, trk?.volume ?? 1, folderGain, clips, tracks);
      const clampedGain = Math.max(0, Math.min(2, gain));

      if (entry.gainNode && entry.pannerNode) {
        entry.gainNode.gain.value = clampedGain;
        entry.pannerNode.pan.value = Math.max(-1, Math.min(1, clip.pan || 0));
        entry.el.volume = 1;
      } else {
        entry.el.volume = Math.min(1, clampedGain);
      }

      if (entry.el.paused) {
        entry.el.play().catch(() => {});
      }
    }

    // Sync active <video> elements (smooth forward decode + embedded video audio when unmuted)
    const videoTrackMap = new Map(tracks.filter((tr) => tr.kind === 'video').map((tr) => [tr.id, tr]));
    const activeVideoClipIds = new Set<string>();
    for (const clip of clips) {
      if (clip.kind !== 'video' || !clip.mediaId) continue;
      const vid = videoCacheRef.current.get(clip.id);
      if (!vid) continue;
      const inWindow = t >= clip.startTime && t <= clip.startTime + clip.duration;
      if (!playing || !inWindow || clip.reverse) continue;
      activeVideoClipIds.add(clip.id);

      const trk = videoTrackMap.get(clip.trackId);
      const canHear = !masterMuted && !clip.muted && clip.hasAudio && Boolean(trk) && !trk?.hidden && !trk?.muted;
      vid.muted = !canHear;
      if (canHear) {
        const localVidT = Math.max(0, t - clip.startTime);
        vid.volume = Math.max(
          0,
          Math.min(1, evaluateAudioClipGain(clip, localVidT, trk?.volume ?? 1, 1, clips, tracks)),
        );
      }
      try {
        vid.playbackRate = Math.max(0.25, Math.min(4.0, clip.speed));
      } catch {
        // ignore
      }
      if (vid.paused && vid.readyState >= 2) {
        vid.play().catch(() => {});
      }
    }

    for (const [clipId, vid] of videoCacheRef.current.entries()) {
      if (!activeVideoClipIds.has(clipId)) {
        if (!vid.paused) vid.pause();
        vid.muted = true;
      }
    }
  };

  useEffect(() => {
    syncAudioAtTime(playhead, isPlaying);
  }, [isPlaying, masterMuted, clips, tracks]);

  useEffect(() => {
    return () => {
      for (const entry of audioPoolRef.current.values()) {
        entry.el.pause();
        entry.el.removeAttribute('src');
        entry.el.load();
        try {
          entry.sourceNode?.disconnect();
          entry.gainNode?.disconnect();
          entry.pannerNode?.disconnect();
        } catch {
          // ignore
        }
      }
      for (const vid of videoCacheRef.current.values()) {
        vid.onloadeddata = null;
        vid.pause();
        vid.removeAttribute('src');
        vid.load();
      }
      unregisterAudioAnalyser(analyserNodeRef.current);
      try {
        masterGainNodeRef.current?.disconnect();
        analyserNodeRef.current?.disconnect();
      } catch {
        // ignore
      }
      masterGainNodeRef.current = null;
      analyserNodeRef.current = null;
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const renderFrame = (t: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    if (!chromaCanvasRef.current) {
      chromaCanvasRef.current = document.createElement('canvas');
    }
    if (!trackBufferCanvasRef.current) {
      trackBufferCanvasRef.current = document.createElement('canvas');
    }
    if (!clipGradeCanvasRef.current) {
      clipGradeCanvasRef.current = document.createElement('canvas');
    }
    const chromaCanvas = chromaCanvasRef.current;
    const bufCanvas = trackBufferCanvasRef.current;
    const gradeCanvas = clipGradeCanvasRef.current;
    if (bufCanvas.width !== canvasW || bufCanvas.height !== canvasH) {
      bufCanvas.width = canvasW;
      bufCanvas.height = canvasH;
    }

    ctx.fillStyle = '#090b0e';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Composite visible video tracks bottom-to-top
    const visibleTracks = [...tracks]
      .filter((tr) => tr.kind === 'video' && !tr.hidden)
      .reverse();

    const getVisualSource = (clip: TimelineClip): { el: CanvasImageSource; w: number; h: number } | null => {
      if (clip.kind === 'title' && clip.title) {
        const bufCtx = bufCanvas.getContext('2d');
        if (!bufCtx) return null;
        bufCtx.clearRect(0, 0, canvasW, canvasH);
        const prog = (t - clip.startTime) / Math.max(0.1, clip.duration);
        drawVectorTitle(bufCtx, clip.title, canvasW, canvasH, Math.max(0, Math.min(1, prog)));
        return { el: bufCanvas, w: canvasW, h: canvasH };
      }
      if (!clip.mediaId) return null;
      if (clip.kind === 'image') {
        const img = imageCacheRef.current.get(clip.mediaId);
        if (img && img.complete && img.naturalWidth > 0) {
          return { el: img, w: img.naturalWidth, h: img.naturalHeight };
        }
        return null;
      }
      if (clip.kind === 'video') {
        const vid = videoCacheRef.current.get(clip.id);
        if (vid && vid.readyState >= 2) {
          const elapsed = Math.max(0, t - clip.startTime);
          const mapped = clip.reverse
            ? Math.max(0, (clip.duration - elapsed) * clip.speed)
            : elapsed * clip.speed;
          const desiredT = clip.trimStart + mapped;
          const driftThresh = isPlayingRef.current ? 0.35 : 0.06;
          if (Math.abs(vid.currentTime - desiredT) > driftThresh) {
            try {
              vid.currentTime = Math.min(vid.duration || desiredT, Math.max(0, desiredT));
            } catch {
              // ignore seek error
            }
          }
          return { el: vid, w: vid.videoWidth, h: vid.videoHeight };
        }
        return null;
      }
      return null;
    };

    // Look-ahead pre-warm upcoming video clips within 2.0s ahead of playhead
    for (const c of clips) {
      if (c.kind !== 'video' || !c.mediaId) continue;
      if (c.startTime > t && c.startTime - t <= 2.0) {
        const vid = videoCacheRef.current.get(c.id);
        if (vid && vid.readyState >= 1 && vid.paused) {
          const preT = c.reverse
            ? Math.max(0, c.trimStart + c.duration * c.speed)
            : Math.max(0, c.trimStart);
          if (Math.abs(vid.currentTime - preT) > 0.25) {
            try {
              vid.currentTime = Math.min(vid.duration || preT, preT);
            } catch {
              // ignore seek error
            }
          }
        }
      }
    }

    for (const trk of visibleTracks) {
      const trkClips = clips
        .filter((c) => c.trackId === trk.id && c.kind !== 'audio')
        .sort((a, b) => a.startTime - b.startTime);

      // Find active clip(s) at time t on this track (including overlapping transition pair)
      const activeAtT = trkClips.filter(
        (c) => t >= c.startTime && t <= c.startTime + c.duration,
      );
      if (activeAtT.length === 0) continue;

      const drawStageResult = runSandboxedCanvasStage('clip-fx', ctx, () => {
        let transPair: { clipA: TimelineClip; clipB: TimelineClip; p: number } | null = null;
        let usedOverlapPair = false;

        if (activeAtT.length >= 2) {
          const clipA = activeAtT[0];
          const clipB = activeAtT[1];
          const overlapStart = clipB.startTime;
          const overlapEnd = Math.min(clipA.startTime + clipA.duration, clipB.startTime + clipB.duration);
          const overlapSec = overlapEnd - overlapStart;
          if (overlapSec > 0.04) {
            usedOverlapPair = true;
            transPair = {
              clipA,
              clipB,
              p: Math.max(0, Math.min(1, (t - overlapStart) / overlapSec)),
            };
          }
        }
        if (!usedOverlapPair) {
          const cur = activeAtT[activeAtT.length - 1];
          const curIdx = trkClips.findIndex((c) => c.id === cur.id);
          const prev = curIdx > 0 ? trkClips[curIdx - 1] : null;
          const next = curIdx >= 0 && curIdx + 1 < trkClips.length ? trkClips[curIdx + 1] : null;

          if (
            prev &&
            prev.transitionOut !== 'cut' &&
            prev.transitionDuration > 0.04 &&
            Math.abs(prev.startTime + prev.duration - cur.startTime) <= 0.08
          ) {
            const td = Math.min(prev.transitionDuration, prev.duration * 0.45, cur.duration * 0.45);
            const seam = cur.startTime;
            if (td > 0.05 && t >= seam && t <= seam + td * 0.5) {
              transPair = {
                clipA: prev,
                clipB: cur,
                p: Math.max(0, Math.min(1, (t - (seam - td * 0.5)) / td)),
              };
            }
          }
          if (
            !transPair &&
            next &&
            cur.transitionOut !== 'cut' &&
            cur.transitionDuration > 0.04 &&
            Math.abs(cur.startTime + cur.duration - next.startTime) <= 0.08
          ) {
            const td = Math.min(cur.transitionDuration, cur.duration * 0.45, next.duration * 0.45);
            const seam = next.startTime;
            if (td > 0.05 && t >= seam - td * 0.5 && t <= seam) {
              transPair = {
                clipA: cur,
                clipB: next,
                p: Math.max(0, Math.min(1, (t - (seam - td * 0.5)) / td)),
              };
            }
          }
        }

        const drawClip = (
          c: TimelineClip,
          src: { el: CanvasImageSource; w: number; h: number } | null,
          prog: number,
          ox = 0,
          oy = 0,
          sx = 1,
          sy = 1,
          alpha = 1,
        ) => {
          if (!src) return;
          const animClip = applyAnimatedClipState(c, prog);
          drawTransformedMedia(
            ctx,
            src.el,
            src.w,
            src.h,
            canvasW,
            canvasH,
            animClip,
            prog,
            chromaCanvas,
            ox,
            oy,
            sx,
            sy,
            alpha,
            bypassGrade,
            gradeCanvas,
          );
        };

        if (transPair) {
          const { clipA, clipB, p } = transPair;
          const tr = clipA.transitionOut;

          const srcA = getVisualSource(clipA);
          const srcB = getVisualSource(clipB);
          const progA = Math.max(0, Math.min(1, (t - clipA.startTime) / Math.max(0.1, clipA.duration)));
          const progB = Math.max(0, Math.min(1, (t - clipB.startTime) / Math.max(0.1, clipB.duration)));

          if (tr === 'cut') {
            drawClip(clipB, srcB, progB);
          } else if (tr === 'fade' || tr === 'dissolve' || tr === 'hblur') {
            const easeP = tr === 'dissolve' ? p * p * (3 - 2 * p) : p;
            drawClip(clipA, srcA, progA, 0, 0, 1, 1, tr === 'dissolve' ? 1 - easeP * 0.35 : 1);
            drawClip(clipB, srcB, progB, 0, 0, 1, 1, easeP);
          } else if (tr === 'fadeblack' || tr === 'fadewhite' || tr === 'fadegrays') {
            if (p < 0.5) {
              drawClip(clipA, srcA, progA);
              ctx.fillStyle =
                tr === 'fadewhite'
                  ? `rgba(255,255,255,${p * 2})`
                  : tr === 'fadegrays'
                    ? `rgba(100,116,139,${p * 2})`
                    : `rgba(0,0,0,${p * 2})`;
              ctx.fillRect(0, 0, canvasW, canvasH);
            } else {
              drawClip(clipB, srcB, progB);
              ctx.fillStyle =
                tr === 'fadewhite'
                  ? `rgba(255,255,255,${(1 - p) * 2})`
                  : tr === 'fadegrays'
                    ? `rgba(100,116,139,${(1 - p) * 2})`
                    : `rgba(0,0,0,${(1 - p) * 2})`;
              ctx.fillRect(0, 0, canvasW, canvasH);
            }
          } else if (tr === 'slideleft' || tr === 'smoothleft') {
            const ease = tr === 'smoothleft' ? p * p * (3 - 2 * p) : p;
            drawClip(clipA, srcA, progA, -ease * canvasW, 0);
            drawClip(clipB, srcB, progB, (1 - ease) * canvasW, 0);
          } else if (tr === 'slideright' || tr === 'smoothright') {
            const ease = tr === 'smoothright' ? p * p * (3 - 2 * p) : p;
            drawClip(clipA, srcA, progA, ease * canvasW, 0);
            drawClip(clipB, srcB, progB, -(1 - ease) * canvasW, 0);
          } else if (tr === 'slideup' || tr === 'smoothup') {
            const ease = tr === 'smoothup' ? p * p * (3 - 2 * p) : p;
            drawClip(clipA, srcA, progA, 0, -ease * canvasH);
            drawClip(clipB, srcB, progB, 0, (1 - ease) * canvasH);
          } else if (tr === 'slidedown' || tr === 'smoothdown') {
            const ease = tr === 'smoothdown' ? p * p * (3 - 2 * p) : p;
            drawClip(clipA, srcA, progA, 0, ease * canvasH);
            drawClip(clipB, srcB, progB, 0, -(1 - ease) * canvasH);
          } else if (tr === 'squeezeh') {
            drawClip(clipA, srcA, progA, 0, 0, Math.max(0.05, 1 - p), 1, 1 - p * 0.35);
            drawClip(clipB, srcB, progB, 0, 0, Math.max(0.05, p), 1, p);
          } else if (tr === 'squeezev') {
            drawClip(clipA, srcA, progA, 0, 0, 1, Math.max(0.05, 1 - p), 1 - p * 0.35);
            drawClip(clipB, srcB, progB, 0, 0, 1, Math.max(0.05, p), p);
          } else if (
            tr === 'wipe' ||
            tr === 'wipeleft' ||
            tr === 'wiperight' ||
            tr === 'wipeup' ||
            tr === 'wipedown' ||
            tr === 'diagtl' ||
            tr === 'diagtr' ||
            tr === 'vertopen' ||
            tr === 'horzopen'
          ) {
            drawClip(clipA, srcA, progA);
            if (srcB) {
              ctx.save();
              ctx.beginPath();
              if (tr === 'wipe' || tr === 'wipeleft') ctx.rect(canvasW * (1 - p), 0, canvasW * p, canvasH);
              else if (tr === 'wiperight') ctx.rect(0, 0, canvasW * p, canvasH);
              else if (tr === 'wipeup') ctx.rect(0, canvasH * (1 - p), canvasW, canvasH * p);
              else if (tr === 'wipedown') ctx.rect(0, 0, canvasW, canvasH * p);
              else if (tr === 'vertopen') {
                const half = (canvasW * p) / 2;
                ctx.rect(canvasW / 2 - half, 0, half * 2, canvasH);
              } else if (tr === 'horzopen') {
                const half = (canvasH * p) / 2;
                ctx.rect(0, canvasH / 2 - half, canvasW, half * 2);
              } else if (tr === 'diagtr') {
                ctx.moveTo(canvasW, 0);
                ctx.lineTo(canvasW - canvasW * p * 2, 0);
                ctx.lineTo(canvasW, canvasH * p * 2);
                ctx.closePath();
              } else {
                ctx.moveTo(0, 0);
                ctx.lineTo(canvasW * p * 2, 0);
                ctx.lineTo(0, canvasH * p * 2);
                ctx.closePath();
              }
              ctx.clip();
              drawClip(clipB, srcB, progB);
              ctx.restore();
            }
          } else if (tr === 'circleopen' || tr === 'circleclose' || tr === 'radial') {
            drawClip(clipA, srcA, progA);
            if (srcB) {
              const maxR = Math.hypot(canvasW / 2, canvasH / 2);
              ctx.save();
              ctx.beginPath();
              if (tr === 'radial') {
                ctx.moveTo(canvasW / 2, canvasH / 2);
                ctx.arc(canvasW / 2, canvasH / 2, maxR * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
                ctx.closePath();
              } else {
                ctx.arc(canvasW / 2, canvasH / 2, maxR * (tr === 'circleclose' ? 1 - p : p), 0, Math.PI * 2);
              }
              ctx.clip();
              drawClip(clipB, srcB, progB);
              ctx.restore();
            }
          } else {
            drawClip(clipA, srcA, progA);
            drawClip(clipB, srcB, progB, 0, 0, 1, 1, p);
          }
        } else {
          const clip = activeAtT[activeAtT.length - 1];
          const src = getVisualSource(clip);
          if (src) {
            const prog = (t - clip.startTime) / Math.max(0.1, clip.duration);
            if (clip.fusion?.enabled && clip.fusion.rotoscopeEnabled && clip.fusion.rotoscopePoints.length >= 3) {
              ctx.save();
              ctx.beginPath();
              clip.fusion.rotoscopePoints.forEach((pt, idx) => {
                if (idx === 0) ctx.moveTo(pt.x * canvasW, pt.y * canvasH);
                else ctx.lineTo(pt.x * canvasW, pt.y * canvasH);
              });
              ctx.closePath();
              if (clip.fusion.rotoscopeInvert) {
                ctx.rect(canvasW, 0, -canvasW, canvasH);
                ctx.clip('evenodd');
              } else {
                ctx.clip();
              }
              drawClip(clip, src, prog);
              ctx.restore();
            } else {
              drawClip(clip, src, prog);
            }

            if (clip.fusion?.enabled && clip.fusion.krokodoveEffect !== 'none') {
              drawKrokodoveOverlay(
                ctx,
                canvasW,
                canvasH,
                t,
                clip.fusion.krokodoveEffect,
                clip.fusion.krokodoveIntensity,
                clip.fusion.particleColor,
              );
            }
          }
        }
      });

      if (!drawStageResult.ok) {
        // Fallback safe draw if clip-fx plugin stage was quarantined
        const clip = activeAtT[0];
        const src = getVisualSource(clip);
        if (src) {
          ctx.drawImage(src.el, 0, 0, canvasW, canvasH);
        }
      }
    }

    // Master Color Grading Plug-in pass (isolated sandbox stage)
    const gradeActive = colorGrade.enabled && !bypassGrade;
    if (gradeActive) {
      runSandboxedCanvasStage('color-grading', ctx, () => {
        const eff = resolveEffectiveColorGrade(sanitizeColorGrade(colorGrade));
        // Re-draw canvas onto itself only if global brightness/contrast/sat differs from neutral
        if (
          Math.abs(eff.brightness) > 0.01 ||
          Math.abs(eff.contrast - 1) > 0.01 ||
          Math.abs(eff.saturation - 1) > 0.01
        ) {
          const bPct = Math.max(10, Math.round((1 + eff.brightness) * 100));
          const cPct = Math.max(10, Math.round(eff.contrast * 100));
          const sPct = Math.max(0, Math.round(eff.saturation * 100));
          const bCtx = bufCanvas.getContext('2d');
          if (bCtx) {
            bCtx.clearRect(0, 0, canvasW, canvasH);
            bCtx.drawImage(canvas, 0, 0);
            ctx.save();
            ctx.filter = `brightness(${bPct}%) contrast(${cPct}%) saturate(${sPct}%)`;
            ctx.drawImage(bufCanvas, 0, 0);
            ctx.restore();
          }
        }

        if (Math.abs(eff.temperature) > 0.01) {
          ctx.save();
          ctx.globalCompositeOperation = 'soft-light';
          ctx.fillStyle =
            eff.temperature > 0
              ? `rgba(255, 165, 65, ${Math.min(0.45, eff.temperature * 0.7)})`
              : `rgba(60, 145, 255, ${Math.min(0.45, Math.abs(eff.temperature) * 0.7)})`;
          ctx.fillRect(0, 0, canvasW, canvasH);
          ctx.restore();
        }
        if (Math.abs(eff.tint) > 0.01) {
          ctx.save();
          ctx.globalCompositeOperation = 'soft-light';
          ctx.fillStyle =
            eff.tint > 0
              ? `rgba(70, 210, 110, ${Math.min(0.35, eff.tint * 0.6)})`
              : `rgba(215, 70, 190, ${Math.min(0.35, Math.abs(eff.tint) * 0.6)})`;
          ctx.fillRect(0, 0, canvasW, canvasH);
          ctx.restore();
        }
        if (eff.vignette > 0.02) {
          ctx.save();
          const grad = ctx.createRadialGradient(
            canvasW / 2,
            canvasH / 2,
            Math.min(canvasW, canvasH) * 0.28,
            canvasW / 2,
            canvasH / 2,
            Math.hypot(canvasW / 2, canvasH / 2),
          );
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(1, `rgba(0,0,0,${Math.min(0.88, eff.vignette * 0.9)})`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, canvasW, canvasH);
          ctx.restore();
        }
      });
    }
  };

  renderFrameRef.current = renderFrame;
  syncAudioRef.current = syncAudioAtTime;

  useEffect(() => {
    if (!isPlaying) {
      renderFrame(playhead);
    }
  }, [playhead, clips, tracks, colorGrade, bypassGrade, canvasW, canvasH, isPlaying]);

  useEffect(() => {
    if (!isPlaying || totalDuration <= 0) return;

    let rafId = 0;
    let lastTick = performance.now();
    let lastDraw = 0;

    const tick = (now: number) => {
      const dt = (now - lastTick) / 1000;
      lastTick = now;

      let nextT = playheadRef.current + dt;
      if (nextT >= totalDuration) {
        nextT = 0;
        onTogglePlay();
        onPlayheadChange(0);
        syncAudioRef.current(0, false);
        renderFrameRef.current(0);
        return;
      }

      playheadRef.current = nextT;
      if (now - lastDraw >= 32) {
        lastDraw = now;
        renderFrameRef.current(nextT);
        syncAudioRef.current(nextT, true);
        onPlayheadChange(nextT);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, totalDuration]);

  // Measure preview viewport so interactive SVG handle overlay aligns 1:1 with canvas
  useEffect(() => {
    const el = stageViewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const pad = 16;
      const availW = Math.max(80, r.width - pad);
      const availH = Math.max(80, r.height - pad);
      const fitScale = Math.min(availW / canvasW, availH / canvasH);
      setStageSize({
        w: Math.round(canvasW * fitScale),
        h: Math.round(canvasH * fitScale),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasW, canvasH, clips.length]);

  const activeLayerBoxes = useMemo(() => {
    if (clips.length === 0) return [];
    // Topmost tracks first for pointer hit-testing
    const visibleTracks = tracks.filter((tr) => tr.kind === 'video' && !tr.hidden);
    const out: { clip: TimelineClip; box: ReturnType<typeof computeClipRenderBox>; srcW: number; srcH: number }[] = [];
    for (const trk of visibleTracks) {
      const atT = clips.filter(
        (c) =>
          c.trackId === trk.id &&
          c.kind !== 'audio' &&
          playhead >= c.startTime &&
          playhead <= c.startTime + c.duration,
      );
      for (const clip of atT) {
        let srcW = canvasW;
        let srcH = canvasH;
        if (clip.mediaId) {
          const asset = assetsMap.get(clip.mediaId);
          const img = imageCacheRef.current.get(clip.mediaId);
          const vid = videoCacheRef.current.get(clip.id);
          if (img && img.naturalWidth > 0) {
            srcW = img.naturalWidth;
            srcH = img.naturalHeight;
          } else if (vid && vid.videoWidth > 0) {
            srcW = vid.videoWidth;
            srcH = vid.videoHeight;
          } else if (asset && asset.width > 0 && asset.height > 0) {
            srcW = asset.width;
            srcH = asset.height;
          }
        }
        const localProg = Math.max(0, Math.min(1, (playhead - clip.startTime) / Math.max(0.1, clip.duration)));
        const evalClip = applyAnimatedClipState(clip, localProg);
        out.push({
          clip: evalClip,
          box: computeClipRenderBox(evalClip, srcW, srcH, canvasW, canvasH),
          srcW,
          srcH,
        });
      }
    }
    return out;
  }, [tracks, clips, playhead, canvasW, canvasH, assetsMap]);

  const selectedActiveEntry = useMemo(
    () => (selectedClipId ? activeLayerBoxes.find((e) => e.clip.id === selectedClipId) || null : null),
    [activeLayerBoxes, selectedClipId],
  );

  const selectedClipObj = useMemo(
    () => (selectedClipId ? clips.find((c) => c.id === selectedClipId) || null : null),
    [clips, selectedClipId],
  );

  type HandleKind = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

  const startLayerDrag = (
    e: React.PointerEvent,
    entry: { clip: TimelineClip; box: ReturnType<typeof computeClipRenderBox>; srcW: number; srcH: number },
    handle: HandleKind,
  ) => {
    if (!onUpdateClip || isPlaying) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectClip?.(entry.clip.id);
    onCommitHistory?.();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const svgEl = e.currentTarget.closest('svg');
    const rect = svgEl ? svgEl.getBoundingClientRect() : null;
    const pxToCanvasX = rect && rect.width > 0 ? canvasW / rect.width : 1;
    const pxToCanvasY = rect && rect.height > 0 ? canvasH / rect.height : 1;

    const startClip = entry.clip;
    const startBox = entry.box;
    const startCrop = sanitizeClipCrop(startClip.crop);
    const rotRad = ((startClip.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(-rotRad);
    const sin = Math.sin(-rotRad);

    const onMove = (ev: PointerEvent) => {
      const dxCanvas = (ev.clientX - startClientX) * pxToCanvasX;
      const dyCanvas = (ev.clientY - startClientY) * pxToCanvasY;
      const localDx = dxCanvas * cos - dyCanvas * sin;
      const localDy = dxCanvas * sin + dyCanvas * cos;

      if (handle === 'move') {
        onUpdateClip(startClip.id, {
          x: Number(Math.max(-95, Math.min(95, startClip.x + (dxCanvas / canvasW) * 100)).toFixed(1)),
          y: Number(Math.max(-95, Math.min(95, startClip.y + (dyCanvas / canvasH) * 100)).toFixed(1)),
        });
        return;
      }

      if (activeTool === 'crop') {
        const fracPerPxX = (1 - startCrop.left - startCrop.right) / Math.max(12, startBox.boxW);
        const fracPerPxY = (1 - startCrop.top - startCrop.bottom) / Math.max(12, startBox.boxH);
        const nextCrop: ClipCrop = { ...startCrop };

        if (handle.includes('w')) {
          nextCrop.left = Math.max(0, Math.min(0.9 - startCrop.right, startCrop.left + localDx * fracPerPxX));
        }
        if (handle.includes('e')) {
          nextCrop.right = Math.max(0, Math.min(0.9 - startCrop.left, startCrop.right - localDx * fracPerPxX));
        }
        if (handle.includes('n')) {
          nextCrop.top = Math.max(0, Math.min(0.9 - startCrop.bottom, startCrop.top + localDy * fracPerPxY));
        }
        if (handle.includes('s')) {
          nextCrop.bottom = Math.max(0, Math.min(0.9 - startCrop.top, startCrop.bottom - localDy * fracPerPxY));
        }
        onUpdateClip(startClip.id, { crop: sanitizeClipCrop(nextCrop) });
        return;
      }

      // Resize mode
      const halfW = Math.max(8, startBox.boxW / 2);
      const halfH = Math.max(8, startBox.boxH / 2);
      const signX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
      const signY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;

      if (signX !== 0 && signY !== 0) {
        // Corner handle -> proportional resize via scale
        const rx = (halfW + signX * localDx) / halfW;
        const ry = (halfH + signY * localDy) / halfH;
        const factor = Math.max(0.1, (rx + ry) / 2);
        const nextScale = Number(Math.max(0.1, Math.min(3.0, (startClip.scale || 1) * factor)).toFixed(2));
        onUpdateClip(startClip.id, { scale: nextScale });
      } else if (signX !== 0) {
        // Left/Right edge -> independent width resize (scaleX)
        const rx = (halfW + signX * localDx) / halfW;
        const nextScaleX = Number(Math.max(0.15, Math.min(3.0, (startClip.scaleX ?? 1) * rx)).toFixed(2));
        onUpdateClip(startClip.id, { scaleX: nextScaleX });
      } else if (signY !== 0) {
        // Top/Bottom edge -> independent height resize (scaleY)
        const ry = (halfH + signY * localDy) / halfH;
        const nextScaleY = Number(Math.max(0.15, Math.min(3.0, (startClip.scaleY ?? 1) * ry)).toFixed(2));
        onUpdateClip(startClip.id, { scaleY: nextScaleY });
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleCanvasBackgroundPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onSelectClip || isPlaying || activeLayerBoxes.length === 0) return;
    const svgEl = e.currentTarget;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * canvasW;
    const py = ((e.clientY - rect.top) / rect.height) * canvasH;

    // Find topmost visible layer whose rotated bounding box contains (px, py)
    const hit = activeLayerBoxes.find(({ clip, box }) => {
      const dx = px - box.cx;
      const dy = py - box.cy;
      const rad = (-(clip.rotation || 0) * Math.PI) / 180;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      return Math.abs(lx) <= box.boxW / 2 && Math.abs(ly) <= box.boxH / 2;
    });

    if (hit) {
      startLayerDrag(e, hit, 'move');
    } else {
      onSelectClip(null);
    }
  };

  const selectedHasSizeMod = Boolean(
    selectedClipObj &&
      (Math.abs((selectedClipObj.scale || 1) - 1) > 0.01 ||
        Math.abs((selectedClipObj.scaleX ?? 1) - 1) > 0.01 ||
        Math.abs((selectedClipObj.scaleY ?? 1) - 1) > 0.01 ||
        Math.abs(selectedClipObj.x) > 0.5 ||
        Math.abs(selectedClipObj.y) > 0.5),
  );
  const selectedHasCrop = Boolean(selectedClipObj && isClipCropped(selectedClipObj.crop));

  const stepFrame = (deltaFrames: number) => {
    if (isPlaying) onTogglePlay();
    const frameDur = 1 / fps;
    const next = Math.max(0, Math.min(totalDuration, Math.round((playhead + deltaFrames * frameDur) * fps) / fps));
    onPlayheadChange(next);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#101318] border border-slate-200 dark:border-[#232832] rounded-lg overflow-hidden shadow-xs dark:shadow-none">
      {/* Layer Canvas Tool Bar (Resize / Crop direct manipulation) */}
      {clips.length > 0 && (
        <div className="h-8 px-3 border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#14171d] flex items-center justify-between gap-2 text-[11px] shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTool('resize')}
              title="Move & resize selected layer directly on preview canvas"
              className={`px-2 py-0.5 rounded flex items-center gap-1 font-medium transition-colors cursor-pointer ${
                activeTool === 'resize'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-200 dark:bg-[#1b2029] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Move className="w-3 h-3" />
              <span>Resize / Move</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTool('crop')}
              title="Drag edge or corner handles on preview canvas to crop layer"
              className={`px-2 py-0.5 rounded flex items-center gap-1 font-medium transition-colors cursor-pointer ${
                activeTool === 'crop'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-200 dark:bg-[#1b2029] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Crop className="w-3 h-3" />
              <span>Crop</span>
            </button>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            {selectedActiveEntry ? (
              <>
                <span className="text-slate-600 dark:text-slate-400 truncate max-w-[140px]">
                  {selectedActiveEntry.clip.name}
                </span>
                <span className="text-slate-800 dark:text-slate-300 font-mono-tabular hidden sm:inline">
                  {Math.round((selectedActiveEntry.clip.scale || 1) * (selectedActiveEntry.clip.scaleX ?? 1) * 100)}%×
                  {Math.round((selectedActiveEntry.clip.scale || 1) * (selectedActiveEntry.clip.scaleY ?? 1) * 100)}%
                </span>
                {selectedHasSizeMod && onUpdateClip && (
                  <button
                    type="button"
                    onClick={() => {
                      onCommitHistory?.();
                      onUpdateClip(selectedActiveEntry.clip.id, { scale: 1, scaleX: 1, scaleY: 1, x: 0, y: 0 });
                    }}
                    className="px-1.5 py-0.5 rounded bg-slate-200 hover:bg-slate-300 dark:bg-[#1b2029] dark:hover:bg-[#272f3d] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                    title="Reset layer size & position"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Reset Size</span>
                  </button>
                )}
                {selectedHasCrop && onUpdateClip && (
                  <button
                    type="button"
                    onClick={() => {
                      onCommitHistory?.();
                      onUpdateClip(selectedActiveEntry.clip.id, { crop: { ...DEFAULT_CLIP_CROP } });
                    }}
                    className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-600/20 hover:bg-amber-100 dark:hover:bg-amber-600/35 border border-amber-400/60 dark:border-amber-500/40 text-amber-800 dark:text-amber-200 flex items-center gap-1 cursor-pointer"
                    title="Reset layer crop"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Uncrop</span>
                  </button>
                )}
              </>
            ) : (
              <span className="text-[10px] text-slate-500 truncate">
                Click a layer on canvas or timeline to resize & crop
              </span>
            )}
          </div>
        </div>
      )}

      <div
        ref={stageViewportRef}
        onDragOver={(e) => {
          if (clips.length === 0 && e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setEmptyDropActive(true);
          }
        }}
        onDragLeave={() => setEmptyDropActive(false)}
        onDrop={(e) => {
          if (clips.length === 0 && e.dataTransfer.files && e.dataTransfer.files.length > 0 && onUploadFiles) {
            e.preventDefault();
            setEmptyDropActive(false);
            onUploadFiles(e.dataTransfer.files);
          }
        }}
        className={`relative flex-1 min-h-0 flex items-center justify-center p-2 transition-colors ${
          clips.length === 0 ? 'bg-slate-100 dark:bg-[#090b0e]' : 'bg-[#090b0e]'
        } ${
          emptyDropActive ? 'ring-2 ring-inset ring-blue-500 bg-blue-50 dark:bg-blue-950/20' : ''
        }`}
      >
        {clips.length === 0 ? (
          <div className="text-center max-w-md px-4 space-y-4">
            <input
              ref={emptyUploadRef}
              type="file"
              multiple
              accept={ACCEPTED_MEDIA_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0 && onUploadFiles) {
                  onUploadFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Create a Video in Minutes</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                Drop photos, video clips, or music right here—or start immediately with our sample pack to preview beat-synced transitions and effects.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {onLoadSamplePack && (
                <button
                  type="button"
                  disabled={loadingSample || uploading}
                  onClick={onLoadSamplePack}
                  className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {loadingSample ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderPlus className="w-3.5 h-3.5" />
                  )}
                  <span>{loadingSample ? 'Loading Sample...' : 'Try Sample Project (120 BPM)'}</span>
                </button>
              )}
              {onUploadFiles && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => emptyUploadRef.current?.click()}
                  className="px-4 py-2 rounded bg-white hover:bg-slate-50 dark:bg-[#1b2029] dark:hover:bg-[#252c38] border border-slate-300 dark:border-[#2f3746] disabled:opacity-50 text-slate-800 dark:text-slate-100 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {uploading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 dark:text-blue-400" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                  )}
                  <span>{uploading ? 'Uploading...' : 'Upload Your Media'}</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-500 pt-1">
              <span>1. Add photos or videos</span>
              <span aria-hidden="true">·</span>
              <span>2. Auto-sync or edit tracks</span>
              <span aria-hidden="true">·</span>
              <span>3. Export HD</span>
              {onOpenTutorial && (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={onOpenTutorial}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <BookOpen className="w-3 h-3" />
                    <span>Walkthrough</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div
            className="relative shrink-0"
            style={
              stageSize.w > 0 && stageSize.h > 0
                ? { width: stageSize.w, height: stageSize.h }
                : { aspectRatio: `${canvasW} / ${canvasH}`, maxWidth: '100%', maxHeight: '100%' }
            }
          >
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              className="w-full h-full block rounded border border-slate-700 dark:border-[#1f242d] bg-black"
            />
            {!isPlaying && onUpdateClip && (
              <svg
                viewBox={`0 0 ${canvasW} ${canvasH}`}
                onPointerDown={handleCanvasBackgroundPointerDown}
                className="absolute inset-0 w-full h-full touch-none select-none overflow-hidden rounded"
              >
                {selectedActiveEntry && (() => {
                  const { clip, box } = selectedActiveEntry;
                  const hw = box.boxW / 2;
                  const hh = box.boxH / 2;
                  const isCrop = activeTool === 'crop';
                  const strokeCol = isCrop ? '#f59e0b' : '#3b82f6';
                  const handlePoints: { id: HandleKind; x: number; y: number; cursor: string; isEdge: boolean }[] = [
                    { id: 'nw', x: -hw, y: -hh, cursor: 'nwse-resize', isEdge: false },
                    { id: 'n', x: 0, y: -hh, cursor: 'ns-resize', isEdge: true },
                    { id: 'ne', x: hw, y: -hh, cursor: 'nesw-resize', isEdge: false },
                    { id: 'e', x: hw, y: 0, cursor: 'ew-resize', isEdge: true },
                    { id: 'se', x: hw, y: hh, cursor: 'nwse-resize', isEdge: false },
                    { id: 's', x: 0, y: hh, cursor: 'ns-resize', isEdge: true },
                    { id: 'sw', x: -hw, y: hh, cursor: 'nesw-resize', isEdge: false },
                    { id: 'w', x: -hw, y: 0, cursor: 'ew-resize', isEdge: true },
                  ];

                  return (
                    <g transform={`translate(${box.cx}, ${box.cy}) rotate(${clip.rotation || 0})`}>
                      {/* Interactive drag body */}
                      <rect
                        x={-hw}
                        y={-hh}
                        width={box.boxW}
                        height={box.boxH}
                        fill="transparent"
                        stroke={strokeCol}
                        strokeWidth={2}
                        strokeDasharray={isCrop ? '6 4' : undefined}
                        style={{ cursor: 'move' }}
                        onPointerDown={(ev) => startLayerDrag(ev, selectedActiveEntry, 'move')}
                      />

                      {/* Rule of thirds guides in Crop mode */}
                      {isCrop && (
                        <g stroke="#f59e0b" strokeOpacity={0.35} strokeWidth={1} pointerEvents="none">
                          <line x1={-hw + box.boxW / 3} y1={-hh} x2={-hw + box.boxW / 3} y2={hh} />
                          <line x1={-hw + (box.boxW * 2) / 3} y1={-hh} x2={-hw + (box.boxW * 2) / 3} y2={hh} />
                          <line x1={-hw} y1={-hh + box.boxH / 3} x2={hw} y2={-hh + box.boxH / 3} />
                          <line x1={-hw} y1={-hh + (box.boxH * 2) / 3} x2={hw} y2={-hh + (box.boxH * 2) / 3} />
                        </g>
                      )}

                      {/* 8 Corner & Edge Handles */}
                      {handlePoints.map((hp) => {
                        const rw = isCrop && hp.isEdge ? (hp.id === 'n' || hp.id === 's' ? 28 : 7) : 10;
                        const rh = isCrop && hp.isEdge ? (hp.id === 'n' || hp.id === 's' ? 7 : 28) : 10;
                        return (
                          <rect
                            key={hp.id}
                            x={hp.x - rw / 2}
                            y={hp.y - rh / 2}
                            width={rw}
                            height={rh}
                            rx={1.5}
                            fill={isCrop ? '#f59e0b' : '#ffffff'}
                            stroke={isCrop ? '#0d0f12' : '#3b82f6'}
                            strokeWidth={2}
                            style={{ cursor: hp.cursor }}
                            onPointerDown={(ev) => startLayerDrag(ev, selectedActiveEntry, hp.id)}
                          />
                        );
                      })}
                    </g>
                  );
                })()}
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Collapsible Live Audio Spectrum Analyzer Drawer */}
      {clips.length > 0 && showSpectrum && (
        <div className="px-3 py-2 border-t border-slate-200 dark:border-[#232832] bg-slate-100 dark:bg-[#0c1016] shrink-0">
          <AudioSpectrumVisualizer
            tracks={tracks}
            clips={clips}
            playhead={playhead}
            isPlaying={isPlaying}
            masterMuted={masterMuted}
            normalizeAudio={Boolean(normalizeAudio)}
            normalizeTargetLufs={normalizeTargetLufs ?? -14}
            bandCount={40}
            heightClass="h-20"
            title="Live Audio Frequency Spectrum (RTA · 36 Hz – 15.5 kHz)"
          />
        </div>
      )}

      {/* Frame-Accurate Transport Bar */}
      <div className="h-11 px-4 border-t border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#14171d] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
          <span className="text-slate-900 dark:text-slate-100 font-medium">{formatFrameTimecode(playhead, fps)}</span>
          <span aria-hidden="true">/</span>
          <span className="hidden sm:inline">{formatFrameTimecode(totalDuration, fps)}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPlayheadChange(0)}
            disabled={clips.length === 0}
            title="Jump to start"
            className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#222731] disabled:opacity-40 transition-colors cursor-pointer"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => stepFrame(-1)}
            disabled={clips.length === 0}
            title="Step back 1 frame (,)"
            className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#222731] disabled:opacity-40 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={clips.length === 0}
            className="px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <button
            type="button"
            onClick={() => stepFrame(1)}
            disabled={clips.length === 0}
            title="Step forward 1 frame (.)"
            className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#222731] disabled:opacity-40 transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onPlayheadChange(totalDuration)}
            disabled={clips.length === 0}
            title="Jump to end"
            className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#222731] disabled:opacity-40 transition-colors cursor-pointer"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {clips.length > 0 && (() => {
            const meter = computeStereoMetersAtTime(
              tracks,
              clips,
              playhead,
              masterMuted,
              isPlaying,
              Boolean(normalizeAudio),
              normalizeTargetLufs ?? -14,
            );
            return (
              <div
                className="hidden sm:flex items-center px-2 py-1 rounded bg-white dark:bg-[#0e1116] border border-slate-200 dark:border-[#232935]"
                title={
                  normalizeAudio
                    ? `Master Output L/R · Normalized (${normalizeTargetLufs ?? -14} LUFS)`
                    : 'Master Output L/R Peak/RMS Meter'
                }
              >
                <AudioMeterBar
                  leftDb={meter.leftDb}
                  rightDb={meter.rightDb}
                  orientation="horizontal"
                  compact
                  muted={masterMuted}
                  clipping={meter.clipping}
                />
              </div>
            );
          })()}
          {clips.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSpectrum((s) => !s)}
              aria-pressed={showSpectrum}
              title={showSpectrum ? 'Hide Audio Spectrum Visualizer' : 'Show Audio Spectrum Visualizer'}
              className={`px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showSpectrum
                  ? 'bg-cyan-600/15 dark:bg-cyan-600/25 border-cyan-500 dark:border-cyan-400 text-cyan-800 dark:text-cyan-200'
                  : 'bg-white dark:bg-[#0e1116] border-slate-300 dark:border-[#262c38] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <AudioLines className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Spectrum</span>
            </button>
          )}
          <span className="hidden lg:inline text-[11px] text-slate-500 font-mono-tabular">
            {fps} fps · {resolution.replace('x', '×')}
          </span>
          <button
            type="button"
            onClick={onToggleMute}
            title={masterMuted ? 'Unmute audio preview' : 'Mute audio preview'}
            className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#222731] transition-colors cursor-pointer"
          >
            {masterMuted ? <VolumeX className="w-4 h-4 text-amber-500 dark:text-amber-400" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};
