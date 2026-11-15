import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Crosshair,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Sliders,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_FUSION_VFX,
  FusionVfxSpec,
  KrokodoveEffectId,
  MediaAsset,
  ParticlePresetId,
  RotoscopePoint,
  TimelineClip,
} from '../types/editor';
import { countClipKeyframes, evaluateAnimatedClipProps } from '../utils/timelineMath';
import { KeyframeGraphEditor } from './KeyframeGraphEditor';

interface FusionVfxStudioProps {
  selectedClip: TimelineClip | null;
  selectedClipAsset: MediaAsset | null;
  clips?: TimelineClip[];
  assetsMap?: Map<string, MediaAsset>;
  playhead: number;
  onPlayheadChange?: (t: number) => void;
  onSelectClip?: (id: string) => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onCommitHistory: () => void;
  onInsertBakedOverlay: (pngDataUrl: string, label: string, duration: number) => void;
}

type FusionNodeId =
  | 'MediaIn'
  | 'Rotoscope'
  | 'PlanarTracker'
  | 'Particles3D'
  | 'KrokodoveFX'
  | 'GlowTransform'
  | 'Keyframes'
  | 'MediaOut';

interface FusionGraphNode {
  id: FusionNodeId;
  label: string;
  subtitle: string;
  x: number;
  y: number;
  bypassed: boolean;
}

const INITIAL_NODES: FusionGraphNode[] = [
  { id: 'MediaIn', label: 'MediaIn1', subtitle: 'Source Plate', x: 20, y: 70, bypassed: false },
  { id: 'Rotoscope', label: 'PolygonMask1', subtitle: 'Bézier Matte', x: 150, y: 24, bypassed: false },
  { id: 'PlanarTracker', label: 'Tracker1', subtitle: 'Point Track', x: 150, y: 118, bypassed: false },
  { id: 'Particles3D', label: 'pEmitter3D1', subtitle: '3D Particle Sim', x: 285, y: 24, bypassed: false },
  { id: 'KrokodoveFX', label: 'Krokodove1', subtitle: 'Motion Vector GFX', x: 285, y: 118, bypassed: false },
  { id: 'GlowTransform', label: 'SoftGlow1', subtitle: 'Optical Bloom', x: 420, y: 70, bypassed: false },
  { id: 'Keyframes', label: 'Keyframes1', subtitle: 'Spline Anim', x: 550, y: 70, bypassed: false },
  { id: 'MediaOut', label: 'MediaOut1', subtitle: 'Composite Out', x: 680, y: 70, bypassed: false },
];

const GRAPH_EDGES: [FusionNodeId, FusionNodeId][] = [
  ['MediaIn', 'Rotoscope'],
  ['MediaIn', 'PlanarTracker'],
  ['Rotoscope', 'Particles3D'],
  ['PlanarTracker', 'KrokodoveFX'],
  ['Particles3D', 'GlowTransform'],
  ['KrokodoveFX', 'GlowTransform'],
  ['GlowTransform', 'Keyframes'],
  ['Keyframes', 'MediaOut'],
];

interface Particle3D {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  seed: number;
}

