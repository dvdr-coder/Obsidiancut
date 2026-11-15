import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  FolderKanban,
  Layers,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react';
import {
  MediaAsset,
  NestedSequence,
  PowerBin,
  SmartBinRule,
  TimelineClip,
  TimelineTrack,
  TrimMode,
} from '../types/editor';
import { formatFrameTimecode, uid } from '../utils/timelineMath';

interface MultiMasterEditStudioProps {
  assets: MediaAsset[];
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  selectedClip: TimelineClip | null;
  playhead: number;
  fps: number;
  trimMode: TrimMode;
  markIn: number | null;
  markOut: number | null;
  nestedSequences: NestedSequence[];
  onSetTrimMode: (mode: TrimMode) => void;
  onNudgeTrim: (clipAId: string, clipBId: string | null, deltaFrames: number) => void;
  onSetMarkIn: (t: number | null) => void;
  onSetMarkOut: (t: number | null) => void;
  onExtractInOutRange: () => void;
  onCreateNestedSequence: (name: string) => void;
  onLoadNestedSequence: (seqId: string) => void;
  onDeleteNestedSequence: (seqId: string) => void;
  onAddVisualToTimeline: (asset: MediaAsset, asOverlay?: boolean) => void;
  onSwitchMulticamAngle: (asset: MediaAsset, camNumber: number) => void;
}

const POWER_BINS_STORAGE_KEY = 'obsidiancut_power_bins_v1';

const DEFAULT_SMART_BINS: SmartBinRule[] = [
  { id: 'sb_vfr', name: 'VFR Normalized Clips', mediaType: 'video', onlyVfr: true },
  { id: 'sb_graded', name: 'Color Graded Pictures', mediaType: 'image', onlyGraded: true },
  { id: 'sb_hd', name: 'Full HD / 4K Masters', mediaType: 'all', minWidth: 1280 },
  { id: 'sb_bpm', name: 'High Tempo (>=115 BPM)', mediaType: 'audio', minBpm: 115 },
];

