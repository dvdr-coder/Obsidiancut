import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Diamond,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  ClipKeyframesMap,
  KeyframeEasing,
  KeyframePoint,
  KeyframeProperty,
  TimelineClip,
} from '../types/editor';
import {
  cloneClipKeyframes,
  evaluateAnimatedClipProps,
  evaluateKeyframeTrack,
  KEYFRAME_PROPERTY_META,
  KEYFRAME_PROPERTY_ORDER,
  uid,
} from '../utils/timelineMath';

interface KeyframeGraphEditorProps {
  clip: TimelineClip | null;
  visualClips: TimelineClip[];
  playhead: number;
  bypassed?: boolean;
  onSelectClip?: (id: string) => void;
  onPlayheadChange?: (t: number) => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onCommitHistory: () => void;
}

const SVG_W = 680;
const SVG_H = 164;
const PAD_L = 44;
const PAD_R = 14;
const PAD_T = 18;
const PAD_B = 22;
const PLOT_W = SVG_W - PAD_L - PAD_R;
const PLOT_H = SVG_H - PAD_T - PAD_B;

const EASING_LABELS: { id: KeyframeEasing; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease In' },
  { id: 'easeOut', label: 'Ease Out' },
  { id: 'easeInOut', label: 'Ease In-Out' },
];