export const FusionVfxStudio: React.FC<FusionVfxStudioProps> = ({
  selectedClip,
  selectedClipAsset,
  clips = [],
  assetsMap,
  playhead,
  onPlayheadChange,
  onSelectClip,
  onUpdateClip,
  onCommitHistory,
  onInsertBakedOverlay,
}) => {
  const [nodes, setNodes] = useState<FusionGraphNode[]>(INITIAL_NODES);
  const [selectedNodeId, setSelectedNodeId] = useState<FusionNodeId>('Keyframes');
  const [lowerDockTab, setLowerDockTab] = useState<'keyframes' | 'nodes'>('keyframes');

  const visualClips = useMemo(
    () => clips.filter((c) => c.kind !== 'audio'),
    [clips],
  );
  const targetClip = useMemo(() => {
    if (selectedClip && selectedClip.kind !== 'audio') return selectedClip;
    const atPlayhead = visualClips.find(
      (c) => playhead >= c.startTime && playhead <= c.startTime + c.duration,
    );
    return atPlayhead || visualClips[0] || null;
  }, [selectedClip, visualClips, playhead]);

  const targetClipAsset = useMemo(() => {
    if (selectedClip && targetClip?.id === selectedClip.id && selectedClipAsset) {
      return selectedClipAsset;
    }
    if (targetClip?.mediaId && assetsMap) {
      return assetsMap.get(targetClip.mediaId) || null;
    }
    return null;
  }, [selectedClip, selectedClipAsset, targetClip, assetsMap]);

  const [localSpec, setLocalSpec] = useState<FusionVfxSpec>(
    targetClip?.fusion
      ? { ...targetClip.fusion }
      : { ...DEFAULT_FUSION_VFX, enabled: true, particlePreset: 'embers', krokodoveEffect: 'hud_rings' },
  );
  const [simPlaying, setSimPlaying] = useState<boolean>(true);
  const [cameraYaw, setCameraYaw] = useState<number>(12);
  const [cameraPitch, setCameraPitch] = useState<number>(6);
  const [trackAnchor, setTrackAnchor] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.45 });
  const [trackResults, setTrackResults] = useState<{ frame: number; dx: number; dy: number; conf: number }[]>([]);
  const [viewportMode, setViewportMode] = useState<'composite' | 'roto' | 'tracker'>('composite');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const particlesRef = useRef<Particle3D[]>([]);
  const timeRef = useRef<number>(0);

  // Sync inspector with newly selected clip's Fusion settings
  useEffect(() => {
    if (targetClip?.fusion) {
      setLocalSpec({ ...targetClip.fusion });
    }
  }, [targetClip?.id]);

  // Load clip image plate for interactive rotoscope & tracker preview
  useEffect(() => {
    if (!targetClipAsset?.thumbUrl && !targetClipAsset?.fileUrl) {
      bgImgRef.current = null;
      return;
    }
    const url = targetClipAsset.thumbUrl || targetClipAsset.fileUrl;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      bgImgRef.current = img;
    };
    img.src = url;
  }, [targetClipAsset?.id, targetClipAsset?.thumbUrl, targetClipAsset?.fileUrl]);

  const effectiveSpec = useMemo(() => {
    const bypassedSet = new Set(nodes.filter((n) => n.bypassed).map((n) => n.id));
    return {
      ...localSpec,
      particlePreset: bypassedSet.has('Particles3D') ? 'none' : localSpec.particlePreset,
      krokodoveEffect: bypassedSet.has('KrokodoveFX') ? 'none' : localSpec.krokodoveEffect,
      rotoscopeEnabled: bypassedSet.has('Rotoscope') ? false : localSpec.rotoscopeEnabled,
      glowAmount: bypassedSet.has('GlowTransform') ? 0 : localSpec.glowAmount,
      keyframesBypassed: bypassedSet.has('Keyframes'),
    };
  }, [localSpec, nodes]);

  const patchSpec = (patch: Partial<FusionVfxSpec>) => {
    const next = { ...localSpec, ...patch, enabled: true };
    setLocalSpec(next);
    if (targetClip) {
      onUpdateClip(targetClip.id, { fusion: next });
    }
  };

  // Seed / resize 3D particle pool
  useEffect(() => {
    const count = Math.max(12, Math.min(140, effectiveSpec.particleDensity));
    const arr: Particle3D[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 2.2,
        y: (Math.random() - 0.5) * 2.0,
        z: Math.random() * 2.4 + 0.3,
        vx: (Math.random() - 0.5) * 0.25,
        vy:
          effectiveSpec.particlePreset === 'embers'
            ? -0.25 - Math.random() * 0.45
            : effectiveSpec.particlePreset === 'snow'
              ? 0.2 + Math.random() * 0.3
              : (Math.random() - 0.5) * 0.4,
        vz: (Math.random() - 0.5) * 0.2,
        size: 1.5 + Math.random() * 4.2,
        seed: Math.random() * Math.PI * 2,
      });
    }
    particlesRef.current = arr;
  }, [effectiveSpec.particleDensity, effectiveSpec.particlePreset]);

  // Live Fusion Render Loop (Plate + Rotoscope + 3D Particles + Krokodove + Glow)
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.06, (now - last) / 1000);
      last = now;
      if (simPlaying) timeRef.current += dt;
      const t = timeRef.current + playhead * 0.3;

      const cvs = canvasRef.current;
      if (cvs) {
        const ctx = cvs.getContext('2d');
        if (ctx) {
          const w = cvs.width;
          const h = cvs.height;
          ctx.clearRect(0, 0, w, h);

          // Studio checkerboard backing when masked/transparent
          ctx.fillStyle = '#090b10';
          ctx.fillRect(0, 0, w, h);

          ctx.save();
          // Apply Rotoscope clip mask if enabled and polygon has >= 3 vertices
          const pts = effectiveSpec.rotoscopePoints;
          if (effectiveSpec.rotoscopeEnabled && pts.length >= 3) {
            ctx.beginPath();
            pts.forEach((p, idx) => {
              if (idx === 0) ctx.moveTo(p.x * w, p.y * h);
              else ctx.lineTo(p.x * w, p.y * h);
            });
            ctx.closePath();
            if (effectiveSpec.rotoscopeInvert) {
              ctx.rect(w, 0, -w, h);
              ctx.clip('evenodd');
            } else {
              ctx.clip();
            }
          }

          // Background plate image or dark cinema test grid with live Keyframe transform animation
          const plate = bgImgRef.current;
          const offPxX = (effectiveSpec.trackOffsetX / 100) * w;
          const offPxY = (effectiveSpec.trackOffsetY / 100) * h;

          const clipProg = targetClip
            ? Math.max(0, Math.min(1, (playhead - targetClip.startTime) / Math.max(0.1, targetClip.duration)))
            : 0;
          const anim =
            targetClip && !effectiveSpec.keyframesBypassed
              ? evaluateAnimatedClipProps(targetClip, clipProg)
              : {
                  opacity: targetClip?.opacity ?? 1,
                  scale: targetClip?.scale ?? 1,
                  x: targetClip?.x ?? 0,
                  y: targetClip?.y ?? 0,
                  rotation: targetClip?.rotation ?? 0,
                };

          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, anim.opacity));
          ctx.translate(w / 2 + (anim.x / 100) * w + offPxX, h / 2 + (anim.y / 100) * h + offPxY);
          if (Math.abs(anim.rotation) > 0.05) {
            ctx.rotate((anim.rotation * Math.PI) / 180);
          }
          const animScaleX = Math.max(0.08, anim.scale * (targetClip?.scaleX ?? 1));
          const animScaleY = Math.max(0.08, anim.scale * (targetClip?.scaleY ?? 1));
          ctx.scale(animScaleX, animScaleY);

          if (plate && plate.naturalWidth > 0) {
            if (effectiveSpec.glowAmount > 0.02) {
              ctx.filter = `brightness(${100 + Math.round(effectiveSpec.glowAmount * 18)}%) contrast(${100 + Math.round(effectiveSpec.glowAmount * 14)}%)`;
            }
            const scale = Math.max(w / plate.naturalWidth, h / plate.naturalHeight);
            const dw = plate.naturalWidth * scale;
            const dh = plate.naturalHeight * scale;
            ctx.drawImage(plate, -dw / 2, -dh / 2, dw, dh);
          } else {
            ctx.strokeStyle = 'rgba(148,163,184,0.16)';
            ctx.lineWidth = 1;
            for (let gx = -w / 2; gx <= w / 2; gx += 40) {
              ctx.beginPath();
              ctx.moveTo(gx, -h / 2);
              ctx.lineTo(gx, h / 2);
              ctx.stroke();
            }
            for (let gy = -h / 2; gy <= h / 2; gy += 40) {
              ctx.beginPath();
              ctx.moveTo(-w / 2, gy);
              ctx.lineTo(w / 2, gy);
              ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(96,165,250,0.45)';
            ctx.strokeRect(-w * 0.28, -h * 0.28, w * 0.56, h * 0.56);
          }
          ctx.restore();
          ctx.restore();

          // Draw Rotoscope polygon overlay handles in Roto mode
          if (viewportMode === 'roto' && pts.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            pts.forEach((p, idx) => {
              if (idx === 0) ctx.moveTo(p.x * w, p.y * h);
              else ctx.lineTo(p.x * w, p.y * h);
            });
            if (pts.length >= 3) ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
            pts.forEach((p) => {
              ctx.fillStyle = '#fbbf24';
              ctx.beginPath();
              ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
              ctx.fill();
            });
            ctx.restore();
          }

          // Krokodove Motion Graphics procedural engine
          if (effectiveSpec.krokodoveEffect !== 'none') {
            drawKrokodoveOverlay(ctx, w, h, t, effectiveSpec.krokodoveEffect, effectiveSpec.krokodoveIntensity, effectiveSpec.particleColor);
          }

          // 3D Particle System projection (yaw + pitch camera matrix)
          if (effectiveSpec.particlePreset !== 'none') {
            const yawRad = (cameraYaw * Math.PI) / 180;
            const pitchRad = (cameraPitch * Math.PI) / 180;
            const cosY = Math.cos(yawRad);
            const sinY = Math.sin(yawRad);
            const cosP = Math.cos(pitchRad);
            const sinP = Math.sin(pitchRad);

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            for (const p of particlesRef.current) {
              if (simPlaying) {
                p.x += p.vx * dt + Math.sin(t * 1.5 + p.seed) * 0.08 * dt;
                p.y += p.vy * dt;
                p.z += p.vz * dt;
                if (p.y < -1.1) p.y = 1.1;
                if (p.y > 1.1) p.y = -1.1;
                if (p.x < -1.2) p.x = 1.2;
                if (p.x > 1.2) p.x = -1.2;
                if (p.z < 0.25) p.z = 2.6;
                if (p.z > 2.6) p.z = 0.3;
              }
              const rx = p.x * cosY - (p.z - 1.3) * sinY;
              const rz0 = p.x * sinY + (p.z - 1.3) * cosY;
              const ry = p.y * cosP - rz0 * sinP;
              const rz = p.y * sinP + rz0 * cosP + 1.45;
              if (rz <= 0.1) continue;
              const fov = 1.25 / rz;
              const sx = w * 0.5 + rx * fov * (w * 0.48) + offPxX;
              const sy = h * 0.5 + ry * fov * (h * 0.48) + offPxY;
              const radius = Math.max(0.9, p.size * fov * 1.35);

              ctx.fillStyle = effectiveSpec.particleColor;
              ctx.globalAlpha = Math.max(0.15, Math.min(0.95, 1.3 - rz * 0.35));
              ctx.beginPath();
              if (effectiveSpec.particlePreset === 'sparks') {
                ctx.ellipse(sx, sy, radius * 2.2, Math.max(1, radius * 0.55), Math.atan2(p.vy, p.vx), 0, Math.PI * 2);
              } else {
                ctx.arc(sx, sy, radius, 0, Math.PI * 2);
              }
              ctx.fill();
            }
            ctx.restore();
          }

          // Camera Tracker Reticle in Tracker Mode
          if (viewportMode === 'tracker') {
            const tx = trackAnchor.x * w;
            const ty = trackAnchor.y * h;
            ctx.save();
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(tx - 18, ty - 18, 36, 36);
            ctx.beginPath();
            ctx.moveTo(tx - 26, ty);
            ctx.lineTo(tx + 26, ty);
            ctx.moveTo(tx, ty - 26);
            ctx.lineTo(tx, ty + 26);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [effectiveSpec, simPlaying, playhead, cameraYaw, cameraPitch, viewportMode, trackAnchor, targetClip]);

  const toggleNodeBypass = (id: FusionNodeId) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, bypassed: !n.bypassed } : n)));
  };

  const handleViewportClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = Number(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)).toFixed(4));
    const ny = Number(Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)).toFixed(4));

    if (viewportMode === 'roto') {
      const nextPts: RotoscopePoint[] = [...localSpec.rotoscopePoints, { x: nx, y: ny }];
      patchSpec({ rotoscopeEnabled: true, rotoscopePoints: nextPts });
    } else if (viewportMode === 'tracker') {
      setTrackAnchor({ x: nx, y: ny });
    }
  };

  const handleRunCameraTrack = () => {
    // Sample real luminance centroid from current canvas region around anchor + generate smooth solve curve
    const cvs = canvasRef.current;
    let baseShiftX = 0;
    let baseShiftY = 0;
    if (cvs) {
      const ctx = cvs.getContext('2d');
      if (ctx) {
        const ax = Math.max(16, Math.min(cvs.width - 17, Math.round(trackAnchor.x * cvs.width)));
        const ay = Math.max(16, Math.min(cvs.height - 17, Math.round(trackAnchor.y * cvs.height)));
        const data = ctx.getImageData(ax - 16, ay - 16, 32, 32).data;
        let wx = 0;
        let wy = 0;
        let sumW = 0;
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const idx = (y * 32 + x) * 4;
            const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
            wx += (x - 15.5) * lum;
            wy += (y - 15.5) * lum;
            sumW += lum;
          }
        }
        if (sumW > 1) {
          baseShiftX = (wx / sumW) * 0.35;
          baseShiftY = (wy / sumW) * 0.35;
        }
      }
    }

    const frames = Array.from({ length: 8 }, (_, idx) => {
      const dx = Number((baseShiftX + (idx - 3) * 0.65).toFixed(2));
      const dy = Number((baseShiftY + Math.sin(idx * 0.6) * 0.9).toFixed(2));
      return { frame: idx * 5, dx, dy, conf: Number((0.98 - idx * 0.015).toFixed(2)) };
    });
    setTrackResults(frames);
    const avgDx = Number((frames.reduce((s, f) => s + f.dx, 0) / frames.length).toFixed(2));
    const avgDy = Number((frames.reduce((s, f) => s + f.dy, 0) / frames.length).toFixed(2));
    patchSpec({ trackOffsetX: avgDx, trackOffsetY: avgDy });
  };

  const handleBakeOverlay = () => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    // Render a crisp transparent VFX overlay pass (particles + Krokodove) so it composites cleanly on any track
    const out = document.createElement('canvas');
    out.width = 1280;
    out.height = 720;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    if (effectiveSpec.krokodoveEffect !== 'none') {
      drawKrokodoveOverlay(
        ctx,
        out.width,
        out.height,
        timeRef.current,
        effectiveSpec.krokodoveEffect,
        effectiveSpec.krokodoveIntensity,
        effectiveSpec.particleColor,
      );
    }
    if (effectiveSpec.particlePreset !== 'none') {
      for (const p of particlesRef.current) {
        const sx = out.width * 0.5 + p.x * out.width * 0.42;
        const sy = out.height * 0.5 + p.y * out.height * 0.42;
        ctx.fillStyle = effectiveSpec.particleColor;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(2, p.size * 1.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    onInsertBakedOverlay(
      out.toDataURL('image/png'),
      `Fusion FX (${effectiveSpec.krokodoveEffect !== 'none' ? effectiveSpec.krokodoveEffect : effectiveSpec.particlePreset})`,
      4.0,
    );
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[0];
  const totalKeyframes = countClipKeyframes(targetClip);

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-3 min-h-[460px]">
      {/* Left + Center: Live Fusion Viewport + Keyframe Graph / Node Flow Dock */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {/* Top Interactive Canvas Viewport */}
        <div className="flex-1 min-h-[210px] bg-[#14171d] border border-[#232832] rounded-lg overflow-hidden flex flex-col">
          <div className="px-3.5 py-2 border-b border-[#232832] bg-[#171b22] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-semibold text-slate-100">
                Fusion VFX & Keyframe Animation
              </span>
              <span className="text-[11px] text-slate-400 truncate max-w-[200px]">
                {targetClip ? `· ${targetClip.name}` : '· Procedural Composition'}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'composite', label: 'Composite View', icon: Layers },
                  { id: 'roto', label: 'Rotoscope Spline', icon: Scissors },
                  { id: 'tracker', label: 'Camera Tracker', icon: Crosshair },
                ] as const
              ).map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setViewportMode(m.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
                      viewportMode === m.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-[#101318] border border-[#262c38] text-slate-300 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSimPlaying((p) => !p)}
                className="ml-1 px-2.5 py-1 rounded bg-[#1d222b] hover:bg-[#272e3b] border border-[#2c3442] text-[11px] text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                {simPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{simPlaying ? 'Pause' : 'Play'}</span>
              </button>
            </div>
          </div>

          <div className="flex-1 bg-[#080a0e] flex items-center justify-center p-2 relative overflow-hidden">
            <canvas
              ref={canvasRef}
              width={640}
              height={360}
              onClick={handleViewportClick}
              className="max-w-full max-h-[250px] aspect-video rounded border border-[#232832] cursor-crosshair"
            />
            {viewportMode === 'roto' && (
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded bg-black/75 border border-amber-500/40 text-[10px] text-amber-200 pointer-events-none">
                Click canvas to place Bézier Rotoscope points ({localSpec.rotoscopePoints.length} vertices)
              </span>
            )}
            {viewportMode === 'tracker' && (
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded bg-black/75 border border-sky-500/40 text-[10px] text-sky-200 pointer-events-none">
                Click anchor point on plate, then run Track Forward in the inspector
              </span>
            )}
          </div>
        </div>

        {/* Bottom Dock: Keyframe Graph Editor | Node Flow Graph */}
        <div className="h-[268px] bg-[#14171d] border border-[#232832] rounded-lg overflow-hidden flex flex-col">
          <div className="px-3 py-1.5 border-b border-[#232832] bg-[#171b22] flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => setLowerDockTab('keyframes')}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  lowerDockTab === 'keyframes'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#101318] border border-[#262c38] text-slate-300 hover:text-white'
                }`}
              >
                <Activity className="w-3 h-3" />
                <span>Keyframe Graph Editor</span>
                {totalKeyframes > 0 && (
                  <span className="font-mono-tabular text-[10px] opacity-85">({totalKeyframes})</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setLowerDockTab('nodes')}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  lowerDockTab === 'nodes'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#101318] border border-[#262c38] text-slate-300 hover:text-white'
                }`}
              >
                Node Flow Graph ({nodes.filter((n) => !n.bypassed).length}/{nodes.length})
              </button>
            </div>

            {lowerDockTab === 'nodes' ? (
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <span>Click node to inspect · Toggle ON/OFF to bypass</span>
                <button
                  type="button"
                  onClick={() => setNodes(INITIAL_NODES)}
                  className="px-2 py-0.5 rounded bg-[#101318] border border-[#262c38] text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>Reset Graph</span>
                </button>
              </div>
            ) : (
              <span className="text-[10px] text-slate-400 font-mono-tabular">
                Animate Opacity · Scale · Position · Rotation over time
              </span>
            )}
          </div>

          {lowerDockTab === 'keyframes' ? (
            <KeyframeGraphEditor
              clip={targetClip}
              visualClips={visualClips}
              playhead={playhead}
              bypassed={effectiveSpec.keyframesBypassed}
              onSelectClip={onSelectClip}
              onPlayheadChange={onPlayheadChange}
              onUpdateClip={onUpdateClip}
              onCommitHistory={onCommitHistory}
            />
          ) : (
            <div className="flex-1 overflow-auto bg-[#0b0d12] relative p-2">
              <div className="relative min-w-[810px] h-[180px]">
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  {GRAPH_EDGES.map(([fromId, toId]) => {
                    const a = nodes.find((n) => n.id === fromId);
                    const b = nodes.find((n) => n.id === toId);
                    if (!a || !b) return null;
                    const x1 = a.x + 110;
                    const y1 = a.y + 20;
                    const x2 = b.x;
                    const y2 = b.y + 20;
                    const mx = (x1 + x2) / 2;
                    const active = !a.bypassed && !b.bypassed;
                    return (
                      <path
                        key={`${fromId}-${toId}`}
                        d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke={active ? '#3b82f6' : '#334155'}
                        strokeWidth={active ? 2 : 1.5}
                        strokeDasharray={active ? undefined : '4 4'}
                      />
                    );
                  })}
                </svg>
                {nodes.map((node) => {
                  const isSel = selectedNodeId === node.id;
                  return (
                    <div
                      key={node.id}
                      onClick={() => {
                        setSelectedNodeId(node.id);
                        if (node.id === 'Keyframes') setLowerDockTab('keyframes');
                      }}
                      style={{ left: `${node.x}px`, top: `${node.y}px`, width: '110px' }}
                      className={`absolute rounded border px-2 py-1.5 cursor-pointer transition-colors ${
                        node.bypassed
                          ? 'bg-[#12151c] border-[#262b36] opacity-55'
                          : isSel
                            ? 'bg-[#1b273c] border-blue-400'
                            : 'bg-[#161b24] border-[#2c3444] hover:border-slate-500'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-semibold text-slate-100 truncate">
                          {node.label}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleNodeBypass(node.id);
                          }}
                          title={node.bypassed ? 'Enable node' : 'Bypass node'}
                          className={`px-1 rounded text-[8px] font-mono-tabular border cursor-pointer ${
                            node.bypassed
                              ? 'border-slate-600 text-slate-400'
                              : 'border-emerald-500/60 text-emerald-300 bg-emerald-500/10'
                          }`}
                        >
                          {node.bypassed ? 'OFF' : 'ON'}
                        </button>
                      </div>
                      <p className="text-[9px] text-slate-400 truncate mt-0.5">{node.subtitle}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Selected Node Parameter Inspector */}
      <aside className="w-full lg:w-[300px] shrink-0 bg-[#14171d] border border-[#232832] rounded-lg flex flex-col overflow-hidden text-xs">
        <div className="px-3.5 py-2 border-b border-[#232832] bg-[#171b22] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-semibold text-slate-100">{selectedNode.label}</span>
          </div>
          <span className="text-[10px] text-slate-400">{selectedNode.subtitle}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
          {/* 3D Particle System Controls */}
          <section className="space-y-2 pb-3 border-b border-[#232832]">
            <p className="text-[11px] font-semibold text-slate-200">3D Particle System (pEmitter3D)</p>
            <div className="grid grid-cols-5 gap-1">
              {(
                [
                  ['none', 'Off'],
                  ['embers', 'Ember'],
                  ['snow', 'Snow'],
                  ['stardust', 'Dust'],
                  ['sparks', 'Sparks'],
                ] as [ParticlePresetId, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => patchSpec({ particlePreset: id })}
                  className={`py-1 rounded text-[10px] font-medium border cursor-pointer ${
                    localSpec.particlePreset === id
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-[#0e1116] border-[#252b37] text-slate-300 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>Particle Density ({localSpec.particleDensity})</span>
              <input
                type="range"
                min={10}
                max={120}
                step={5}
                value={localSpec.particleDensity}
                onChange={(e) => patchSpec({ particleDensity: Number(e.target.value) })}
                className="studio-slider w-28"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[10px] text-slate-400">
                <span>Camera Yaw ({cameraYaw}°)</span>
                <input
                  type="range"
                  min={-45}
                  max={45}
                  value={cameraYaw}
                  onChange={(e) => setCameraYaw(Number(e.target.value))}
                  className="studio-slider w-full"
                />
              </label>
              <label className="space-y-1 text-[10px] text-slate-400">
                <span>Camera Pitch ({cameraPitch}°)</span>
                <input
                  type="range"
                  min={-35}
                  max={35}
                  value={cameraPitch}
                  onChange={(e) => setCameraPitch(Number(e.target.value))}
                  className="studio-slider w-full"
                />
              </label>
            </div>
            <label className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Emitter Tint</span>
              <input
                type="color"
                value={localSpec.particleColor}
                onChange={(e) => patchSpec({ particleColor: e.target.value })}
                className="w-8 h-6 rounded bg-transparent border border-[#2d3544] cursor-pointer"
              />
            </label>
          </section>

          {/* Krokodove Motion Graphic Toolset */}
          <section className="space-y-2 pb-3 border-b border-[#232832]">
            <p className="text-[11px] font-semibold text-slate-200">Krokodove Motion Graphic Toolset</p>
            <select
              value={localSpec.krokodoveEffect}
              onChange={(e) => patchSpec({ krokodoveEffect: e.target.value as KrokodoveEffectId })}
              className="w-full h-8 px-2 rounded bg-[#0e1116] border border-[#2a303d] text-slate-100 text-[11px]"
            >
              <option value="none">None (Bypass Krokodove)</option>
              <option value="hud_rings">Krokodove · Telemetry HUD Rings</option>
              <option value="kaleido_array">Krokodove · Shape Array Radial</option>
              <option value="glitch_slice">Krokodove · Vector Glitch Slice</option>
              <option value="extrude_grid">Krokodove · 3D Extruded Perspective Grid</option>
            </select>
            <label className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>Intensity ({Math.round(localSpec.krokodoveIntensity * 100)}%)</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={localSpec.krokodoveIntensity}
                onChange={(e) => patchSpec({ krokodoveIntensity: Number(e.target.value) })}
                className="studio-slider w-28"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>Optical Glow ({Math.round(localSpec.glowAmount * 100)}%)</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={localSpec.glowAmount}
                onChange={(e) => patchSpec({ glowAmount: Number(e.target.value) })}
                className="studio-slider w-28"
              />
            </label>
          </section>

          {/* Rotoscoping Spline Matte */}
          <section className="space-y-2 pb-3 border-b border-[#232832]">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-200">Rotoscoping Matte</p>
              <button
                type="button"
                onClick={() => setViewportMode('roto')}
                className="text-[10px] text-amber-300 hover:text-amber-200 cursor-pointer"
              >
                Edit Points on View
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSpec.rotoscopeEnabled}
                  onChange={(e) => patchSpec({ rotoscopeEnabled: e.target.checked })}
                />
                <span>Enable Matte</span>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSpec.rotoscopeInvert}
                  onChange={(e) => patchSpec({ rotoscopeInvert: e.target.checked })}
                />
                <span>Invert</span>
              </label>
              {localSpec.rotoscopePoints.length > 0 && (
                <button
                  type="button"
                  onClick={() => patchSpec({ rotoscopePoints: [], rotoscopeEnabled: false })}
                  className="ml-auto text-[10px] text-red-400 hover:text-red-300 flex items-center gap-0.5 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </section>

          {/* Camera & Point Tracker */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-200">Planar / Point Tracker</p>
              <button
                type="button"
                onClick={() => {
                  setViewportMode('tracker');
                  handleRunCameraTrack();
                }}
                className="px-2 py-1 rounded bg-sky-600/20 border border-sky-500/60 text-[10px] font-medium text-sky-200 hover:bg-sky-600/35 flex items-center gap-1 cursor-pointer"
              >
                <Target className="w-3 h-3" />
                <span>Track Forward</span>
              </button>
            </div>
            {trackResults.length > 0 && (
              <div className="bg-[#0d1016] border border-[#232832] rounded p-2 space-y-1 font-mono-tabular text-[10px]">
                <div className="flex justify-between text-slate-400">
                  <span>Solve Offset</span>
                  <span className="text-sky-300">
                    dx {localSpec.trackOffsetX}% · dy {localSpec.trackOffsetY}%
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1 text-[9px] text-slate-500">
                  {trackResults.slice(0, 4).map((r) => (
                    <span key={r.frame}>
                      f{r.frame}:{r.dx},{r.dy}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Apply / Bake Actions */}
        <div className="p-3 border-t border-[#232832] bg-[#11141a] space-y-1.5 shrink-0">
          {targetClip && (
            <button
              type="button"
              onClick={() => {
                onCommitHistory();
                onUpdateClip(targetClip.id, { fusion: { ...localSpec, enabled: true } });
              }}
              className="w-full py-1.5 px-3 rounded bg-[#1d222b] hover:bg-[#262d39] border border-[#2c3442] text-slate-100 text-[11px] font-medium cursor-pointer truncate"
            >
              Lock VFX to “{targetClip.name}”
            </button>
          )}
          <button
            type="button"
            onClick={handleBakeOverlay}
            className="w-full py-1.5 px-3 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Bake MotionFX Layer to Timeline</span>
          </button>
        </div>
      </aside>
    </div>
  );
};

export function drawKrokodoveOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  mode: KrokodoveEffectId,
  intensity: number,
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = Math.max(0.15, Math.min(0.95, intensity * 0.85));

  if (mode === 'hud_rings') {
    const cx = w / 2;
    const cy = h / 2;
    const rBase = Math.min(w, h) * 0.28;
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * (i % 2 === 0 ? 0.55 : -0.4) + i * 0.9);
      ctx.lineWidth = 2 - i * 0.4;
      ctx.setLineDash([18 + i * 10, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, rBase + i * 24, 0, Math.PI * 1.45);
      ctx.stroke();
      ctx.restore();
    }
  } else if (mode === 'kaleido_array') {
    const cx = w / 2;
    const cy = h / 2;
    const spokes = 10;
    const orbit = Math.min(w, h) * 0.25;
    for (let i = 0; i < spokes; i++) {
      const ang = (i / spokes) * Math.PI * 2 + t * 0.65;
      const sx = cx + Math.cos(ang) * orbit;
      const sy = cy + Math.sin(ang) * orbit;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx - 12, sy - 12, 24, 24);
    }
  } else if (mode === 'glitch_slice') {
    for (let i = 0; i < 9; i++) {
      const y = ((i * 73 + Math.floor(t * 140)) % Math.max(20, h - 14));
      const bw = ((i * 97 + 120) % Math.round(w * 0.45)) + 30;
      const bx = (Math.sin(t * 9 + i) * 0.5 + 0.5) * (w - bw);
      ctx.fillRect(bx, y, bw, 3);
    }
  } else if (mode === 'extrude_grid') {
    const horizon = h * 0.48;
    ctx.lineWidth = 1.2;
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + i * 24, horizon);
      ctx.lineTo(w / 2 + i * 130, h);
      ctx.stroke();
    }
    for (let row = 0; row < 6; row++) {
      const prog = ((row / 6 + t * 0.35) % 1);
      const y = horizon + Math.pow(prog, 1.8) * (h - horizon);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }
  ctx.restore();
}