export const MultiMasterEditStudio: React.FC<MultiMasterEditStudioProps> = ({
  assets,
  tracks,
  clips,
  selectedClip,
  playhead,
  fps,
  trimMode,
  markIn,
  markOut,
  nestedSequences,
  onSetTrimMode,
  onNudgeTrim,
  onSetMarkIn,
  onSetMarkOut,
  onExtractInOutRange,
  onCreateNestedSequence,
  onLoadNestedSequence,
  onDeleteNestedSequence,
  onAddVisualToTimeline,
  onSwitchMulticamAngle,
}) => {
  const [nestName, setNestName] = useState<string>('Sub-Timeline: Act I');
  const [multicamIds, setMulticamIds] = useState<string[]>([]);
  const [syncMethod, setSyncMethod] = useState<'audio_peak' | 'timecode' | 'manual'>('audio_peak');
  const [angleOffsets, setAngleOffsets] = useState<Record<string, number>>({});
  const [activeCamIdx, setActiveCamIdx] = useState<number>(0);

  // Power Bins (persisted across timelines in localStorage)
  const [powerBins, setPowerBins] = useState<PowerBin[]>(() => {
    try {
      const raw = localStorage.getItem(POWER_BINS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage failure
    }
    return [
      { id: 'pb_brand', name: 'Team Brand Selects', assetIds: [] },
      { id: 'pb_broll', name: 'Master B-Roll', assetIds: [] },
    ];
  });
  const [activePowerBinId, setActivePowerBinId] = useState<string>('pb_brand');
  const [newPowerBinName, setNewPowerBinName] = useState<string>('');
  const [selectedSmartBinId, setSelectedSmartBinId] = useState<string>('sb_hd');
  const [binTab, setBinTab] = useState<'power' | 'smart'>('power');

  useEffect(() => {
    try {
      localStorage.setItem(POWER_BINS_STORAGE_KEY, JSON.stringify(powerBins));
    } catch {
      // ignore quota
    }
  }, [powerBins]);

  const visualAssets = useMemo(
    () => assets.filter((a) => a.mediaType === 'image' || a.mediaType === 'video'),
    [assets],
  );

  const hasAutoSeededRef = useRef<boolean>(false);

  // Auto-seed Multi-Cam quad selection once per visual pool and prune deleted asset IDs
  useEffect(() => {
    if (visualAssets.length === 0) {
      hasAutoSeededRef.current = false;
      setMulticamIds([]);
      return;
    }
    const validSet = new Set(visualAssets.map((a) => a.id));
    setMulticamIds((prev) => {
      const filtered = prev.filter((id) => validSet.has(id));
      if (!hasAutoSeededRef.current && filtered.length === 0) {
        hasAutoSeededRef.current = true;
        return visualAssets.slice(0, 4).map((a) => a.id);
      }
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [visualAssets]);

  const multicamAssets = useMemo(
    () =>
      multicamIds
        .map((id) => assets.find((a) => a.id === id))
        .filter((a): a is MediaAsset => Boolean(a)),
    [multicamIds, assets],
  );

  // Locate outgoing Clip A & incoming Clip B nearest to current playhead on selected clip's track (or main video track)
  const trimPair = useMemo(() => {
    const targetTrackId =
      selectedClip?.trackId || tracks.find((t) => t.kind === 'video')?.id || '';
    const trkClips = clips
      .filter((c) => c.trackId === targetTrackId)
      .sort((a, b) => a.startTime - b.startTime);

    if (selectedClip) {
      const idx = trkClips.findIndex((c) => c.id === selectedClip.id);
      if (idx >= 0) {
        return {
          clipA: trkClips[idx],
          clipB: trkClips[idx + 1] || null,
        };
      }
    }
    let bestA = trkClips[0] || null;
    let bestB = trkClips[1] || null;
    let bestDist = Infinity;
    for (let i = 0; i < trkClips.length; i++) {
      const end = trkClips[i].startTime + trkClips[i].duration;
      const d = Math.abs(end - playhead);
      if (d < bestDist) {
        bestDist = d;
        bestA = trkClips[i];
        bestB = trkClips[i + 1] || null;
      }
    }
    return { clipA: bestA, clipB: bestB };
  }, [clips, tracks, selectedClip, playhead]);

  const activePowerBin = powerBins.find((b) => b.id === activePowerBinId) || powerBins[0];
  const powerBinAssets = useMemo(
    () =>
      (activePowerBin?.assetIds || [])
        .map((id) => assets.find((a) => a.id === id))
        .filter((a): a is MediaAsset => Boolean(a)),
    [activePowerBin, assets],
  );

  const smartBinRule = DEFAULT_SMART_BINS.find((r) => r.id === selectedSmartBinId) || DEFAULT_SMART_BINS[0];
  const smartBinAssets = useMemo(() => {
    return assets.filter((a) => {
      if (smartBinRule.mediaType && smartBinRule.mediaType !== 'all' && a.mediaType !== smartBinRule.mediaType) {
        return false;
      }
      if (smartBinRule.onlyVfr && !a.isVfr) return false;
      if (smartBinRule.onlyGraded && !a.colorGrade?.enabled) return false;
      if (smartBinRule.minWidth && a.width < smartBinRule.minWidth) return false;
      if (smartBinRule.minBpm && (a.bpm || 0) < smartBinRule.minBpm) return false;
      return true;
    });
  }, [assets, smartBinRule]);

  const handleAutoSyncAngles = () => {
    const nextOffsets: Record<string, number> = {};
    multicamAssets.forEach((a, idx) => {
      if (syncMethod === 'timecode') {
        nextOffsets[a.id] = Number((idx * 0.0).toFixed(2));
      } else if (syncMethod === 'audio_peak') {
        const firstBeat = a.beats && a.beats.length > 0 ? a.beats[0] : idx * 0.08;
        nextOffsets[a.id] = Number(firstBeat.toFixed(2));
      } else {
        nextOffsets[a.id] = angleOffsets[a.id] ?? 0;
      }
    });
    setAngleOffsets(nextOffsets);
  };

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-[430px] text-xs">
      {/* Column 1 (5 cols): MultiMaster Precision Trim + Nested Timelines */}
      <section className="lg:col-span-5 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg flex flex-col overflow-hidden shadow-xs dark:shadow-none">
        <div className="px-3.5 py-2 border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#171b22] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Scissors className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span className="font-semibold text-slate-900 dark:text-slate-100">MultiMaster Trim & Nested Timelines</span>
          </div>
          <span className="text-[10px] font-mono-tabular text-slate-500 dark:text-slate-400">
            {formatFrameTimecode(playhead, fps)}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
          {/* Trim Mode Selector */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Precision Trim Mode</span>
            <div className="grid grid-cols-5 gap-1">
              {(
                [
                  ['pointer', 'Select'],
                  ['ripple', 'Ripple'],
                  ['roll', 'Roll A/B'],
                  ['slip', 'Slip In'],
                  ['slide', 'Slide'],
                ] as [TrimMode, string][]
              ).map(([m, lbl]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onSetTrimMode(m)}
                  className={`py-1 rounded text-[10px] font-medium border cursor-pointer ${
                    trimMode === m
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-slate-50 dark:bg-[#0e1116] border-slate-300 dark:border-[#252b37] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Dual A/B Edit Point Inspector */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#0e1116] p-2 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span>Outgoing (Clip A)</span>
                <span className="font-mono-tabular text-blue-600 dark:text-blue-300">OUT</span>
              </div>
              <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                {trimPair.clipA?.name || 'No clip selected'}
              </p>
              <p className="text-[10px] font-mono-tabular text-slate-500 dark:text-slate-400">
                {trimPair.clipA
                  ? `End: ${(trimPair.clipA.startTime + trimPair.clipA.duration).toFixed(2)}s · Trim ${trimPair.clipA.trimStart.toFixed(2)}s`
                  : '—'}
              </p>
            </div>
            <div className="rounded border border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#0e1116] p-2 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span>Incoming (Clip B)</span>
                <span className="font-mono-tabular text-emerald-600 dark:text-emerald-300">IN</span>
              </div>
              <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                {trimPair.clipB?.name || 'End of Track'}
              </p>
              <p className="text-[10px] font-mono-tabular text-slate-500 dark:text-slate-400">
                {trimPair.clipB
                  ? `Start: ${trimPair.clipB.startTime.toFixed(2)}s · Trim ${trimPair.clipB.trimStart.toFixed(2)}s`
                  : '—'}
              </p>
            </div>
          </div>

          {/* Frame-Accurate Nudge Bar */}
          <div className="grid grid-cols-6 gap-1">
            {[-10, -5, -1, 1, 5, 10].map((df) => (
              <button
                key={df}
                type="button"
                disabled={!trimPair.clipA}
                onClick={() => onNudgeTrim(trimPair.clipA!.id, trimPair.clipB?.id || null, df)}
                className="py-1.5 rounded bg-slate-100 hover:bg-blue-600 dark:bg-[#1a1f28] dark:hover:bg-blue-600 border border-slate-300 dark:border-[#2a313e] disabled:opacity-40 font-mono-tabular text-[10px] font-semibold text-slate-800 dark:text-slate-200 hover:text-white cursor-pointer"
              >
                {df > 0 ? `+${df}f` : `${df}f`}
              </button>
            ))}
          </div>

          {/* In / Out Range Extract */}
          <div className="p-2.5 rounded border border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#101318] space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-800 dark:text-slate-200">Three-Point In/Out Range</span>
              <span className="font-mono-tabular text-[10px] text-slate-500 dark:text-slate-400">
                {markIn !== null ? `${markIn.toFixed(2)}s` : 'In: —'} →{' '}
                {markOut !== null ? `${markOut.toFixed(2)}s` : 'Out: —'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onSetMarkIn(Number(playhead.toFixed(3)))}
                className="flex-1 py-1 rounded bg-white hover:bg-slate-100 dark:bg-[#1b2029] dark:hover:bg-[#252c38] border border-slate-300 dark:border-[#2b3342] text-[10px] text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                Mark In (I)
              </button>
              <button
                type="button"
                onClick={() => onSetMarkOut(Number(playhead.toFixed(3)))}
                className="flex-1 py-1 rounded bg-white hover:bg-slate-100 dark:bg-[#1b2029] dark:hover:bg-[#252c38] border border-slate-300 dark:border-[#2b3342] text-[10px] text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                Mark Out (O)
              </button>
              <button
                type="button"
                disabled={markIn === null || markOut === null || Math.abs((markOut ?? 0) - (markIn ?? 0)) < 0.05}
                onClick={onExtractInOutRange}
                className="flex-1 py-1 rounded bg-amber-600/90 hover:bg-amber-500 disabled:opacity-40 text-[10px] font-semibold text-white cursor-pointer"
              >
                Ripple Extract
              </button>
            </div>
          </div>

          {/* Nested Timelines / Compound Sequences */}
          <div className="pt-2 border-t border-slate-200 dark:border-[#232832] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                Nested Timelines ({nestedSequences.length})
              </span>
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={nestName}
                onChange={(e) => setNestName(e.target.value)}
                placeholder="Sub-timeline name..."
                className="flex-1 min-w-0 h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-[11px] text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                disabled={clips.length === 0}
                onClick={() => onCreateNestedSequence(nestName.trim() || `Sub-Timeline ${nestedSequences.length + 1}`)}
                className="px-2.5 h-7 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <Layers className="w-3 h-3" />
                <span>Snapshot Nest</span>
              </button>
            </div>
            {nestedSequences.length > 0 && (
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {nestedSequences.map((seq) => (
                  <div
                    key={seq.id}
                    className="px-2 py-1.5 rounded bg-slate-50 dark:bg-[#101318] border border-slate-200 dark:border-[#222732] flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-slate-800 dark:text-slate-200 truncate">{seq.name}</p>
                      <p className="text-[9px] font-mono-tabular text-slate-500">
                        {seq.clips.length} clips · {seq.tracks.length} tracks
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onLoadNestedSequence(seq.id)}
                        className="px-2 py-0.5 rounded bg-white hover:bg-blue-600 dark:bg-[#1d222b] dark:hover:bg-blue-600 border border-slate-300 dark:border-transparent text-[10px] text-slate-800 dark:text-slate-200 hover:text-white cursor-pointer"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteNestedSequence(seq.id)}
                        className="p-1 text-slate-500 hover:text-red-500 dark:hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Column 2 (4 cols): Multi-Camera Synchronization & Live Angle Switcher */}
      <section className="lg:col-span-4 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg flex flex-col overflow-hidden shadow-xs dark:shadow-none">
        <div className="px-3.5 py-2 border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#171b22] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span className="font-semibold text-slate-900 dark:text-slate-100">Multi-Camera Sync</span>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={syncMethod}
              onChange={(e) => setSyncMethod(e.target.value as 'audio_peak' | 'timecode' | 'manual')}
              className="h-6 px-1.5 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-[10px] text-slate-800 dark:text-slate-200"
            >
              <option value="audio_peak">Sync: Audio Peak</option>
              <option value="timecode">Sync: Timecode</option>
              <option value="manual">Sync: Manual</option>
            </select>
            <button
              type="button"
              onClick={handleAutoSyncAngles}
              className="px-2 h-6 rounded bg-white hover:bg-blue-600 dark:bg-[#1d222b] dark:hover:bg-blue-600 border border-slate-300 dark:border-[#2c3442] text-[10px] text-slate-800 dark:text-slate-200 hover:text-white cursor-pointer"
            >
              Align
            </button>
          </div>
        </div>

        <div className="flex-1 p-3 flex flex-col gap-2.5 overflow-y-auto bg-slate-100 dark:bg-[#0c0e13]">
          {multicamAssets.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-slate-500">
              <Video className="w-5 h-5 mb-1.5 text-slate-400 dark:text-slate-600" />
              <p>Upload 2–4 video clips or photos to populate the Multi-Cam Angle Grid.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {multicamAssets.slice(0, 4).map((asset, idx) => {
                const isLive = activeCamIdx === idx;
                const offset = angleOffsets[asset.id] ?? 0;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      setActiveCamIdx(idx);
                      onSwitchMulticamAngle(asset, idx + 1);
                    }}
                    className={`relative aspect-video rounded overflow-hidden border text-left group cursor-pointer ${
                      isLive ? 'border-red-500 ring-1 ring-red-500/40' : 'border-slate-300 dark:border-[#283040] hover:border-blue-400'
                    }`}
                  >
                    {asset.thumbUrl ? (
                      <img
                        src={asset.thumbUrl}
                        alt={asset.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-slate-200 dark:bg-[#151a22] flex items-center justify-center text-slate-500">
                        CAM {idx + 1}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 py-1 flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-white">
                        CAM {idx + 1} {isLive ? '· LIVE CUT' : ''}
                      </span>
                      <span className="text-[9px] font-mono-tabular text-slate-300">
                        +{offset.toFixed(2)}s
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Angle Picker & Offset Controls */}
          {visualAssets.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-[#222732] space-y-1.5">
              <p className="text-[10px] text-slate-600 dark:text-slate-400">
                Click any camera quadrant above to insert an angle cut at playhead ({playhead.toFixed(2)}s).
              </p>
              <div className="max-h-24 overflow-y-auto space-y-1">
                {visualAssets.slice(0, 6).map((a) => {
                  const checked = multicamIds.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white dark:bg-[#12161e] border border-slate-200 dark:border-[#222732] text-[10px] cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked && multicamIds.length < 4) {
                              setMulticamIds([...multicamIds, a.id]);
                            } else if (!e.target.checked) {
                              setMulticamIds(multicamIds.filter((id) => id !== a.id));
                            }
                          }}
                        />
                        <span className="truncate text-slate-800 dark:text-slate-200">{a.name}</span>
                      </div>
                      <span className="font-mono-tabular text-slate-500 shrink-0">
                        {a.width}×{a.height}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Column 3 (3 cols): Power Bins & Smart Bins for Team Workflows */}
      <aside className="lg:col-span-3 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg flex flex-col overflow-hidden shadow-xs dark:shadow-none">
        <div className="flex border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#171b22]">
          <button
            type="button"
            onClick={() => setBinTab('power')}
            className={`flex-1 py-2 text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer ${
              binTab === 'power'
                ? 'text-slate-900 dark:text-white border-b-2 border-blue-500 bg-white dark:bg-[#14171d]'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <FolderKanban className="w-3 h-3" />
            <span>Power Bins</span>
          </button>
          <button
            type="button"
            onClick={() => setBinTab('smart')}
            className={`flex-1 py-2 text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer ${
              binTab === 'smart'
                ? 'text-slate-900 dark:text-white border-b-2 border-blue-500 bg-white dark:bg-[#14171d]'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>Smart Bins</span>
          </button>
        </div>

        {binTab === 'power' ? (
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            <div className="flex gap-1">
              <input
                type="text"
                value={newPowerBinName}
                onChange={(e) => setNewPowerBinName(e.target.value)}
                placeholder="New Team Power Bin"
                className="flex-1 min-w-0 h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-[11px] text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => {
                  const name = newPowerBinName.trim();
                  if (!name) return;
                  const nb: PowerBin = { id: uid('pb'), name, assetIds: [] };
                  setPowerBins((prev) => [...prev, nb]);
                  setActivePowerBinId(nb.id);
                  setNewPowerBinName('');
                }}
                className="px-2 h-7 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-medium cursor-pointer"
              >
                Add
              </button>
            </div>

            <select
              value={activePowerBinId}
              onChange={(e) => setActivePowerBinId(e.target.value)}
              className="w-full h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-[11px] text-slate-900 dark:text-slate-100"
            >
              {powerBins.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.assetIds.length})
                </option>
              ))}
            </select>

            {assets.length > 0 && activePowerBin && (
              <select
                value=""
                onChange={(e) => {
                  const aid = e.target.value;
                  if (!aid) return;
                  setPowerBins((prev) =>
                    prev.map((b) =>
                      b.id === activePowerBin.id && !b.assetIds.includes(aid)
                        ? { ...b, assetIds: [...b.assetIds, aid] }
                        : b,
                    ),
                  );
                }}
                className="w-full h-7 px-2 rounded bg-slate-50 dark:bg-[#101318] border border-dashed border-slate-300 dark:border-[#343c4d] text-[11px] text-slate-700 dark:text-slate-300"
              >
                <option value="">+ Link asset to “{activePowerBin.name}”...</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}

            <div className="space-y-1.5">
              {powerBinAssets.length === 0 ? (
                <p className="text-[11px] text-slate-500 py-2">
                  Shared Power Bins persist across timelines for team asset reuse.
                </p>
              ) : (
                powerBinAssets.map((a) => (
                  <div
                    key={a.id}
                    className="p-1.5 rounded bg-slate-50 dark:bg-[#101318] border border-slate-200 dark:border-[#222732] flex items-center justify-between gap-1.5"
                  >
                    <span className="truncate text-[11px] text-slate-800 dark:text-slate-200">{a.name}</span>
                    <button
                      type="button"
                      onClick={() => onAddVisualToTimeline(a, false)}
                      className="px-1.5 py-0.5 rounded bg-white hover:bg-blue-600 dark:bg-[#1d222b] dark:hover:bg-blue-600 border border-slate-300 dark:border-transparent text-[10px] text-slate-800 dark:text-slate-200 hover:text-white shrink-0 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            <div className="space-y-1">
              {DEFAULT_SMART_BINS.map((sb) => (
                <button
                  key={sb.id}
                  type="button"
                  onClick={() => setSelectedSmartBinId(sb.id)}
                  className={`w-full px-2.5 py-1.5 rounded border text-left text-[11px] transition-colors cursor-pointer ${
                    selectedSmartBinId === sb.id
                      ? 'bg-blue-50 dark:bg-blue-600/20 border-blue-500 text-blue-800 dark:text-blue-100'
                      : 'bg-slate-50 dark:bg-[#101318] border-slate-200 dark:border-[#222732] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                  }`}
                >
                  {sb.name}
                </button>
              ))}
            </div>
            <div className="pt-2 border-t border-slate-200 dark:border-[#232832] space-y-1.5">
              <p className="text-[10px] font-mono-tabular text-slate-500 dark:text-slate-400">
                Matches: {smartBinAssets.length} items
              </p>
              {smartBinAssets.map((a) => (
                <div
                  key={a.id}
                  className="p-1.5 rounded bg-slate-50 dark:bg-[#101318] border border-slate-200 dark:border-[#222732] flex items-center justify-between gap-1.5"
                >
                  <span className="truncate text-[11px] text-slate-800 dark:text-slate-200">{a.name}</span>
                  {a.mediaType !== 'audio' && (
                    <button
                      type="button"
                      onClick={() => onAddVisualToTimeline(a, false)}
                      className="px-1.5 py-0.5 rounded bg-white hover:bg-blue-600 dark:bg-[#1d222b] dark:hover:bg-blue-600 border border-slate-300 dark:border-transparent text-[10px] text-slate-800 dark:text-slate-200 hover:text-white shrink-0 cursor-pointer"
                    >
                      +V1
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};