export const KeyframeGraphEditor: React.FC<KeyframeGraphEditorProps> = ({
  clip,
  visualClips,
  playhead,
  bypassed = false,
  onSelectClip,
  onPlayheadChange,
  onUpdateClip,
  onCommitHistory,
}) => {
  const [activeProp, setActiveProp] = useState<KeyframeProperty>('opacity');
  const [selectedKfId, setSelectedKfId] = useState<string | null>(null);
  const [defaultEasing, setDefaultEasing] = useState<KeyframeEasing>('easeInOut');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const numCommittedRef = useRef<boolean>(false);

  useEffect(() => {
    setSelectedKfId(null);
    numCommittedRef.current = false;
  }, [clip?.id]);

  const meta = KEYFRAME_PROPERTY_META[activeProp];
  const dur = Math.max(0.2, clip?.duration ?? 4);
  const localTime = clip ? Math.max(0, Math.min(dur, playhead - clip.startTime)) : 0;
  const localNorm = clip ? Math.max(0, Math.min(1, localTime / dur)) : 0;

  const points: KeyframePoint[] = useMemo(() => {
    const raw = clip?.keyframes?.[activeProp] || [];
    return [...raw].sort((a, b) => a.time - b.time);
  }, [clip?.keyframes, activeProp]);

  const fallbackVal = clip ? clip[activeProp] : activeProp === 'opacity' || activeProp === 'scale' ? 1 : 0;
  const currentAnimatedProps = useMemo(
    () => (clip ? evaluateAnimatedClipProps(clip, localNorm) : null),
    [clip, localNorm],
  );
  const currentVal = currentAnimatedProps ? currentAnimatedProps[activeProp] : fallbackVal;

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedKfId) || null,
    [points, selectedKfId],
  );

  const timeToX = (tNorm: number) => PAD_L + Math.max(0, Math.min(1, tNorm)) * PLOT_W;
  const valToY = (val: number) => {
    const span = meta.max - meta.min || 1;
    const norm = Math.max(0, Math.min(1, (val - meta.min) / span));
    return PAD_T + (1 - norm) * PLOT_H;
  };
  const clientToPlot = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { tNorm: localNorm, value: currentVal };
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / Math.max(1, rect.width)) * SVG_W;
    const sy = ((clientY - rect.top) / Math.max(1, rect.height)) * SVG_H;
    const tNorm = Math.max(0, Math.min(1, (sx - PAD_L) / PLOT_W));
    const vNorm = Math.max(0, Math.min(1, 1 - (sy - PAD_T) / PLOT_H));
    const rawVal = meta.min + vNorm * (meta.max - meta.min);
    const snapped = Math.round(rawVal / meta.step) * meta.step;
    return {
      tNorm: Number(tNorm.toFixed(4)),
      value: Number(Math.max(meta.min, Math.min(meta.max, snapped)).toFixed(4)),
    };
  };

  const commitPropPoints = (nextPoints: KeyframePoint[], prop: KeyframeProperty = activeProp, recordHistory = false) => {
    if (!clip) return;
    if (recordHistory) onCommitHistory();
    const sorted = [...nextPoints].sort((a, b) => a.time - b.time);
    const nextMap: ClipKeyframesMap = cloneClipKeyframes(clip.keyframes) || {};
    if (sorted.length === 0) {
      delete nextMap[prop];
    } else {
      nextMap[prop] = sorted;
    }
    const hasAny = KEYFRAME_PROPERTY_ORDER.some((k) => (nextMap[k]?.length ?? 0) > 0);
    onUpdateClip(clip.id, { keyframes: hasAny ? nextMap : undefined });
  };

  const handleAddOrUpdateAtPlayhead = () => {
    if (!clip) return;
    onCommitHistory();
    const existingNear = points.find((p) => Math.abs(p.time - localNorm) < 0.025);
    if (existingNear) {
      const updated = points.map((p) =>
        p.id === existingNear.id ? { ...p, time: Number(localNorm.toFixed(4)), value: Number(currentVal.toFixed(4)) } : p,
      );
      commitPropPoints(updated, activeProp, false);
      setSelectedKfId(existingNear.id);
      return;
    }
    const created: KeyframePoint = {
      id: uid('kf'),
      time: Number(localNorm.toFixed(4)),
      value: Number(currentVal.toFixed(4)),
      easing: defaultEasing,
    };
    commitPropPoints([...points, created], activeProp, false);
    setSelectedKfId(created.id);
  };

  const handleStepKeyframe = (dir: -1 | 1) => {
    if (!clip || points.length === 0) return;
    let target: KeyframePoint | undefined;
    if (dir < 0) {
      target = [...points].reverse().find((p) => p.time < localNorm - 0.008) || points[0];
    } else {
      target = points.find((p) => p.time > localNorm + 0.008) || points[points.length - 1];
    }
    if (!target) return;
    setSelectedKfId(target.id);
    onPlayheadChange?.(Number((clip.startTime + target.time * dur).toFixed(3)));
  };

  const handleDeleteSelected = () => {
    if (!clip || !selectedPoint) return;
    const next = points.filter((p) => p.id !== selectedPoint.id);
    commitPropPoints(next, activeProp, true);
    setSelectedKfId(next[0]?.id ?? null);
  };

  const handleApplyPreset = (presetId: 'fadeInOut' | 'popZoom' | 'slideLeft' | 'spin360') => {
    if (!clip) return;
    onCommitHistory();
    const nextMap: ClipKeyframesMap = cloneClipKeyframes(clip.keyframes) || {};
    if (presetId === 'fadeInOut') {
      nextMap.opacity = [
        { id: uid('kf'), time: 0, value: 0, easing: 'easeOut' },
        { id: uid('kf'), time: 0.2, value: 1, easing: 'linear' },
        { id: uid('kf'), time: 0.8, value: 1, easing: 'easeIn' },
        { id: uid('kf'), time: 1, value: 0, easing: 'linear' },
      ];
      setActiveProp('opacity');
      setSelectedKfId(nextMap.opacity[0].id);
    } else if (presetId === 'popZoom') {
      nextMap.scale = [
        { id: uid('kf'), time: 0, value: 0.45, easing: 'easeOut' },
        { id: uid('kf'), time: 0.22, value: 1.08, easing: 'easeInOut' },
        { id: uid('kf'), time: 0.4, value: 1.0, easing: 'linear' },
        { id: uid('kf'), time: 1, value: 1.0, easing: 'linear' },
      ];
      setActiveProp('scale');
      setSelectedKfId(nextMap.scale[0].id);
    } else if (presetId === 'slideLeft') {
      nextMap.x = [
        { id: uid('kf'), time: 0, value: -65, easing: 'easeOut' },
        { id: uid('kf'), time: 0.35, value: 0, easing: 'linear' },
        { id: uid('kf'), time: 1, value: 0, easing: 'linear' },
      ];
      nextMap.opacity = [
        { id: uid('kf'), time: 0, value: 0, easing: 'easeOut' },
        { id: uid('kf'), time: 0.25, value: 1, easing: 'linear' },
      ];
      setActiveProp('x');
      setSelectedKfId(nextMap.x[0].id);
    } else if (presetId === 'spin360') {
      nextMap.rotation = [
        { id: uid('kf'), time: 0, value: -180, easing: 'easeInOut' },
        { id: uid('kf'), time: 1, value: 180, easing: 'linear' },
      ];
      setActiveProp('rotation');
      setSelectedKfId(nextMap.rotation[0].id);
    }
    onUpdateClip(clip.id, { keyframes: nextMap });
  };

  const startScrubRuler = (e: React.PointerEvent) => {
    if (!clip || !onPlayheadChange) return;
    e.stopPropagation();
    const updateFromClient = (clientX: number) => {
      const { tNorm } = clientToPlot(clientX, e.clientY);
      onPlayheadChange(Number((clip.startTime + tNorm * dur).toFixed(3)));
    };
    updateFromClient(e.clientX);
    const onMove = (ev: PointerEvent) => updateFromClient(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startDragKeyframe = (e: React.PointerEvent, kf: KeyframePoint) => {
    if (!clip) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedKfId(kf.id);
    onCommitHistory();
    const basePoints = [...points];

    const onMove = (ev: PointerEvent) => {
      const { tNorm, value } = clientToPlot(ev.clientX, ev.clientY);
      // Light magnetic snap to playhead when close
      const finalT = Math.abs(tNorm - localNorm) < 0.015 ? Number(localNorm.toFixed(4)) : tNorm;
      const next = basePoints.map((p) => (p.id === kf.id ? { ...p, time: finalT, value } : p));
      commitPropPoints(next, activeProp, false);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleGraphDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!clip) return;
    const { tNorm, value } = clientToPlot(e.clientX, e.clientY);
    onCommitHistory();
    const created: KeyframePoint = {
      id: uid('kf'),
      time: tNorm,
      value,
      easing: defaultEasing,
    };
    commitPropPoints([...points, created], activeProp, false);
    setSelectedKfId(created.id);
    onPlayheadChange?.(Number((clip.startTime + tNorm * dur).toFixed(3)));
  };

  const curvePathData = useMemo(() => {
    const samples = 96;
    const coords: [number, number][] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const v = evaluateKeyframeTrack(points, t, fallbackVal);
      coords.push([timeToX(t), valToY(v)]);
    }
    const lineD = coords.map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const bottomY = (PAD_T + PLOT_H).toFixed(1);
    const areaD = `${lineD} L ${coords[coords.length - 1][0].toFixed(1)} ${bottomY} L ${coords[0][0].toFixed(1)} ${bottomY} Z`;
    return { lineD, areaD };
  }, [points, fallbackVal, activeProp]);

  const yTicks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const frac = i / steps;
      const val = meta.min + (meta.max - meta.min) * (1 - frac);
      return {
        y: PAD_T + frac * PLOT_H,
        label: `${Math.round(val * meta.displayMultiplier)}${meta.unit}`,
      };
    });
  }, [meta]);

  if (!clip) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 text-center gap-2 bg-slate-50 dark:bg-[#0b0d12]">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
          Add or select a visual clip on the timeline to animate keyframes.
        </p>
        {visualClips.length > 0 && onSelectClip && (
          <button
            type="button"
            onClick={() => onSelectClip(visualClips[0].id)}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
          >
            Target “{visualClips[0].name}”
          </button>
        )}
      </div>
    );
  }

  const playheadX = timeToX(localNorm);
  const currentDotY = valToY(currentVal);
  const displayCurrent = `${Math.round(currentVal * meta.displayMultiplier)}${meta.unit}`;

  return (
    <div className="flex-1 flex flex-col bg-[#0b0d12] min-h-0">
      {/* Top Toolbar: Clip Selector + Property Channels + Presets */}
      <div className="px-3 py-1.5 bg-slate-50 dark:bg-[#12161e] border-b border-slate-200 dark:border-[#232832] flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {visualClips.length > 1 && onSelectClip && (
            <select
              aria-label="Keyframe Target Clip"
              value={clip.id}
              onChange={(e) => {
                setSelectedKfId(null);
                onSelectClip(e.target.value);
              }}
              className="h-6 px-2 rounded bg-white dark:bg-[#0b0e13] border border-slate-300 dark:border-[#2a3140] text-[11px] text-slate-900 dark:text-slate-200 max-w-[140px]"
            >
              {visualClips.map((vc) => (
                <option key={vc.id} value={vc.id}>
                  {vc.name}
                </option>
              ))}
            </select>
          )}

          <div className="inline-flex items-center gap-1">
            {KEYFRAME_PROPERTY_ORDER.map((prop) => {
              const pm = KEYFRAME_PROPERTY_META[prop];
              const count = clip.keyframes?.[prop]?.length ?? 0;
              const val = currentAnimatedProps ? currentAnimatedProps[prop] : clip[prop];
              const active = activeProp === prop;
              return (
                <button
                  key={prop}
                  type="button"
                  onClick={() => {
                    setActiveProp(prop);
                    setSelectedKfId(clip.keyframes?.[prop]?.[0]?.id ?? null);
                  }}
                  className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1.5 border transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-blue-50 dark:bg-[#1c2536] border-blue-500 text-blue-800 dark:text-white'
                      : 'bg-white dark:bg-[#0d1016] border-slate-300 dark:border-[#242b37] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-xs shrink-0"
                    style={{ backgroundColor: pm.color }}
                  />
                  <span>{pm.shortLabel}</span>
                  <span className="font-mono-tabular text-[10px] text-slate-500 dark:text-slate-400">
                    {Math.round(val * pm.displayMultiplier)}
                    {pm.unit}
                  </span>
                  {count > 0 && (
                    <span className="font-mono-tabular text-[10px] text-blue-600 dark:text-blue-300">
                      [{count}]
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick 1-click Animation Presets */}
        <div className="flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-slate-500 dark:text-slate-400" />
          <span className="text-[10px] text-slate-500 dark:text-slate-400 mr-0.5">Presets:</span>
          {(
            [
              ['fadeInOut', 'Fade In/Out'],
              ['popZoom', 'Pop Zoom'],
              ['slideLeft', 'Slide In'],
              ['spin360', 'Spin 360°'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => handleApplyPreset(id)}
              className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 dark:bg-[#161b24] dark:hover:bg-[#1f2633] border border-slate-300 dark:border-[#2a3140] text-[10px] text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main SVG Spline Curve Graph */}
      <div className="flex-1 min-h-[145px] relative select-none px-1 py-1">
        {bypassed && (
          <div className="absolute top-2 right-3 z-10 px-2 py-0.5 rounded bg-amber-950/80 border border-amber-500/50 text-[10px] text-amber-200">
            Keyframes1 bypassed in Node Graph
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
          onDoubleClick={handleGraphDoubleClick}
          className="w-full h-full block cursor-crosshair"
        >
          <defs>
            <linearGradient id={`kfGrad-${activeProp}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={meta.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={meta.color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Clickable Scrub Ruler Bar */}
          <rect
            x={PAD_L}
            y={0}
            width={PLOT_W}
            height={PAD_T}
            fill="#11151d"
            onPointerDown={startScrubRuler}
            className="cursor-ew-resize"
          />
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const tx = timeToX(frac);
            return (
              <g key={frac}>
                <line
                  x1={tx}
                  y1={PAD_T}
                  x2={tx}
                  y2={PAD_T + PLOT_H}
                  stroke="#1f2530"
                  strokeWidth={1}
                />
                <text
                  x={tx}
                  y={SVG_H - 6}
                  textAnchor={frac === 0 ? 'start' : frac === 1 ? 'end' : 'middle'}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="ui-monospace, monospace"
                >
                  {(frac * dur).toFixed(2)}s
                </text>
              </g>
            );
          })}

          {/* Horizontal value grid + Y labels */}
          {yTicks.map((tk, idx) => (
            <g key={idx}>
              <line
                x1={PAD_L}
                y1={tk.y}
                x2={PAD_L + PLOT_W}
                y2={tk.y}
                stroke={idx === 2 ? '#2b3342' : '#1b202a'}
                strokeDasharray={idx === 2 ? '3 3' : undefined}
                strokeWidth={1}
              />
              <text
                x={PAD_L - 6}
                y={tk.y + 3}
                textAnchor="end"
                fill="#7c899e"
                fontSize="9"
                fontFamily="ui-monospace, monospace"
              >
                {tk.label}
              </text>
            </g>
          ))}

          {/* Plot frame border */}
          <rect
            x={PAD_L}
            y={PAD_T}
            width={PLOT_W}
            height={PLOT_H}
            fill="none"
            stroke="#242b38"
            strokeWidth={1}
          />

          {/* Eased Curve Area + Line */}
          <path d={curvePathData.areaD} fill={`url(#kfGrad-${activeProp})`} />
          <path
            d={curvePathData.lineD}
            fill="none"
            stroke={meta.color}
            strokeWidth={2}
            strokeDasharray={points.length === 0 ? '5 4' : undefined}
          />

          {/* Playhead Needle */}
          <line
            x1={playheadX}
            y1={2}
            x2={playheadX}
            y2={PAD_T + PLOT_H}
            stroke="#ef4444"
            strokeWidth={1.5}
            pointerEvents="none"
          />
          <polygon
            points={`${playheadX - 5},2 ${playheadX + 5},2 ${playheadX},11`}
            fill="#ef4444"
            onPointerDown={startScrubRuler}
            className="cursor-ew-resize"
          />
          <circle
            cx={playheadX}
            cy={currentDotY}
            r={3.5}
            fill="#0b0d12"
            stroke="#f8fafc"
            strokeWidth={1.5}
            pointerEvents="none"
          />

          {/* Draggable Keyframe Diamonds */}
          {points.map((kf) => {
            const kx = timeToX(kf.time);
            const ky = valToY(kf.value);
            const isSel = kf.id === selectedPoint?.id;
            const r = isSel ? 6.5 : 5;
            return (
              <g
                key={kf.id}
                onPointerDown={(e) => startDragKeyframe(e, kf)}
                className="cursor-grab active:cursor-grabbing"
              >
                <polygon
                  points={`${kx},${ky - r} ${kx + r},${ky} ${kx},${ky + r} ${kx - r},${ky}`}
                  fill={isSel ? '#ffffff' : meta.color}
                  stroke={isSel ? meta.color : '#0b0d12'}
                  strokeWidth={isSel ? 2 : 1.5}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bottom Keyframe Inspector & Transport Controls */}
      <div className="px-3 py-1.5 bg-slate-50 dark:bg-[#12161e] border-t border-slate-200 dark:border-[#232832] flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleStepKeyframe(-1)}
            disabled={points.length === 0}
            title="Jump to previous keyframe"
            className="p-1 rounded bg-white dark:bg-[#0d1016] border border-slate-300 dark:border-[#262c38] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-35 cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleAddOrUpdateAtPlayhead}
            className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3 h-3" />
            <span>Keyframe @ {localTime.toFixed(2)}s</span>
          </button>
          <button
            type="button"
            onClick={() => handleStepKeyframe(1)}
            disabled={points.length === 0}
            title="Jump to next keyframe"
            className="p-1 rounded bg-white dark:bg-[#0d1016] border border-slate-300 dark:border-[#262c38] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-35 cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <span className="text-slate-500 dark:text-slate-400 font-mono-tabular ml-1">
            {meta.label}: <strong className="text-slate-900 dark:text-slate-100">{displayCurrent}</strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Curve:</span>
            {EASING_LABELS.map((es) => {
              const curEase = selectedPoint ? selectedPoint.easing : defaultEasing;
              return (
                <button
                  key={es.id}
                  type="button"
                  onClick={() => {
                    setDefaultEasing(es.id);
                    if (selectedPoint) {
                      commitPropPoints(
                        points.map((p) => (p.id === selectedPoint.id ? { ...p, easing: es.id } : p)),
                        activeProp,
                        true,
                      );
                    }
                  }}
                  className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                    curEase === es.id
                      ? 'bg-blue-50 dark:bg-[#1c2536] border-blue-500 text-blue-700 dark:text-white'
                      : 'bg-white dark:bg-[#0d1016] border-slate-300 dark:border-[#252b37] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {es.label}
                </button>
              );
            })}
          </div>

          {selectedPoint ? (
            <div className="flex items-center gap-1.5 font-mono-tabular">
              <Diamond className="w-3 h-3 text-blue-500 dark:text-blue-400" />
              <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                <span>t</span>
                <input
                  type="number"
                  min={0}
                  max={Number(dur.toFixed(2))}
                  step={0.05}
                  value={Number((selectedPoint.time * dur).toFixed(2))}
                  onChange={(e) => {
                    const sec = Math.max(0, Math.min(dur, Number(e.target.value) || 0));
                    const record = !numCommittedRef.current;
                    numCommittedRef.current = true;
                    commitPropPoints(
                      points.map((p) =>
                        p.id === selectedPoint.id ? { ...p, time: Number((sec / dur).toFixed(4)) } : p,
                      ),
                      activeProp,
                      record,
                    );
                  }}
                  onBlur={() => {
                    numCommittedRef.current = false;
                  }}
                  className="w-14 h-6 px-1.5 rounded bg-white dark:bg-[#0d1016] border border-slate-300 dark:border-[#2a3140] text-slate-900 dark:text-slate-100 text-[10px]"
                />
                <span>s</span>
              </label>
              <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                <span>val</span>
                <input
                  type="number"
                  min={Math.round(meta.min * meta.displayMultiplier)}
                  max={Math.round(meta.max * meta.displayMultiplier)}
                  step={Math.max(1, meta.step * meta.displayMultiplier)}
                  value={Math.round(selectedPoint.value * meta.displayMultiplier)}
                  onChange={(e) => {
                    const rawDisp = Number(e.target.value);
                    if (!Number.isFinite(rawDisp)) return;
                    const clamped = Math.max(
                      meta.min,
                      Math.min(meta.max, rawDisp / meta.displayMultiplier),
                    );
                    const record = !numCommittedRef.current;
                    numCommittedRef.current = true;
                    commitPropPoints(
                      points.map((p) =>
                        p.id === selectedPoint.id ? { ...p, value: Number(clamped.toFixed(4)) } : p,
                      ),
                      activeProp,
                      record,
                    );
                  }}
                  onBlur={() => {
                    numCommittedRef.current = false;
                  }}
                  className="w-14 h-6 px-1.5 rounded bg-white dark:bg-[#0d1016] border border-slate-300 dark:border-[#2a3140] text-slate-900 dark:text-slate-100 text-[10px]"
                />
                <span>{meta.unit}</span>
              </label>
              <button
                type="button"
                onClick={handleDeleteSelected}
                title="Delete selected keyframe"
                className="p-1 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/50 dark:hover:bg-red-900/60 border border-red-300 dark:border-red-800/60 text-red-600 dark:text-red-300 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <span className="text-[10px] text-slate-500">
              Double-click graph to add keyframe · Drag diamonds to curve
            </span>
          )}

          {points.length > 0 && (
            <button
              type="button"
              onClick={() => {
                commitPropPoints([], activeProp, true);
                setSelectedKfId(null);
              }}
              className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 dark:bg-[#0d1016] dark:hover:bg-[#1a1f29] border border-slate-300 dark:border-[#262c38] text-[10px] text-slate-700 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Clear {meta.shortLabel}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
