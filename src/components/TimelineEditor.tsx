import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Infinity as InfinityIcon,
  Layers,
  Lock,
  Magnet,
  Maximize2,
  Plus,
  Redo2,
  Rows3,
  Scissors,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AudioTransitionType,
  AudioVolumePoint,
  MediaAsset,
  TimelineClip,
  TimelineTrack,
  TrackLayerRole,
  TRANSITION_GROUPS,
  TRANSITION_OPTIONS,
  TransitionType,
} from '../types/editor';
import {
  applyAudioFadeCurve,
  computeTimelineDuration,
  evaluateAudioEnvelopeGain,
  formatFrameTimecode,
} from '../utils/timelineMath';

const AUDIO_TRANSITION_LABELS: Record<AudioTransitionType, string> = {
  cut: 'Cut',
  crossfade_eq: 'Crossfade (Eq)',
  crossfade_lin: 'Linear Crossfade',
  dip_swell: 'Dip & Swell',
};

interface TimelineEditorProps {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  assetsMap: Map<string, MediaAsset>;
  fps: number;
  playhead: number;
  selectedClipId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  rippleMode: boolean;
  freeformRoughCut?: boolean;
  markIn?: number | null;
  markOut?: number | null;
  onSelectClip: (id: string | null) => void;
  onPlayheadChange: (t: number) => void;
  onAddTrack: (kind: 'video' | 'audio', layerRole?: TrackLayerRole) => void;
  onMoveTrack?: (trackId: string, direction: 'up' | 'down') => void;
  onUpdateTrack: (trackId: string, patch: Partial<TimelineTrack>) => void;
  onDeleteTrack: (trackId: string) => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onSplitAtPlayhead: () => void;
  onDeleteClip: (id: string) => void;
  onDuplicateClip?: (id: string) => void;
  onDropAssetOnTrack: (asset: MediaAsset, trackId: string, startTime: number) => void;
  onDropAssetCreateTrack?: (asset: MediaAsset, role: TrackLayerRole, startTime: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleRippleMode: () => void;
  onToggleFreeformRoughCut?: () => void;
  onCommitHistory: () => void;
}

function getEffectiveLayerRole(trk: TimelineTrack): TrackLayerRole {
  if (trk.layerRole) return trk.layerRole;
  return trk.kind === 'audio' ? 'audio' : 'video';
}

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  tracks,
  clips,
  assetsMap,
  fps,
  playhead,
  selectedClipId,
  canUndo,
  canRedo,
  rippleMode,
  freeformRoughCut = false,
  markIn = null,
  markOut = null,
  onSelectClip,
  onPlayheadChange,
  onAddTrack,
  onMoveTrack,
  onUpdateTrack,
  onDeleteTrack,
  onUpdateClip,
  onSplitAtPlayhead,
  onDeleteClip,
  onDuplicateClip,
  onDropAssetOnTrack,
  onDropAssetCreateTrack,
  onUndo,
  onRedo,
  onToggleRippleMode,
  onToggleFreeformRoughCut,
  onCommitHistory,
}) => {
  const [pxPerSec, setPxPerSec] = useState<number>(64);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [compactRows, setCompactRows] = useState<boolean>(false);
  const [stackHeight, setStackHeight] = useState<number>(320);
  const [editingTransitionClipId, setEditingTransitionClipId] = useState<string | null>(null);
  const [editingAudioTransitionClipId, setEditingAudioTransitionClipId] = useState<string | null>(null);
  const [audioDragReadout, setAudioDragReadout] = useState<string | null>(null);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>('');
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const trackRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const totalDuration = useMemo(() => computeTimelineDuration(clips), [clips]);
  const effectiveSnap = snapEnabled && !freeformRoughCut;

  // Collect beat markers from audio clips
  const beatMarkers = useMemo(() => {
    const markers: number[] = [];
    for (const c of clips) {
      if (c.kind !== 'audio' || !c.beats) continue;
      for (const b of c.beats) {
        if (b >= c.trimStart && b <= c.trimStart + c.duration) {
          markers.push(Number((c.startTime + (b - c.trimStart)).toFixed(3)));
        }
      }
    }
    return markers;
  }, [clips]);

  // Snap points: playhead + clip edges + beat markers
  const snapPoints = useMemo(() => {
    const pts = new Set<number>([0, playhead]);
    for (const c of clips) {
      pts.add(c.startTime);
      pts.add(Number((c.startTime + c.duration).toFixed(3)));
    }
    for (const b of beatMarkers) pts.add(b);
    return Array.from(pts);
  }, [clips, beatMarkers, playhead]);

  const snapTime = (rawTime: number, excludeClipId?: string): number => {
    if (!effectiveSnap) return rawTime;
    const threshold = 10 / pxPerSec;
    let best = rawTime;
    let bestDist = threshold;
    for (const pt of snapPoints) {
      if (excludeClipId) {
        const exc = clips.find((c) => c.id === excludeClipId);
        if (exc && (Math.abs(pt - exc.startTime) < 0.001 || Math.abs(pt - (exc.startTime + exc.duration)) < 0.001)) {
          continue;
        }
      }
      const d = Math.abs(pt - rawTime);
      if (d < bestDist) {
        bestDist = d;
        best = pt;
      }
    }
    return best;
  };

  // Endless horizontal horizon grows automatically as clips or rough-cut playhead expand
  const horizonSec = Math.max(
    freeformRoughCut ? 30 : 18,
    totalDuration + (freeformRoughCut ? 20 : 10),
    playhead + 8,
  );
  const timelineWidth = Math.max(920, Math.ceil(horizonSec * pxPerSec));
  const rowHeightClass = compactRows ? 'h-11' : 'h-16';

  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const update = (clientX: number) => {
      const x = Math.max(0, clientX - rect.left);
      const rawT = Math.max(0, x / pxPerSec);
      const snapped = freeformRoughCut ? Number(rawT.toFixed(3)) : Math.round(rawT * fps) / fps;
      onPlayheadChange(snapped);
    };
    update(e.clientX);

    const onMove = (ev: MouseEvent) => update(ev.clientX);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Pan timeline with Alt+Drag or Middle Mouse Button
  const handleScrollAreaMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      const el = scrollAreaRef.current;
      if (!el) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const origLeft = el.scrollLeft;
      const origTop = el.scrollTop;

      const onMove = (ev: MouseEvent) => {
        el.scrollLeft = origLeft - (ev.clientX - startX);
        el.scrollTop = origTop - (ev.clientY - startY);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  };

  const handleWheelZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 10 : -10;
      setPxPerSec((p) => Math.max(20, Math.min(180, p + delta)));
    }
  };

  const handleZoomToFit = () => {
    const el = scrollAreaRef.current;
    const availWidth = el ? Math.max(420, el.clientWidth - 196) : 720;
    const span = Math.max(4, totalDuration + 1);
    const fitPx = Math.max(20, Math.min(180, Math.floor(availWidth / span)));
    setPxPerSec(fitPx);
  };

  const startResizeStackHeight = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = stackHeight;
    const onMove = (ev: MouseEvent) => {
      setStackHeight(Math.max(190, Math.min(760, startH + (ev.clientY - startY))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Drag clip horizontally AND vertically across any unlocked compatible tracks
  const startClipDrag = (e: React.MouseEvent, clip: TimelineClip, track: TimelineTrack) => {
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    onSelectClip(clip.id);
    if (track.locked) return;

    const startX = e.clientX;
    const origStart = clip.startTime;
    const compatibleTracks = tracks.filter((t) => t.kind === track.kind && !t.locked && !t.isFolder);
    let committed = false;

    const onMove = (ev: MouseEvent) => {
      if (!committed) {
        committed = true;
        onCommitHistory();
      }
      const dx = ev.clientX - startX;
      const rawStart = Math.max(0, origStart + dx / pxPerSec);
      const snapped = snapTime(rawStart, clip.id);

      let nextTrackId = clip.trackId;
      for (const trk of compatibleTracks) {
        const el = trackRefs.current.get(trk.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
          nextTrackId = trk.id;
          break;
        }
      }

      onUpdateClip(clip.id, {
        startTime: Number(Math.max(0, snapped).toFixed(3)),
        trackId: nextTrackId,
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startClipTrimLeft = (e: React.MouseEvent, clip: TimelineClip, locked?: boolean) => {
    e.stopPropagation();
    if (locked) return;
    const startX = e.clientX;
    const origStart = clip.startTime;
    const origDur = clip.duration;
    const origTrim = clip.trimStart;
    const origEnd = origStart + origDur;
    let committed = false;

    const onMove = (ev: MouseEvent) => {
      if (!committed) {
        committed = true;
        onCommitHistory();
      }
      const dx = ev.clientX - startX;
      let nextStart = Math.max(0, Math.min(origEnd - 0.25, origStart + dx / pxPerSec));
      nextStart = Math.max(0, Math.min(origEnd - 0.25, snapTime(nextStart, clip.id)));
      let delta = nextStart - origStart;
      if (clip.kind === 'video' || clip.kind === 'audio') {
        const minDelta = -origTrim / Math.max(0.05, clip.speed);
        if (delta < minDelta) {
          delta = minDelta;
          nextStart = Math.max(0, origStart + delta);
        }
      }
      onUpdateClip(clip.id, {
        startTime: Number(nextStart.toFixed(3)),
        duration: Number(Math.max(0.25, origEnd - nextStart).toFixed(3)),
        trimStart:
          clip.kind === 'video' || clip.kind === 'audio'
            ? Number(Math.max(0, origTrim + delta * clip.speed).toFixed(3))
            : origTrim,
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startClipTrimRight = (e: React.MouseEvent, clip: TimelineClip, locked?: boolean) => {
    e.stopPropagation();
    if (locked) return;
    const startX = e.clientX;
    const origDur = clip.duration;
    let committed = false;

    const onMove = (ev: MouseEvent) => {
      if (!committed) {
        committed = true;
        onCommitHistory();
      }
      const dx = ev.clientX - startX;
      let nextEnd = Math.max(clip.startTime + 0.25, clip.startTime + origDur + dx / pxPerSec);
      nextEnd = Math.max(clip.startTime + 0.25, snapTime(nextEnd, clip.id));
      let nextDur = nextEnd - clip.startTime;
      if (clip.maxSourceDuration && (clip.kind === 'video' || clip.kind === 'audio')) {
        const maxAvail = Math.max(0.25, (clip.maxSourceDuration - clip.trimStart) / clip.speed);
        nextDur = Math.min(maxAvail, nextDur);
      }
      onUpdateClip(clip.id, { duration: Number(nextDur.toFixed(3)) });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const parseDraggedAsset = (e: React.DragEvent): MediaAsset | null => {
    const raw =
      e.dataTransfer.getData('application/obsidiancut-asset') ||
      e.dataTransfer.getData('application/framecut-asset');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MediaAsset;
    } catch {
      return null;
    }
  };

  const commitTrackRename = (trackId: string) => {
    const clean = renameDraft.trim();
    if (clean) {
      onUpdateTrack(trackId, { name: clean });
    }
    setRenamingTrackId(null);
  };

  const startAudioFadeDrag = (
    e: React.MouseEvent,
    clip: TimelineClip,
    side: 'in' | 'out',
    locked?: boolean,
  ) => {
    e.stopPropagation();
    if (e.button !== 0 || locked) return;
    onSelectClip(clip.id);
    const startX = e.clientX;
    const origFade = side === 'in' ? clip.fadeIn || 0 : clip.fadeOut || 0;
    const maxFade = Math.max(0.05, Number((clip.duration * 0.48).toFixed(2)));
    let committed = false;

    const onMove = (ev: MouseEvent) => {
      if (!committed) {
        committed = true;
        onCommitHistory();
      }
      const dx = (ev.clientX - startX) / pxPerSec;
      const next = side === 'in' ? origFade + dx : origFade - dx;
      const clamped = Number(Math.max(0, Math.min(maxFade, next)).toFixed(2));
      setAudioDragReadout(`Fade ${side === 'in' ? 'In' : 'Out'}: ${clamped.toFixed(2)}s`);
      onUpdateClip(clip.id, side === 'in' ? { fadeIn: clamped } : { fadeOut: clamped });
    };
    const onUp = () => {
      setAudioDragReadout(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startAudioVolumeBandDrag = (
    e: React.MouseEvent,
    clip: TimelineClip,
    clipEl: HTMLElement,
    locked?: boolean,
  ) => {
    e.stopPropagation();
    if (e.button !== 0 || locked) return;
    onSelectClip(clip.id);
    const rect = clipEl.getBoundingClientRect();
    let committed = false;

    const updateFromClientY = (clientY: number) => {
      const fracFromTop = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(12, rect.height)));
      const nextVol = Number(((1 - fracFromTop) * 2).toFixed(2));
      setAudioDragReadout(`Clip Level: ${Math.round(nextVol * 100)}%`);
      onUpdateClip(clip.id, { volume: nextVol });
    };

    const onMove = (ev: MouseEvent) => {
      if (!committed) {
        committed = true;
        onCommitHistory();
      }
      updateFromClientY(ev.clientY);
    };
    const onUp = () => {
      setAudioDragReadout(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const insertAudioEnvelopePoint = (
    e: React.MouseEvent,
    clip: TimelineClip,
    clipEl: HTMLElement,
    locked?: boolean,
  ) => {
    e.stopPropagation();
    if (locked) return;
    onCommitHistory();
    onSelectClip(clip.id);
    const rect = clipEl.getBoundingClientRect();
    const normT = Math.max(0.01, Math.min(0.99, Number(((e.clientX - rect.left) / Math.max(12, rect.width)).toFixed(3))));
    const fracFromTop = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(12, rect.height)));
    const gain = Number(((1 - fracFromTop) * 2).toFixed(2));
    const existing = clip.volumeEnvelope && clip.volumeEnvelope.length > 0
      ? [...clip.volumeEnvelope]
      : [
          { id: `vp_s_${Date.now()}`, time: 0, gain: Number((clip.volume ?? 1).toFixed(2)) },
          { id: `vp_e_${Date.now() + 1}`, time: 1, gain: Number((clip.volume ?? 1).toFixed(2)) },
        ];
    existing.push({ id: `vp_${Date.now().toString(36)}`, time: normT, gain });
    existing.sort((a, b) => a.time - b.time);
    onUpdateClip(clip.id, { volumeEnvelope: existing });
  };

  const startAudioEnvelopePointDrag = (
    e: React.MouseEvent,
    clip: TimelineClip,
    pointId: string,
    clipEl: HTMLElement,
    locked?: boolean,
  ) => {
    e.stopPropagation();
    if (locked) return;
    if (e.shiftKey || e.button === 2) {
      e.preventDefault();
      const filtered = (clip.volumeEnvelope || []).filter((p) => p.id !== pointId);
      onCommitHistory();
      onUpdateClip(clip.id, { volumeEnvelope: filtered });
      return;
    }
    if (e.button !== 0) return;
    onSelectClip(clip.id);
    const rect = clipEl.getBoundingClientRect();
    let committed = false;

    const onMove = (ev: MouseEvent) => {
      if (!committed) {
        committed = true;
        onCommitHistory();
      }
      const normT = Math.max(0, Math.min(1, Number(((ev.clientX - rect.left) / Math.max(12, rect.width)).toFixed(3))));
      const fracFromTop = Math.max(0, Math.min(1, (ev.clientY - rect.top) / Math.max(12, rect.height)));
      const gain = Number(((1 - fracFromTop) * 2).toFixed(2));
      setAudioDragReadout(`Node: ${Math.round(gain * 100)}% @ ${(normT * clip.duration).toFixed(2)}s`);
      const nextEnv: AudioVolumePoint[] = (clip.volumeEnvelope || [])
        .map((p) => (p.id === pointId ? { ...p, time: normT, gain } : p))
        .sort((a, b) => a.time - b.time);
      onUpdateClip(clip.id, { volumeEnvelope: nextEnv });
    };
    const onUp = () => {
      setAudioDragReadout(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const transitionClip = clips.find((c) => c.id === editingTransitionClipId) || null;
  const audioTransitionClip = clips.find((c) => c.id === editingAudioTransitionClipId) || null;
  const tickStepSec = pxPerSec >= 90 ? 1 : pxPerSec >= 42 ? 2 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= timelineWidth / pxPerSec; t += tickStepSec) {
    ticks.push(t);
  }

  const videoTracks = tracks.filter((t) => t.kind === 'video');
  const audioTracks = tracks.filter((t) => t.kind === 'audio' && !t.isFolder);
  const overlayLayerCount = videoTracks.filter((t) => getEffectiveLayerRole(t) === 'overlay').length;
  const baseVideoCount = videoTracks.length - overlayLayerCount;
  const audioTrackCount = audioTracks.length;

  return (
    <section className="flex flex-col bg-[#14171d] border border-[#232832] rounded-lg overflow-hidden">
      {/* Toolbar: Endless Workspace & Boundless Tracks */}
      <div className="px-3.5 py-2 border-b border-[#232832] bg-[#171b22] flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1.5 mr-1">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs font-semibold text-slate-100">
              Endless Workspace
            </span>
            <span className="text-[10px] text-slate-400 font-mono-tabular">
              · {baseVideoCount}V · {overlayLayerCount}OL · {audioTrackCount}A
            </span>
          </div>

          <button
            type="button"
            onClick={() => onAddTrack('video', 'overlay')}
            title="Stack an unlimited overlay layer above your video tracks"
            className="px-2 py-1 rounded bg-[#1d222b] hover:bg-[#262d39] border border-purple-500/40 text-[11px] font-medium text-slate-200 flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3 text-purple-400" />
            <span>Overlay Layer</span>
          </button>
          <button
            type="button"
            onClick={() => onAddTrack('video', 'video')}
            title="Stack an unlimited video track vertically"
            className="px-2 py-1 rounded bg-[#1d222b] hover:bg-[#262d39] border border-[#2c3340] text-[11px] font-medium text-slate-200 flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3 text-blue-400" />
            <span>Video Track</span>
          </button>
          <button
            type="button"
            onClick={() => onAddTrack('audio', 'audio')}
            title="Stack an unlimited audio track vertically"
            className="px-2 py-1 rounded bg-[#1d222b] hover:bg-[#262d39] border border-[#2c3340] text-[11px] font-medium text-slate-200 flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3 text-emerald-400" />
            <span>Audio Track</span>
          </button>
          <button
            type="button"
            onClick={onSplitAtPlayhead}
            disabled={clips.length === 0}
            title="Split clip at playhead (S)"
            className="px-2.5 py-1 rounded bg-[#1d222b] hover:bg-blue-600 border border-[#2c3340] text-[11px] font-medium text-slate-200 hover:text-white disabled:opacity-40 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Scissors className="w-3 h-3" />
            <span>Split (S)</span>
          </button>
          <div className="flex items-center gap-0.5 border-l border-[#2c3340] pl-2">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="p-1.5 rounded bg-[#1d222b] hover:bg-[#262d39] border border-[#2c3340] text-slate-200 disabled:opacity-35 transition-colors cursor-pointer"
            >
              <Undo2 className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              className="p-1.5 rounded bg-[#1d222b] hover:bg-[#262d39] border border-[#2c3340] text-slate-200 disabled:opacity-35 transition-colors cursor-pointer"
            >
              <Redo2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onToggleFreeformRoughCut && (
            <button
              type="button"
              onClick={onToggleFreeformRoughCut}
              title="Zero-restriction Freeform Rough Cut: disables snap constraints and opens extended horizontal space"
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                freeformRoughCut
                  ? 'bg-emerald-500/20 border-emerald-500/70 text-emerald-200'
                  : 'bg-[#101318] border-[#262c38] text-slate-300 hover:text-white'
              }`}
            >
              <InfinityIcon className="w-3.5 h-3.5" />
              <span>Rough Cut</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleRippleMode}
            title="When enabled, deleting a clip automatically closes the gap on that track"
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              rippleMode
                ? 'bg-amber-500/20 border-amber-500/70 text-amber-200'
                : 'bg-[#101318] border-[#262c38] text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowLeftRight className="w-3 h-3" />
            <span>Ripple</span>
          </button>
          <button
            type="button"
            onClick={() => setSnapEnabled((s) => !s)}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              effectiveSnap
                ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                : 'bg-[#101318] border-[#262c38] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Magnet className="w-3 h-3" />
            <span>Snap</span>
          </button>

          <button
            type="button"
            onClick={() => setCompactRows((c) => !c)}
            title="Toggle compact layer height to view more stacked tracks simultaneously"
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 border transition-colors whitespace-nowrap cursor-pointer ${
              compactRows
                ? 'bg-[#1c2536] border-blue-500/60 text-blue-200'
                : 'bg-[#101318] border-[#262c38] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Rows3 className="w-3 h-3" />
            <span>{compactRows ? 'Compact' : 'Standard'}</span>
          </button>

          <button
            type="button"
            onClick={() => setStackHeight((h) => (h >= 460 ? 320 : 500))}
            title="Expand / collapse vertical Boundless Tracks stack viewport"
            className="px-2 py-1 rounded bg-[#101318] border border-[#262c38] text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer"
          >
            {stackHeight >= 460 ? 'Normal H' : 'Tall Stack'}
          </button>

          <div className="flex items-center gap-1 bg-[#101318] border border-[#262c38] rounded px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => setPxPerSec((p) => Math.max(20, p - 14))}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] text-slate-400 font-mono-tabular w-10 text-center">
              {pxPerSec}px
            </span>
            <button
              type="button"
              onClick={() => setPxPerSec((p) => Math.min(180, p + 14))}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleZoomToFit}
              className="p-1 text-slate-400 hover:text-white border-l border-[#262c38] pl-1.5 cursor-pointer"
              title="Zoom to fit entire project"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Inline Transition Bar */}
      {transitionClip && (
        <div className="px-4 py-2 bg-[#111824] border-b border-blue-500/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-medium text-blue-200">
              Transition after “{transitionClip.name}”
            </span>
            <select
              aria-label="Transitions"
              value={transitionClip.transitionOut}
              onChange={(e) =>
                onUpdateClip(transitionClip.id, {
                  transitionOut: e.target.value as TransitionType,
                  transitionDuration:
                    e.target.value === 'cut' ? 0 : Math.max(0.25, transitionClip.transitionDuration || 0.45),
                })
              }
              className="h-7 px-2 rounded bg-[#0c1017] border border-[#2d384b] text-slate-100"
            >
              {TRANSITION_GROUPS.map((groupName) => (
                <optgroup key={groupName} label={groupName}>
                  {TRANSITION_OPTIONS.filter((opt) => opt.group === groupName).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label className="flex items-center gap-2 text-slate-300">
              <span>Duration</span>
              <input
                type="range"
                min={0.1}
                max={1.8}
                step={0.05}
                disabled={transitionClip.transitionOut === 'cut'}
                value={transitionClip.transitionDuration}
                onChange={(e) =>
                  onUpdateClip(transitionClip.id, { transitionDuration: Number(e.target.value) })
                }
                className="studio-slider w-24"
              />
              <span className="font-mono-tabular w-10">
                {transitionClip.transitionOut === 'cut'
                  ? '0.00s'
                  : `${transitionClip.transitionDuration.toFixed(2)}s`}
              </span>
            </label>
          </div>
          <button
            type="button"
            onClick={() => setEditingTransitionClipId(null)}
            className="px-2.5 py-1 rounded bg-[#1d2636] hover:bg-[#273348] text-xs text-slate-200 cursor-pointer"
          >
            Done
          </button>
        </div>
      )}

      {/* Inline Audio Transition Bar */}
      {audioTransitionClip && (
        <div className="px-4 py-2 bg-[#0f1d18] border-b border-emerald-500/35 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-medium text-emerald-200">
              Music Transition after “{audioTransitionClip.name}”
            </span>
            <select
              aria-label="Audio Transitions"
              value={audioTransitionClip.audioTransitionOut || 'cut'}
              onChange={(e) => {
                const nextType = e.target.value as AudioTransitionType;
                onCommitHistory();
                onUpdateClip(audioTransitionClip.id, {
                  audioTransitionOut: nextType,
                  audioTransitionDuration:
                    nextType === 'cut' ? 0 : Math.max(0.4, audioTransitionClip.audioTransitionDuration || 1.2),
                });
              }}
              className="h-7 px-2 rounded bg-[#0c1017] border border-emerald-800 text-slate-100"
            >
              <option value="cut">Hard Cut</option>
              <option value="crossfade_eq">Equal-Power Crossfade (Smooth)</option>
              <option value="crossfade_lin">Linear Crossfade</option>
              <option value="dip_swell">Dip &amp; Swell Transition</option>
            </select>
            <label className="flex items-center gap-2 text-slate-300">
              <span>Crossfade Length</span>
              <input
                type="range"
                min={0.2}
                max={4.0}
                step={0.1}
                disabled={(audioTransitionClip.audioTransitionOut || 'cut') === 'cut'}
                value={audioTransitionClip.audioTransitionDuration ?? 1.2}
                onChange={(e) =>
                  onUpdateClip(audioTransitionClip.id, {
                    audioTransitionDuration: Number(e.target.value),
                  })
                }
                className="studio-slider w-24"
              />
              <span className="font-mono-tabular w-10">
                {(audioTransitionClip.audioTransitionOut || 'cut') === 'cut'
                  ? '0.00s'
                  : `${(audioTransitionClip.audioTransitionDuration ?? 1.2).toFixed(1)}s`}
              </span>
            </label>
          </div>
          <button
            type="button"
            onClick={() => setEditingAudioTransitionClipId(null)}
            className="px-2.5 py-1 rounded bg-[#182c24] hover:bg-[#203a2f] text-xs text-emerald-100 cursor-pointer"
          >
            Done
          </button>
        </div>
      )}

      {/* Boundless Multi-Track Scrollable Workspace */}
      <div
        ref={scrollAreaRef}
        style={{ maxHeight: `${stackHeight}px` }}
        onMouseDown={handleScrollAreaMouseDown}
        onWheel={handleWheelZoom}
        className="flex overflow-auto bg-[#0e1116]"
      >
        {/* Sticky Left Track Headers */}
        <div className="w-44 shrink-0 sticky left-0 z-30 border-r border-[#232832] bg-[#12151b]">
          <div className="h-7 border-b border-[#232832] px-2.5 flex items-center justify-between text-[10px] text-slate-400 font-mono-tabular sticky top-0 bg-[#12151b] z-10">
            <span>BOUNDLESS ({tracks.length})</span>
            <span className="text-slate-500">Z-ORDER</span>
          </div>

          {/* Top Quick-Stack Header Row */}
          <div className="h-7 border-b border-[#1d222c] px-2 flex items-center justify-between bg-[#101319]">
            <button
              type="button"
              onClick={() => onAddTrack('video', 'overlay')}
              className="text-[10px] text-purple-300 hover:text-purple-200 flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-2.5 h-2.5" />
              <span>Stack Overlay Above</span>
            </button>
          </div>

          {tracks.map((trk, idx) => {
            const role = getEffectiveLayerRole(trk);
            const canDelete =
              (trk.kind === 'video' && videoTracks.length > 1) ||
              (trk.kind === 'audio' && audioTrackCount > 1 && !trk.isFolder);
            const sameKindTracks = tracks.filter((t) => t.kind === trk.kind && !t.isFolder);
            const posInKind = sameKindTracks.findIndex((t) => t.id === trk.id);
            const canMoveUp = !trk.isFolder && posInKind > 0;
            const canMoveDown = !trk.isFolder && posInKind >= 0 && posInKind < sameKindTracks.length - 1;
            const roleCode = role === 'overlay' ? 'OL' : role === 'video' ? 'V' : 'A';
            const roleColor =
              role === 'overlay'
                ? 'text-purple-300'
                : role === 'video'
                  ? 'text-blue-300'
                  : 'text-emerald-300';

            return (
              <div
                key={trk.id}
                className={`${rowHeightClass} border-b border-[#232832] px-2 py-1 flex flex-col justify-between ${
                  trk.locked ? 'bg-[#101318]' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <span className={`text-[9px] font-mono-tabular font-bold shrink-0 ${roleColor}`}>
                      {roleCode}
                    </span>
                    {renamingTrackId === trk.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => commitTrackRename(trk.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitTrackRename(trk.id);
                          if (e.key === 'Escape') setRenamingTrackId(null);
                        }}
                        className="w-full h-4 px-1 rounded bg-[#0a0c10] border border-blue-500 text-[10px] text-white"
                      />
                    ) : (
                      <span
                        onDoubleClick={() => {
                          setRenamingTrackId(trk.id);
                          setRenameDraft(trk.name);
                        }}
                        title="Double-click to rename layer"
                        className={`text-[11px] font-semibold truncate cursor-text ${
                          trk.isFolder ? 'text-amber-300' : 'text-slate-200'
                        }`}
                      >
                        {trk.parentFolderId ? `↳ ${trk.name}` : trk.name}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    {onMoveTrack && !trk.isFolder && (
                      <>
                        <button
                          type="button"
                          disabled={!canMoveUp}
                          onClick={() => onMoveTrack(trk.id, 'up')}
                          title="Move layer higher in stack"
                          className="p-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-20 cursor-pointer"
                        >
                          <ArrowUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!canMoveDown}
                          onClick={() => onMoveTrack(trk.id, 'down')}
                          title="Move layer lower in stack"
                          className="p-0.5 text-slate-500 hover:text-slate-200 disabled:opacity-20 cursor-pointer"
                        >
                          <ArrowDown className="w-2.5 h-2.5" />
                        </button>
                      </>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => onDeleteTrack(trk.id)}
                        title="Remove layer"
                        className="p-0.5 text-slate-600 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>

                {!compactRows || idx >= 0 ? (
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      {trk.kind === 'video' ? (
                        <button
                          type="button"
                          onClick={() => onUpdateTrack(trk.id, { hidden: !trk.hidden })}
                          title={trk.hidden ? 'Show layer' : 'Hide layer'}
                          className={`p-0.5 rounded text-[10px] cursor-pointer ${
                            trk.hidden
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-[#1a1f28] text-slate-400 hover:text-white'
                          }`}
                        >
                          {trk.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onUpdateTrack(trk.id, { solo: !trk.solo })}
                          title="Solo track"
                          className={`px-1 py-0.5 rounded text-[9px] font-bold leading-none cursor-pointer ${
                            trk.solo
                              ? 'bg-amber-500 text-black'
                              : 'bg-[#1a1f28] text-slate-400 hover:text-white'
                          }`}
                        >
                          S
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onUpdateTrack(trk.id, { muted: !trk.muted })}
                        title={trk.muted ? 'Unmute track' : 'Mute track'}
                        className={`p-0.5 rounded cursor-pointer ${
                          trk.muted
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-[#1a1f28] text-slate-400 hover:text-white'
                        }`}
                      >
                        {trk.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateTrack(trk.id, { locked: !trk.locked })}
                        title={trk.locked ? 'Unlock track' : 'Lock track during rough cuts'}
                        className={`p-0.5 rounded cursor-pointer ${
                          trk.locked
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-[#1a1f28] text-slate-500 hover:text-white'
                        }`}
                      >
                        {trk.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      </button>
                      {trk.kind === 'audio' && !trk.isFolder && !compactRows && (
                        <div className="flex items-center gap-1 ml-1 min-w-0 flex-1">
                          <input
                            type="range"
                            min={0}
                            max={1.5}
                            step={0.05}
                            value={trk.volume ?? 1}
                            title={`Track volume: ${Math.round((trk.volume ?? 1) * 100)}%`}
                            onChange={(e) =>
                              onUpdateTrack(trk.id, { volume: Number(e.target.value) })
                            }
                            className="studio-slider w-12"
                          />
                          <span className="text-[9px] text-emerald-300/80 font-mono-tabular">
                            {Math.round((trk.volume ?? 1) * 100)}%
                          </span>
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] text-slate-500 font-mono-tabular shrink-0">
                      {clips.filter((c) => c.trackId === trk.id).length}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* Bottom Quick-Stack Header Row */}
          <div className="h-7 px-2 flex items-center justify-between bg-[#101319]">
            <button
              type="button"
              onClick={() => onAddTrack('audio', 'audio')}
              className="text-[10px] text-emerald-300 hover:text-emerald-200 flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-2.5 h-2.5" />
              <span>Stack Audio Below</span>
            </button>
          </div>
        </div>

        {/* Tracks Canvas */}
        <div style={{ width: `${timelineWidth}px` }} className="relative select-none shrink-0">
          {/* Sticky Time Ruler + Beat Ticks */}
          <div
            onMouseDown={handleRulerMouseDown}
            className="h-7 border-b border-[#232832] bg-[#13171f] sticky top-0 z-20 cursor-pointer"
          >
            {ticks.map((t) => (
              <div
                key={t}
                style={{ left: `${t * pxPerSec}px` }}
                className="absolute top-0 bottom-0 border-l border-[#2a303d] pl-1 flex items-center text-[10px] text-slate-400 font-mono-tabular"
              >
                {formatFrameTimecode(t, fps).slice(3)}
              </div>
            ))}
            {beatMarkers.map((b, idx) => (
              <div
                key={`${b}-${idx}`}
                style={{ left: `${b * pxPerSec}px` }}
                className="absolute bottom-0 w-[2px] h-2 bg-amber-400/75 pointer-events-none"
              />
            ))}
            {markIn !== null && markOut !== null && markOut > markIn && (
              <div
                style={{
                  left: `${markIn * pxPerSec}px`,
                  width: `${Math.max(2, (markOut - markIn) * pxPerSec)}px`,
                }}
                className="absolute top-0 bottom-0 bg-blue-500/20 border-x border-blue-400/70 pointer-events-none"
              />
            )}
          </div>

          {/* Top Auto-Stack Overlay Drop Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const asset = parseDraggedAsset(e);
              if (!asset || asset.mediaType === 'audio' || !onDropAssetCreateTrack) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const dropT = Math.max(0, Number(((e.clientX - rect.left) / pxPerSec).toFixed(2)));
              onDropAssetCreateTrack(asset, 'overlay', snapTime(dropT));
            }}
            className="h-7 border-b border-dashed border-[#242a36] bg-[#101319] flex items-center pl-4 text-[10px] text-slate-500"
          >
            Drop photos or videos here to stack a new Overlay Layer above
          </div>

          {/* Unlimited Vertical Track Rows */}
          {tracks.map((trk) => {
            const role = getEffectiveLayerRole(trk);
            const trkClips = clips
              .filter((c) => c.trackId === trk.id)
              .sort((a, b) => a.startTime - b.startTime);

            return (
              <div
                key={trk.id}
                ref={(el) => {
                  if (el) trackRefs.current.set(trk.id, el);
                  else trackRefs.current.delete(trk.id);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (trk.locked) return;
                  const asset = parseDraggedAsset(e);
                  if (!asset) return;
                  if (trk.kind === 'audio' && asset.mediaType !== 'audio') return;
                  if (trk.kind === 'video' && asset.mediaType === 'audio') return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const dropT = Math.max(0, Number(((e.clientX - rect.left) / pxPerSec).toFixed(2)));
                  onDropAssetOnTrack(asset, trk.id, snapTime(dropT));
                }}
                className={`${rowHeightClass} border-b border-[#232832] relative ${
                  trk.hidden ? 'opacity-40' : ''
                } ${trk.locked ? 'bg-[#111319]/80' : ''}`}
              >
                {trkClips.length === 0 && (
                  <div className="absolute inset-0 flex items-center pl-4 pointer-events-none">
                    <span className="text-[11px] text-slate-600">
                      {role === 'overlay'
                        ? 'Overlay layer — drop graphics, PiP clips, or titles here'
                        : trk.kind === 'video'
                          ? 'Video track — drop rough-cut clips freely anywhere'
                          : 'Audio track — drop music, dialogue, or SFX'}
                    </span>
                  </div>
                )}
                {trkClips.map((clip, idx) => {
                  const leftPx = clip.startTime * pxPerSec;
                  const widthPx = Math.max(24, clip.duration * pxPerSec);
                  const isSel = selectedClipId === clip.id;
                  const asset = clip.mediaId ? assetsMap.get(clip.mediaId) : undefined;
                  const nextClip = trkClips[idx + 1];
                  const touchesNextVideo =
                    trk.kind === 'video' &&
                    nextClip &&
                    clip.startTime + clip.duration - nextClip.startTime >= -0.15;
                  const touchesNextAudio =
                    trk.kind === 'audio' &&
                    clip.kind === 'audio' &&
                    nextClip &&
                    clip.startTime + clip.duration - nextClip.startTime >= -0.25;
                  const audioFadeInPx =
                    clip.kind === 'audio'
                      ? Math.min(widthPx * 0.45, Math.max(0, (clip.fadeIn || 0) * pxPerSec))
                      : 0;
                  const audioFadeOutPx =
                    clip.kind === 'audio'
                      ? Math.min(widthPx * 0.45, Math.max(0, (clip.fadeOut || 0) * pxPerSec))
                      : 0;
                  const envPts = clip.volumeEnvelope || [];
                  const hasEnv = envPts.length > 0;
                  const baseVolPct = Math.max(0, Math.min(100, (1 - (clip.volume ?? 1) / 2) * 100));

                  return (
                    <React.Fragment key={clip.id}>
                      <div
                        style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                        onMouseDown={(e) => startClipDrag(e, clip, trk)}
                        className={`group absolute top-1 bottom-1 rounded overflow-hidden border transition-colors ${
                          trk.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
                        } ${
                          clip.kind === 'audio'
                            ? isSel
                              ? 'border-emerald-400 bg-[#132b24]'
                              : 'border-[#1f4438] bg-[#10221c] hover:border-emerald-500/60'
                            : clip.kind === 'title'
                              ? isSel
                                ? 'border-amber-400 bg-[#2c2214]'
                                : 'border-[#4a371b] bg-[#211a11] hover:border-amber-500/70'
                              : isSel
                                ? 'border-blue-400 bg-[#1a263a]'
                                : 'border-[#2c3545] bg-[#171d27] hover:border-slate-500'
                        }`}
                      >
                        {clip.kind === 'audio' && clip.waveform && clip.waveform.length > 0 && (
                          <svg
                            viewBox={`0 0 ${Math.min(140, clip.waveform.length)} 32`}
                            preserveAspectRatio="none"
                            className="absolute inset-0 w-full h-full pointer-events-none opacity-45"
                          >
                            {(() => {
                              const bars = clip.waveform!;
                              const count = Math.min(140, bars.length);
                              const step = Math.max(1, Math.floor(bars.length / count));
                              const fadeCurve = clip.audioFadeCurve || 'scurve';
                              const rects: React.ReactNode[] = [];
                              for (let i = 0; i < count; i++) {
                                const norm = count > 1 ? i / (count - 1) : 0;
                                const localSec = norm * clip.duration;
                                const envGain = evaluateAudioEnvelopeGain(
                                  clip.volumeEnvelope,
                                  norm,
                                  clip.volume ?? 1,
                                );
                                let fMult = 1;
                                if ((clip.fadeIn || 0) > 0.02 && localSec < clip.fadeIn) {
                                  fMult *= applyAudioFadeCurve(localSec / clip.fadeIn, fadeCurve);
                                }
                                if ((clip.fadeOut || 0) > 0.02 && localSec > clip.duration - clip.fadeOut) {
                                  fMult *= applyAudioFadeCurve(
                                    (clip.duration - localSec) / clip.fadeOut,
                                    fadeCurve,
                                  );
                                }
                                const rawBar = Math.max(0.08, Math.min(1, bars[i * step] ?? 0.15));
                                const scaled = Math.max(0.04, Math.min(1, rawBar * Math.min(1.5, envGain) * fMult));
                                const h = scaled * 30;
                                rects.push(
                                  <rect
                                    key={i}
                                    x={i + 0.15}
                                    y={(32 - h) / 2}
                                    width={0.68}
                                    height={h}
                                    fill={
                                      clip.muted
                                        ? '#64748b'
                                        : clip.backgroundDucking
                                          ? '#6ee7b7'
                                          : '#34d399'
                                    }
                                  />,
                                );
                              }
                              return rects;
                            })()}
                          </svg>
                        )}

                        {/* Interactive Music Layer Rubber-Band Volume, Envelope Nodes & Fade Ramps */}
                        {clip.kind === 'audio' && (
                          <>
                            <svg
                              viewBox="0 0 100 100"
                              preserveAspectRatio="none"
                              className="absolute inset-0 w-full h-full pointer-events-none z-[5]"
                            >
                              {audioFadeInPx > 1 && widthPx > 0 && (
                                <polygon
                                  points={`0,0 ${(audioFadeInPx / widthPx) * 100},0 0,100`}
                                  fill="rgba(0,0,0,0.48)"
                                />
                              )}
                              {audioFadeOutPx > 1 && widthPx > 0 && (
                                <polygon
                                  points={`${100 - (audioFadeOutPx / widthPx) * 100},0 100,0 100,100`}
                                  fill="rgba(0,0,0,0.48)"
                                />
                              )}
                              {hasEnv ? (
                                <polyline
                                  fill="none"
                                  stroke="#fde047"
                                  strokeWidth="1.6"
                                  vectorEffect="non-scaling-stroke"
                                  points={(() => {
                                    const sorted = [...envPts].sort((a, b) => a.time - b.time);
                                    const pts: Array<{ x: number; y: number }> = [];
                                    if (sorted[0].time > 0) {
                                      pts.push({
                                        x: 0,
                                        y: Math.max(0, Math.min(100, (1 - sorted[0].gain / 2) * 100)),
                                      });
                                    }
                                    for (const p of sorted) {
                                      pts.push({
                                        x: p.time * 100,
                                        y: Math.max(0, Math.min(100, (1 - p.gain / 2) * 100)),
                                      });
                                    }
                                    if (sorted[sorted.length - 1].time < 1) {
                                      pts.push({
                                        x: 100,
                                        y: Math.max(
                                          0,
                                          Math.min(100, (1 - sorted[sorted.length - 1].gain / 2) * 100),
                                        ),
                                      });
                                    }
                                    return pts.map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ');
                                  })()}
                                />
                              ) : (
                                <line
                                  x1="0"
                                  y1={baseVolPct}
                                  x2="100"
                                  y2={baseVolPct}
                                  stroke="rgba(253, 224, 71, 0.72)"
                                  strokeWidth="1.4"
                                  vectorEffect="non-scaling-stroke"
                                />
                              )}
                            </svg>

                            {/* Volume Rubber-Band Hit Area: drag up/down for volume, double-click to insert envelope point */}
                            {!trk.locked && !hasEnv && (
                              <div
                                style={{ top: `calc(${baseVolPct}% - 4px)` }}
                                onMouseDown={(e) => {
                                  const parentClip = e.currentTarget.parentElement;
                                  if (parentClip) startAudioVolumeBandDrag(e, clip, parentClip, trk.locked);
                                }}
                                onDoubleClick={(e) => {
                                  const parentClip = e.currentTarget.parentElement;
                                  if (parentClip) insertAudioEnvelopePoint(e, clip, parentClip, trk.locked);
                                }}
                                title="Drag up/down for music volume · Double-click to add incremental volume ramp node"
                                className="absolute left-2 right-2 h-2 cursor-ns-resize z-10 hover:bg-amber-300/25 rounded"
                              />
                            )}
                            {!trk.locked && hasEnv && (
                              <div
                                onDoubleClick={(e) => {
                                  const parentClip = e.currentTarget.parentElement;
                                  if (parentClip) insertAudioEnvelopePoint(e, clip, parentClip, trk.locked);
                                }}
                                title="Double-click anywhere on audio clip to insert an envelope volume point"
                                className="absolute inset-x-3 top-2 bottom-2 z-[6]"
                              />
                            )}

                            {/* Interactive Envelope Diamond Nodes */}
                            {hasEnv &&
                              envPts.map((pt) => (
                                <div
                                  key={pt.id}
                                  style={{
                                    left: `${pt.time * 100}%`,
                                    top: `${Math.max(4, Math.min(96, (1 - pt.gain / 2) * 100))}%`,
                                  }}
                                  onMouseDown={(e) => {
                                    const parentClip = e.currentTarget.parentElement;
                                    if (parentClip) {
                                      startAudioEnvelopePointDrag(e, clip, pt.id, parentClip, trk.locked);
                                    }
                                  }}
                                  onContextMenu={(e) => e.preventDefault()}
                                  title={`Volume ${Math.round(pt.gain * 100)}% @ ${(pt.time * clip.duration).toFixed(2)}s (Drag to ramp · Right-click or Shift+Click to delete)`}
                                  className="absolute -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 bg-amber-300 border border-[#0a0d12] hover:scale-125 cursor-move z-20"
                                />
                              ))}

                            {/* Top-Left Fade-In Corner Handle */}
                            {!trk.locked && (
                              <div
                                style={{ left: `${Math.max(4, audioFadeInPx)}px` }}
                                onMouseDown={(e) => startAudioFadeDrag(e, clip, 'in', trk.locked)}
                                title={`Drag horizontally for Fade In (${(clip.fadeIn || 0).toFixed(2)}s)`}
                                className="absolute top-0.5 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-emerald-300/85 border border-[#0a0c10] opacity-70 group-hover:opacity-100 hover:scale-125 cursor-ew-resize z-20"
                              />
                            )}
                            {/* Top-Right Fade-Out Corner Handle */}
                            {!trk.locked && (
                              <div
                                style={{ right: `${Math.max(4, audioFadeOutPx)}px` }}
                                onMouseDown={(e) => startAudioFadeDrag(e, clip, 'out', trk.locked)}
                                title={`Drag horizontally for Fade Out (${(clip.fadeOut || 0).toFixed(2)}s)`}
                                className="absolute top-0.5 translate-x-1/2 w-2.5 h-2.5 rounded-full bg-emerald-300/85 border border-[#0a0c10] opacity-70 group-hover:opacity-100 hover:scale-125 cursor-ew-resize z-20"
                              />
                            )}
                          </>
                        )}

                        <div
                          onMouseDown={(e) => startClipTrimLeft(e, clip, trk.locked)}
                          title="Drag to trim in-point"
                          className="absolute top-0 left-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-blue-400/70 z-10"
                        />

                        <div className="relative h-full px-2 py-0.5 flex items-center gap-1.5 overflow-hidden pointer-events-none">
                          {asset?.thumbUrl && !compactRows && (
                            <img
                              src={asset.thumbUrl}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="w-7 h-5 rounded-sm object-cover shrink-0 bg-black pointer-events-none"
                            />
                          )}
                          {clip.kind === 'title' && (
                            <Type className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-slate-100 truncate">
                              {clip.name}
                            </p>
                            {!compactRows && (
                              <p className="text-[9px] text-slate-400 font-mono-tabular truncate">
                                {clip.duration.toFixed(2)}s
                                {clip.kind === 'audio' ? ` · ${Math.round((clip.volume ?? 1) * 100)}%` : ''}
                                {clip.kind === 'audio' && clip.backgroundDucking ? ' · DUCK' : ''}
                                {clip.kind === 'audio' && hasEnv ? ` · ${envPts.length}pts` : ''}
                                {clip.speed !== 1 ? ` · ${clip.speed.toFixed(2)}×` : ''}
                                {clip.reverse ? ' · REV' : ''}
                                {clip.effects.chromaKeyEnabled ? ' · KEY' : ''}
                              </p>
                            )}
                          </div>
                        </div>

                        {isSel && !trk.locked && (
                          <div className="absolute top-0.5 right-2 flex items-center gap-0.5 z-20">
                            {onDuplicateClip && (
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDuplicateClip(clip.id);
                                }}
                                title="Duplicate clip (Ctrl+D)"
                                className="p-0.5 rounded bg-black/60 text-slate-300 hover:text-blue-400 cursor-pointer"
                              >
                                <Copy className="w-2.5 h-2.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteClip(clip.id);
                              }}
                              title="Delete clip"
                              className="p-0.5 rounded bg-black/60 text-slate-300 hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}

                        <div
                          onMouseDown={(e) => startClipTrimRight(e, clip, trk.locked)}
                          title="Drag to resize / trim out-point"
                          className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-blue-400/70 z-10"
                        />
                      </div>

                      {touchesNextVideo && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTransitionClipId(
                              editingTransitionClipId === clip.id ? null : clip.id,
                            );
                          }}
                          style={{ left: `${nextClip.startTime * pxPerSec}px` }}
                          title="Click to edit transition to next clip"
                          className={`absolute bottom-0.5 -translate-x-1/2 z-20 px-1.5 py-0.5 rounded text-[9px] font-mono-tabular border whitespace-nowrap cursor-pointer ${
                            editingTransitionClipId === clip.id
                              ? 'bg-blue-600 border-blue-300 text-white'
                              : 'bg-[#0e121a] border-[#333c4d] text-slate-300 hover:border-blue-400 hover:text-white'
                          }`}
                        >
                          ↔ {clip.transitionOut}
                        </button>
                      )}

                      {touchesNextAudio && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingAudioTransitionClipId(
                              editingAudioTransitionClipId === clip.id ? null : clip.id,
                            );
                          }}
                          style={{ left: `${nextClip.startTime * pxPerSec}px` }}
                          title="Click to edit music crossfade / transition to next clip"
                          className={`absolute bottom-0.5 -translate-x-1/2 z-20 px-1.5 py-0.5 rounded text-[9px] font-mono-tabular border whitespace-nowrap cursor-pointer ${
                            editingAudioTransitionClipId === clip.id
                              ? 'bg-emerald-600 border-emerald-300 text-white'
                              : 'bg-[#0c1a15] border-emerald-700/70 text-emerald-200 hover:border-emerald-400 hover:text-white'
                          }`}
                        >
                          ♪ {AUDIO_TRANSITION_LABELS[clip.audioTransitionOut || 'cut']}
                        </button>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            );
          })}

          {/* Bottom Auto-Stack Audio Drop Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const asset = parseDraggedAsset(e);
              if (!asset || asset.mediaType !== 'audio' || !onDropAssetCreateTrack) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const dropT = Math.max(0, Number(((e.clientX - rect.left) / pxPerSec).toFixed(2)));
              onDropAssetCreateTrack(asset, 'audio', snapTime(dropT));
            }}
            className="h-7 bg-[#101319] flex items-center pl-4 text-[10px] text-slate-500"
          >
            Drop audio here to stack a new Audio Track below
          </div>

          {/* Playhead Vertical Line */}
          <div
            style={{ left: `${playhead * pxPerSec}px` }}
            className="absolute top-0 bottom-0 w-[1.5px] bg-blue-500 pointer-events-none z-20"
          >
            <div className="w-2.5 h-2.5 -ml-[4.5px] bg-blue-500 rotate-45 -mt-1" />
          </div>
        </div>
      </div>

      {/* Bottom Drag Handle + Live Audio Envelope / Fade Readout */}
      <div
        onMouseDown={startResizeStackHeight}
        title="Drag vertically to resize Boundless Tracks height"
        className="h-4 bg-[#11141a] hover:bg-blue-600/20 border-t border-[#232832] px-3 flex items-center justify-between cursor-ns-resize transition-colors"
      >
        <span className="text-[9px] text-slate-500 font-mono-tabular">
          {audioDragReadout || 'Audio Tip: Drag top fade dots, rubber-band line, or double-click clip to add volume ramp points'}
        </span>
        <div className="w-10 h-0.5 rounded bg-slate-600" />
        <span className="text-[9px] text-slate-600 font-mono-tabular">↕ {stackHeight}px</span>
      </div>
    </section>
  );
};
