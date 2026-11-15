import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  AudioLines,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Mic,
  Pause,
  Play,
  Plus,
  Sliders,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  AudioFadeCurve,
  AudioTransitionType,
  DEFAULT_TRACK_AUDIO_DSP,
  TimelineClip,
  TimelineTrack,
  TrackAudioDsp,
  VstPluginSlot,
} from '../types/editor';
import {
  applyAudioFadeCurve,
  computeClipNormalizeGain,
  computeStereoMetersAtTime,
  formatTimecode,
  uid,
} from '../utils/timelineMath';
import { AudioMeterBar } from './AudioMeterBar';
import { AudioSpectrumVisualizer } from './AudioSpectrumVisualizer';

interface FairlightAudioStudioProps {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  selectedClipId?: string | null;
  playhead: number;
  isPlaying: boolean;
  masterMuted: boolean;
  normalizeAudio?: boolean;
  normalizeTargetLufs?: number;
  onTogglePlay: () => void;
  onSeekPlayhead?: (t: number) => void;
  onToggleMasterMute: () => void;
  onToggleMasterNormalize?: (enabled: boolean) => void;
  onChangeMasterNormalizeTarget?: (lufs: number) => void;
  onSelectClip?: (id: string | null) => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onCommitHistory?: () => void;
  onUpdateTrack: (trackId: string, patch: Partial<TimelineTrack>) => void;
  onCreateAudioFolder: (name: string) => void;
  onAddAudioTrack: (folderId?: string) => void;
  onCommitAdrTake: (file: File, cueInSec: number, targetTrackId?: string) => Promise<void>;
}

type CrossfadeCurveChoice = 'linear' | 'exp' | 'scurve';

interface AudioSegmentPair {
  id: string;
  track: TimelineTrack;
  clipA: TimelineClip;
  clipB: TimelineClip;
  overlapSec: number; // >0 overlapping, 0 touching, <0 gap
  seamTime: number;
  isEnabled: boolean;
  curve: CrossfadeCurveChoice;
  duration: number;
}

const CROSSFADE_CURVE_META: {
  id: CrossfadeCurveChoice;
  label: string;
  sub: string;
  transitionOut: AudioTransitionType;
}[] = [
  { id: 'linear', label: 'Linear', sub: 'Constant-slope X fade', transitionOut: 'crossfade_lin' },
  { id: 'exp', label: 'Exponential', sub: 'Fast drop / punchy swell', transitionOut: 'crossfade_exp' },
  { id: 'scurve', label: 'S-Curve', sub: 'Smooth cosine equal-blend', transitionOut: 'crossfade_eq' },
];

const VST_CATALOG: Omit<VstPluginSlot, 'id'>[] = [
  { name: 'Obsidian Comp-1176', category: 'Dynamics', bypassed: false, mix: 0.75, thresholdDb: -16 },
  { name: 'Studio Param-EQ 4', category: 'EQ', bypassed: false, mix: 1.0 },
  { name: 'Dialogue De-Esser Pro', category: 'Voice', bypassed: false, mix: 0.6 },
  { name: 'ConvoVerb Scoring Hall', category: 'Spatial', bypassed: false, mix: 0.28 },
  { name: 'Warm Tape Saturator', category: 'External VST3', bypassed: false, mix: 0.45, drive: 0.35 },
  { name: 'Broadcast Limiter L2', category: 'Dynamics', bypassed: false, mix: 1.0, thresholdDb: -1 },
];

function gainToDbLabel(gain: number): string {
  if (gain <= 0.005) return '-∞ dB';
  const db = 20 * Math.log10(gain);
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

/** Generate a clean synthetic WAV voice-slate fallback when browser mic permission is denied. */
function buildSyntheticSlateWav(durationSec: number): Blob {
  const sr = 22050;
  const total = Math.max(sr, Math.round(sr * durationSec));
  const data = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    const env = Math.min(1, t * 8) * Math.min(1, (durationSec - t) * 6);
    const tone = Math.sin(2 * Math.PI * (t < 0.25 ? 880 : 220 + Math.sin(t * 5) * 40) * t);
    data[i] = Math.round(tone * env * 0.35 * 32767);
  }
  const buf = new ArrayBuffer(44 + data.byteLength);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + data.byteLength, true);
  writeStr(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, data.byteLength, true);
  new Int16Array(buf, 44).set(data);
  return new Blob([buf], { type: 'audio/wav' });
}

export const FairlightAudioStudio: React.FC<FairlightAudioStudioProps> = ({
  tracks,
  clips,
  selectedClipId = null,
  playhead,
  isPlaying,
  masterMuted,
  normalizeAudio = false,
  normalizeTargetLufs = -14,
  onTogglePlay,
  onSeekPlayhead,
  onToggleMasterMute,
  onToggleMasterNormalize,
  onChangeMasterNormalizeTarget,
  onSelectClip,
  onUpdateClip,
  onCommitHistory,
  onUpdateTrack,
  onCreateAudioFolder,
  onAddAudioTrack,
  onCommitAdrTake,
}) => {
  const audioTracks = useMemo(() => tracks.filter((t) => t.kind === 'audio'), [tracks]);
  const folderTracks = useMemo(() => audioTracks.filter((t) => t.isFolder), [audioTracks]);
  const channelTracks = useMemo(() => audioTracks.filter((t) => !t.isFolder), [audioTracks]);

  const [selectedTrackId, setSelectedTrackId] = useState<string>(() => channelTracks[0]?.id || audioTracks[0]?.id || '');
  const [centerLayout, setCenterLayout] = useState<'split' | 'crossfades' | 'mixer'>('split');
  const [showSpectrum, setShowSpectrum] = useState<boolean>(true);
  const [selectedPairId, setSelectedPairId] = useState<string>('');
  const [newFolderName, setNewFolderName] = useState<string>('Dialogue Bus');
  const [selectedVstCatalogIdx, setSelectedVstCatalogIdx] = useState<number>(0);
  const [scannedVstPath, setScannedVstPath] = useState<string>('/Library/Audio/Plug-Ins/VST3');

  // ADR Booth state
  const [cueIn, setCueIn] = useState<number>(() => Number(playhead.toFixed(2)));
  const [cueDuration, setCueDuration] = useState<number>(3.0);
  const [adrPhase, setAdrPhase] = useState<'idle' | 'countdown' | 'recording' | 'ready'>('idle');
  const [countdownNum, setCountdownNum] = useState<number>(3);
  const [adrTakeCount, setAdrTakeCount] = useState<number>(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [adrBusy, setAdrBusy] = useState<boolean>(false);
  const [adrNote, setAdrNote] = useState<string>('Set Cue In at playhead, then Record ADR Take');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const adrTimeoutRef = useRef<number | null>(null);
  const xfadeCommittedRef = useRef<boolean>(false);
  const faderCommittedRef = useRef<boolean>(false);
  const dspCommittedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!audioTracks.some((t) => t.id === selectedTrackId)) {
      setSelectedTrackId(channelTracks[0]?.id || audioTracks[0]?.id || '');
    }
  }, [audioTracks, channelTracks, selectedTrackId]);

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (adrTimeoutRef.current) window.clearTimeout(adrTimeoutRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  const segmentPairs = useMemo<AudioSegmentPair[]>(() => {
    const out: AudioSegmentPair[] = [];
    for (const trk of channelTracks) {
      const trkClips = clips
        .filter((c) => c.trackId === trk.id && c.kind === 'audio')
        .sort((a, b) => a.startTime - b.startTime);
      for (let i = 0; i < trkClips.length - 1; i++) {
        const clipA = trkClips[i];
        const clipB = trkClips[i + 1];
        const clipAEnd = clipA.startTime + clipA.duration;
        const overlapSec = Number((clipAEnd - clipB.startTime).toFixed(3));
        const rawCurve = clipA.audioCrossfadeCurve;
        const inferredCurve: CrossfadeCurveChoice =
          rawCurve === 'linear' || rawCurve === 'exp' || rawCurve === 'scurve'
            ? rawCurve
            : clipA.audioTransitionOut === 'crossfade_lin'
              ? 'linear'
              : clipA.audioTransitionOut === 'crossfade_exp'
                ? 'exp'
                : 'scurve';
        const isEnabled = Boolean(clipA.audioTransitionOut && clipA.audioTransitionOut !== 'cut');
        const defaultDur = overlapSec > 0.05 ? Math.min(5, Math.max(0.15, overlapSec)) : 1.0;
        const duration = Number(
          Math.max(0.1, Math.min(5, clipA.audioTransitionDuration || defaultDur)).toFixed(2),
        );
        out.push({
          id: `${clipA.id}__${clipB.id}`,
          track: trk,
          clipA,
          clipB,
          overlapSec,
          seamTime: overlapSec > 0 ? clipB.startTime : clipAEnd,
          isEnabled,
          curve: inferredCurve,
          duration,
        });
      }
    }
    // Sort overlapping pairs first, then touching/nearest seams
    return out.sort((a, b) => {
      const aOv = a.overlapSec > 0 ? 1 : 0;
      const bOv = b.overlapSec > 0 ? 1 : 0;
      if (aOv !== bOv) return bOv - aOv;
      return a.seamTime - b.seamTime;
    });
  }, [channelTracks, clips]);

  useEffect(() => {
    if (segmentPairs.length === 0) {
      if (selectedPairId) setSelectedPairId('');
      return;
    }
    const selMatch = selectedClipId
      ? segmentPairs.find((p) => p.clipA.id === selectedClipId || p.clipB.id === selectedClipId)
      : undefined;
    if (selMatch && !segmentPairs.some((p) => p.id === selectedPairId)) {
      setSelectedPairId(selMatch.id);
      return;
    }
    if (!segmentPairs.some((p) => p.id === selectedPairId)) {
      setSelectedPairId(segmentPairs[0].id);
    }
  }, [segmentPairs, selectedPairId, selectedClipId]);

  const activePair = segmentPairs.find((p) => p.id === selectedPairId) || segmentPairs[0] || null;

  const applyCrossfadeToPair = (
    pair: AudioSegmentPair,
    nextCurve: CrossfadeCurveChoice,
    nextDuration: number,
    enabled = true,
    shouldCommit = true,
  ) => {
    const clampedDur = Number(
      Math.max(
        0.1,
        Math.min(5.0, pair.clipA.duration * 0.85, pair.clipB.duration * 0.85, nextDuration),
      ).toFixed(2),
    );
    const meta = CROSSFADE_CURVE_META.find((m) => m.id === nextCurve) || CROSSFADE_CURVE_META[2];
    if (shouldCommit) onCommitHistory?.();
    onSelectClip?.(pair.clipA.id);
    onUpdateClip(pair.clipA.id, {
      audioTransitionOut: enabled ? meta.transitionOut : 'cut',
      audioTransitionDuration: enabled ? clampedDur : 0,
      audioCrossfadeCurve: nextCurve as AudioFadeCurve,
    });
  };

  const overlapPairToDuration = (pair: AudioSegmentPair, targetOverlapSec: number) => {
    const maxSafe = Math.max(0.15, Math.min(5.0, pair.clipA.duration * 0.8, pair.clipB.duration * 0.8));
    const clamped = Number(Math.max(0.1, Math.min(maxSafe, targetOverlapSec)).toFixed(2));
    const nextBStart = Number(Math.max(0, pair.clipA.startTime + pair.clipA.duration - clamped).toFixed(3));
    const meta = CROSSFADE_CURVE_META.find((m) => m.id === pair.curve) || CROSSFADE_CURVE_META[2];
    onCommitHistory?.();
    onUpdateClip(pair.clipB.id, { startTime: nextBStart });
    onUpdateClip(pair.clipA.id, {
      audioTransitionOut: pair.isEnabled ? pair.clipA.audioTransitionOut : meta.transitionOut,
      audioTransitionDuration: clamped,
      audioCrossfadeCurve: pair.curve,
    });
  };

  const selectedTrack = audioTracks.find((t) => t.id === selectedTrackId) || audioTracks[0] || null;
  const activeDsp: TrackAudioDsp = selectedTrack?.audioDsp || DEFAULT_TRACK_AUDIO_DSP;

  const updateTrackDsp = (trackId: string, patch: Partial<TrackAudioDsp>, commitHistory = true) => {
    if (commitHistory) onCommitHistory?.();
    const trk = audioTracks.find((t) => t.id === trackId);
    const cur = trk?.audioDsp || { ...DEFAULT_TRACK_AUDIO_DSP, vstSlots: [] };
    onUpdateTrack(trackId, {
      audioDsp: { ...cur, ...patch },
    });
  };

  const addVstPlugin = () => {
    if (!selectedTrack) return;
    const tpl = VST_CATALOG[selectedVstCatalogIdx] || VST_CATALOG[0];
    const nextSlot: VstPluginSlot = { ...tpl, id: uid('vst') };
    updateTrackDsp(selectedTrack.id, {
      vstSlots: [...(activeDsp.vstSlots || []), nextSlot],
    });
  };

  const meterSnapshot = useMemo(
    () =>
      computeStereoMetersAtTime(
        tracks,
        clips,
        playhead,
        masterMuted,
        isPlaying,
        normalizeAudio,
        normalizeTargetLufs,
      ),
    [tracks, clips, playhead, masterMuted, isPlaying, normalizeAudio, normalizeTargetLufs],
  );

  const normalizeAllAudioClips = () => {
    const audioClips = clips.filter((c) => c.kind === 'audio' || (c.kind === 'video' && c.hasAudio));
    if (audioClips.length === 0) return;
    onCommitHistory?.();
    for (const c of audioClips) {
      const targetPeak = normalizeTargetLufs <= -20 ? 0.72 : normalizeTargetLufs <= -15 ? 0.82 : 0.88;
      const nextVol = computeClipNormalizeGain(c.waveform, targetPeak);
      onUpdateClip(c.id, { volume: nextVol });
    }
  };

  const startAdrRecording = async () => {
    if (adrPhase === 'countdown' || adrPhase === 'recording') return;
    setRecordedBlob(null);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }

    setAdrPhase('countdown');
    setCountdownNum(3);
    setAdrNote('Prepare dialogue delivery on 3-2-1 cue...');

    let count = 3;
    timerRef.current = window.setInterval(async () => {
      count -= 1;
      if (count > 0) {
        setCountdownNum(count);
        return;
      }
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setAdrPhase('recording');
      setAdrNote(`Recording live ADR (${cueDuration.toFixed(1)}s)...`);

      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
          throw new Error('Microphone API unavailable');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        const rec = new MediaRecorder(stream);
        mediaRecorderRef.current = rec;
        const chunks: BlobPart[] = [];
        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (mediaStreamRef.current === stream) {
            mediaStreamRef.current = null;
          }
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const url = URL.createObjectURL(blob);
          setRecordedBlob(blob);
          setRecordedUrl(url);
          setAdrTakeCount((n) => n + 1);
          setAdrPhase('ready');
          setAdrNote('Take captured! Audition or commit directly to timeline.');
        };
        rec.start();
        if (adrTimeoutRef.current) window.clearTimeout(adrTimeoutRef.current);
        adrTimeoutRef.current = window.setTimeout(() => {
          adrTimeoutRef.current = null;
          if (rec.state === 'recording') rec.stop();
        }, cueDuration * 1000);
      } catch {
        // Clean synthetic ADR slate fallback if browser mic is blocked
        if (adrTimeoutRef.current) window.clearTimeout(adrTimeoutRef.current);
        adrTimeoutRef.current = window.setTimeout(() => {
          adrTimeoutRef.current = null;
          const blob = buildSyntheticSlateWav(cueDuration);
          const url = URL.createObjectURL(blob);
          setRecordedBlob(blob);
          setRecordedUrl(url);
          setAdrTakeCount((n) => n + 1);
          setAdrPhase('ready');
          setAdrNote('Mic blocked in sandbox — generated calibrated WAV ADR slate take.');
        }, Math.min(1200, cueDuration * 350));
      }
    }, 650);
  };

  const stopAdrEarly = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (adrTimeoutRef.current) {
      window.clearTimeout(adrTimeoutRef.current);
      adrTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      setAdrPhase('idle');
    }
  };

  const handleCommitTake = async () => {
    if (!recordedBlob) return;
    setAdrBusy(true);
    try {
      const ext = recordedBlob.type.includes('wav') ? 'wav' : 'webm';
      const file = new File([recordedBlob], `ADR_Take_${adrTakeCount}.${ext}`, {
        type: recordedBlob.type || 'audio/wav',
      });
      await onCommitAdrTake(file, cueIn, selectedTrack && !selectedTrack.isFolder ? selectedTrack.id : undefined);
      setAdrPhase('idle');
      setAdrNote(`Committed ADR_Take_${adrTakeCount}.${ext} at ${formatTimecode(cueIn)}`);
    } finally {
      setAdrBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-3 min-h-[430px] text-xs">
      {/* Left: Folder-Track Hierarchy Manager */}
      <aside className="w-full lg:w-[270px] shrink-0 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg flex flex-col overflow-hidden shadow-xs dark:shadow-none">
        <div className="px-3.5 py-2 border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#171b22] flex items-center justify-between">
          <span className="font-semibold text-slate-900 dark:text-slate-100">Folder-Track Hierarchy</span>
          <span className="text-[10px] font-mono-tabular text-slate-500 dark:text-slate-400">
            {folderTracks.length} buses · {channelTracks.length} ch
          </span>
        </div>

        <div className="p-3 border-b border-slate-200 dark:border-[#232832] space-y-2">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder Bus Name"
              className="flex-1 min-w-0 h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#262c38] text-[11px] text-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() => {
                onCreateAudioFolder(newFolderName.trim() || 'Submix Bus');
              }}
              className="px-2.5 h-7 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <FolderPlus className="w-3 h-3" />
              <span>Bus</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => onAddAudioTrack(selectedTrack?.isFolder ? selectedTrack.id : selectedTrack?.parentFolderId)}
            className="w-full py-1.5 px-2.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1d222b] dark:hover:bg-[#262d39] border border-slate-300 dark:border-[#2c3442] text-slate-800 dark:text-slate-200 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            <span>Add Audio Track</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
          {folderTracks.map((folder) => {
            const children = channelTracks.filter((c) => c.parentFolderId === folder.id);
            const isSel = selectedTrack?.id === folder.id;
            return (
              <div key={folder.id} className="rounded border border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#101318] overflow-hidden">
                <div
                  onClick={() => setSelectedTrackId(folder.id)}
                  className={`px-2 py-1.5 flex items-center justify-between gap-1 cursor-pointer ${
                    isSel
                      ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-900 dark:text-white'
                      : 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#171c25]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateTrack(folder.id, { collapsed: !folder.collapsed });
                    }}
                    className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    {folder.collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  <span className="font-semibold truncate flex-1">{folder.name}</span>
                  <span className="text-[9px] font-mono-tabular text-slate-500 dark:text-slate-400">{children.length} trk</span>
                </div>
                {!folder.collapsed && children.length > 0 && (
                  <div className="pl-4 pr-1.5 pb-1.5 pt-1 space-y-1 border-t border-slate-200 dark:border-[#1e232d]">
                    {children.map((ch) => (
                      <div
                        key={ch.id}
                        onClick={() => setSelectedTrackId(ch.id)}
                        className={`px-2 py-1 rounded flex items-center justify-between gap-1 cursor-pointer text-[11px] ${
                          selectedTrack?.id === ch.id
                            ? 'bg-blue-100 dark:bg-blue-600/25 text-blue-800 dark:text-blue-100'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#191f29]'
                        }`}
                      >
                        <span className="truncate">{ch.name}</span>
                        <span className="text-[9px] font-mono-tabular text-slate-500 dark:text-slate-400">
                          {gainToDbLabel(ch.volume)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {channelTracks
            .filter((ch) => !ch.parentFolderId || !folderTracks.some((f) => f.id === ch.parentFolderId))
            .map((ch) => (
              <div
                key={ch.id}
                onClick={() => setSelectedTrackId(ch.id)}
                className={`px-2.5 py-1.5 rounded border flex items-center justify-between gap-2 cursor-pointer ${
                  selectedTrack?.id === ch.id
                    ? 'bg-blue-50 dark:bg-blue-600/15 border-blue-500 text-blue-900 dark:text-white'
                    : 'bg-slate-50 dark:bg-[#101318] border-slate-200 dark:border-[#222732] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                }`}
              >
                <span className="font-medium truncate">{ch.name}</span>
                {folderTracks.length > 0 && (
                  <select
                    value={ch.parentFolderId || ''}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      onCommitHistory?.();
                      onUpdateTrack(ch.id, { parentFolderId: e.target.value || undefined });
                    }}
                    title="Assign track to folder bus"
                    className="h-5 px-1 rounded bg-white dark:bg-[#0b0e14] border border-slate-300 dark:border-[#2a303d] text-[9px] text-slate-700 dark:text-slate-300 max-w-[92px]"
                  >
                    <option value="">No Folder</option>
                    {folderTracks.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
        </div>
      </aside>

      {/* Center: Multi-Track Mixing Console + Clip Crossfade Editor */}
      <section className="flex-1 min-w-0 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg flex flex-col overflow-hidden shadow-xs dark:shadow-none">
        <div className="px-3.5 py-2 border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#171b22] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Volume2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-semibold text-slate-900 dark:text-slate-100">Fairlight Multi-Track Console</span>
            <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
              {formatTimecode(playhead)} · 48 kHz Bus
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center p-0.5 rounded bg-slate-200/70 dark:bg-[#0e1116] border border-slate-300 dark:border-[#262c38]">
              {(
                [
                  ['split', 'Mixer + Xfade'],
                  ['crossfades', `Crossfades (${segmentPairs.length})`],
                  ['mixer', 'Mixer Only'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCenterLayout(id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors ${
                    centerLayout === id
                      ? 'bg-emerald-600/20 dark:bg-emerald-600/30 text-emerald-800 dark:text-emerald-200 border border-emerald-500/50 dark:border-emerald-500/40'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onTogglePlay}
              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span>{isPlaying ? 'Pause' : 'Audition'}</span>
            </button>
            <button
              type="button"
              onClick={onToggleMasterMute}
              className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 border cursor-pointer ${
                masterMuted
                  ? 'bg-red-50 dark:bg-red-500/20 border-red-400 dark:border-red-500 text-red-700 dark:text-red-200'
                  : 'bg-white dark:bg-[#101318] border-slate-300 dark:border-[#262c38] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              {masterMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              <span>{masterMuted ? 'Master Muted' : 'Master Live'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowSpectrum((s) => !s)}
              aria-pressed={showSpectrum}
              title="Toggle Real-Time Audio Spectrum Analyzer"
              className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 border cursor-pointer ${
                showSpectrum
                  ? 'bg-cyan-50 dark:bg-cyan-600/20 border-cyan-500 dark:border-cyan-400 text-cyan-800 dark:text-cyan-200'
                  : 'bg-white dark:bg-[#101318] border-slate-300 dark:border-[#262c38] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              <AudioLines className="w-3 h-3" />
              <span>RTA Spectrum</span>
            </button>
          </div>
        </div>

        {showSpectrum && (
          <div className="px-2.5 pt-2 bg-slate-100 dark:bg-[#0c0e13] border-b border-slate-200 dark:border-[#232832] pb-2 shrink-0">
            <AudioSpectrumVisualizer
              tracks={tracks}
              clips={clips}
              playhead={playhead}
              isPlaying={isPlaying}
              masterMuted={masterMuted}
              normalizeAudio={normalizeAudio}
              normalizeTargetLufs={normalizeTargetLufs}
              bandCount={48}
              heightClass="h-24"
              title="Fairlight Master RTA Spectrum (36 Hz – 15.5 kHz)"
            />
          </div>
        )}

        {centerLayout !== 'crossfades' && (
          <div
            className={`${
              centerLayout === 'split' ? 'shrink-0' : 'flex-1'
            } overflow-x-auto p-2.5 flex items-stretch gap-2.5 bg-slate-100 dark:bg-[#0c0e13]`}
          >
            {audioTracks.map((trk) => {
              const reading = meterSnapshot.perTrack[trk.id] || {
                left: 0,
                right: 0,
                leftDb: -60,
                rightDb: -60,
                clipping: false,
              };
              const dsp = trk.audioDsp || DEFAULT_TRACK_AUDIO_DSP;
              const isSel = selectedTrack?.id === trk.id;
              return (
                <div
                  key={trk.id}
                  onClick={() => setSelectedTrackId(trk.id)}
                  className={`w-[138px] shrink-0 rounded-md border p-2 flex flex-col justify-between gap-1.5 cursor-pointer transition-colors ${
                    trk.isFolder
                      ? isSel
                        ? 'bg-blue-50 dark:bg-[#172133] border-blue-500 dark:border-blue-400'
                        : 'bg-blue-50/50 dark:bg-[#121823] border-blue-200 dark:border-[#293549]'
                      : isSel
                        ? 'bg-blue-50/70 dark:bg-[#161c26] border-blue-500 dark:border-blue-400'
                        : 'bg-white dark:bg-[#12151b] border-slate-200 dark:border-[#232832] hover:border-slate-400 dark:hover:border-slate-500 shadow-xs dark:shadow-none'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {trk.name}
                      </span>
                      <span className="text-[9px] text-slate-500">
                        {trk.isFolder ? 'BUS' : 'TRK'}
                      </span>
                    </div>
                    <p className="text-[9px] font-mono-tabular text-slate-500 dark:text-slate-400 mt-0.5">
                      {(dsp.vstSlots || []).filter((s) => !s.bypassed).length} VST · {gainToDbLabel(trk.volume)}
                    </p>
                  </div>

                  {/* Stereo L/R Peak Meter + Gain Fader */}
                  <div className="flex items-center justify-center gap-1.5 py-0.5">
                    <AudioMeterBar
                      leftDb={reading.leftDb}
                      rightDb={reading.rightDb}
                      orientation="vertical"
                      compact
                      heightClass={centerLayout === 'split' ? 'h-20' : 'h-28'}
                      muted={masterMuted || trk.muted}
                      clipping={reading.clipping}
                    />
                    <div className="flex-1 flex flex-col items-center gap-1">
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.02}
                        value={trk.volume}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          if (!faderCommittedRef.current) {
                            onCommitHistory?.();
                            faderCommittedRef.current = true;
                          }
                          onUpdateTrack(trk.id, { volume: Number(e.target.value) });
                        }}
                        onPointerUp={() => {
                          faderCommittedRef.current = false;
                        }}
                        onPointerCancel={() => {
                          faderCommittedRef.current = false;
                        }}
                        onBlur={() => {
                          faderCommittedRef.current = false;
                        }}
                        className={`studio-slider ${centerLayout === 'split' ? 'w-16 my-6' : 'w-20 my-8'} -rotate-90`}
                        title="Track Volume Fader"
                      />
                    </div>
                  </div>

                  {/* Mini 3-Band EQ readout + Mute / Solo */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-1 text-[9px] font-mono-tabular text-center">
                      <div className="rounded bg-slate-100 dark:bg-[#0d1016] py-0.5 border border-slate-200 dark:border-[#222732]">
                        <span className="text-slate-500 block">L</span>
                        <span className="text-slate-800 dark:text-slate-200">{dsp.eqLowDb > 0 ? `+${dsp.eqLowDb}` : dsp.eqLowDb}</span>
                      </div>
                      <div className="rounded bg-slate-100 dark:bg-[#0d1016] py-0.5 border border-slate-200 dark:border-[#222732]">
                        <span className="text-slate-500 block">M</span>
                        <span className="text-slate-800 dark:text-slate-200">{dsp.eqMidDb > 0 ? `+${dsp.eqMidDb}` : dsp.eqMidDb}</span>
                      </div>
                      <div className="rounded bg-slate-100 dark:bg-[#0d1016] py-0.5 border border-slate-200 dark:border-[#222732]">
                        <span className="text-slate-500 block">H</span>
                        <span className="text-slate-800 dark:text-slate-200">{dsp.eqHighDb > 0 ? `+${dsp.eqHighDb}` : dsp.eqHighDb}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCommitHistory?.();
                          onUpdateTrack(trk.id, { solo: !trk.solo });
                        }}
                        className={`flex-1 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                          trk.solo
                            ? 'bg-amber-500 text-black'
                            : 'bg-slate-200/80 dark:bg-[#1a1f28] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        S
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCommitHistory?.();
                          onUpdateTrack(trk.id, { muted: !trk.muted });
                        }}
                        className={`flex-1 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                          trk.muted
                            ? 'bg-red-500 text-white'
                            : 'bg-slate-200/80 dark:bg-[#1a1f28] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        M
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Master Bus Meter & Loudness Normalizer Strip */}
            <div className="w-[172px] shrink-0 rounded-md border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/70 dark:bg-[#101720] p-2.5 flex flex-col justify-between gap-2 shadow-xs dark:shadow-none">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">Master Bus</span>
                <span className="text-[10px] font-mono-tabular text-slate-700 dark:text-slate-300">
                  {masterMuted || meterSnapshot.estimatedLufs <= -58
                    ? '-∞ LUFS'
                    : `${meterSnapshot.estimatedLufs.toFixed(1)} LUFS`}
                </span>
              </div>

              <div className="flex items-center justify-center py-0.5">
                <AudioMeterBar
                  leftDb={meterSnapshot.leftDb}
                  rightDb={meterSnapshot.rightDb}
                  orientation="vertical"
                  heightClass={centerLayout === 'split' ? 'h-20' : 'h-28'}
                  muted={masterMuted}
                  clipping={meterSnapshot.clipping}
                />
              </div>

              <div className="space-y-1.5 pt-1 border-t border-emerald-200 dark:border-[#1e2938]">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-medium text-slate-700 dark:text-slate-300">Normalizer</span>
                  <button
                    type="button"
                    onClick={() => onToggleMasterNormalize?.(!normalizeAudio)}
                    className={`px-2 py-0.5 rounded text-[9px] font-semibold border cursor-pointer ${
                      normalizeAudio
                        ? 'bg-emerald-600/20 dark:bg-emerald-600/30 border-emerald-500 dark:border-emerald-400 text-emerald-800 dark:text-emerald-100'
                        : 'bg-white dark:bg-[#0b0f15] border-slate-300 dark:border-[#263142] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {normalizeAudio ? 'ON' : 'OFF'}
                  </button>
                </div>
                <select
                  aria-label="Master Loudness Target"
                  value={normalizeTargetLufs}
                  onChange={(e) => {
                    onChangeMasterNormalizeTarget?.(Number(e.target.value));
                    if (!normalizeAudio) onToggleMasterNormalize?.(true);
                  }}
                  className="w-full h-6 px-1.5 rounded bg-white dark:bg-[#0b0e14] border border-slate-300 dark:border-[#263142] text-[10px] font-mono-tabular text-slate-800 dark:text-slate-200"
                >
                  <option value={-14}>-14 LUFS (YouTube / Web)</option>
                  <option value={-16}>-16 LUFS (Podcast / Mobile)</option>
                  <option value={-23}>-23 LUFS (Broadcast EBU)</option>
                </select>
                <button
                  type="button"
                  onClick={normalizeAllAudioClips}
                  disabled={clips.filter((c) => c.kind === 'audio' || (c.kind === 'video' && c.hasAudio)).length === 0}
                  className="w-full py-1 px-2 rounded bg-blue-50 hover:bg-blue-100 dark:bg-[#182334] dark:hover:bg-blue-600/30 disabled:opacity-40 border border-blue-400/60 dark:border-blue-500/40 text-[10px] font-medium text-blue-700 dark:text-blue-200 cursor-pointer"
                  title="Auto-balance every clip's base volume using analyzed waveform peaks"
                >
                  Normalize All Clips
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Audio Clip Crossfade Editor for Overlapping & Adjacent Segments */}
        {centerLayout !== 'mixer' && (
          <div className="flex-1 min-h-[210px] border-t border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#0f131a] p-3 flex flex-col gap-2.5 overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                  Audio Clip Crossfades (Overlapping &amp; Adjacent Segments)
                </span>
                <span className="text-[10px] font-mono-tabular text-slate-500 dark:text-slate-400">
                  {segmentPairs.filter((p) => p.overlapSec > 0).length} overlapping · {segmentPairs.length} total seams
                </span>
              </div>
              {activePair && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const target = activePair.isEnabled ? activePair.duration : 1.0;
                      overlapPairToDuration(activePair, target);
                    }}
                    title="Shift incoming clip earlier so both audio segments physically overlap by the crossfade duration"
                    className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 dark:bg-[#182230] dark:hover:bg-[#223044] border border-blue-400/60 dark:border-blue-500/40 text-[10px] font-medium text-blue-700 dark:text-blue-200 cursor-pointer"
                  >
                    Overlap Clips ({(activePair.isEnabled ? activePair.duration : 1.0).toFixed(2)}s)
                  </button>
                  {onSeekPlayhead && (
                    <button
                      type="button"
                      onClick={() => {
                        onSeekPlayhead(Math.max(0, Number((activePair.seamTime - 0.6).toFixed(2))));
                        if (!isPlaying) onTogglePlay();
                      }}
                      className="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-600/25 dark:hover:bg-emerald-600/40 border border-emerald-400/70 dark:border-emerald-500/50 text-[10px] font-medium text-emerald-700 dark:text-emerald-200 flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5" />
                      <span>Audition Seam</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {!activePair ? (
              <div className="flex-1 rounded border border-dashed border-slate-300 dark:border-[#242b38] bg-white dark:bg-[#0b0e14] p-4 flex flex-col items-center justify-center text-center gap-1.5">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  No consecutive or overlapping audio segments on the same track yet
                </p>
                <p className="text-[11px] text-slate-500 max-w-md">
                  Place or split two audio clips on an audio track (e.g. overlap two music cues on A1 or split a track with S) to configure Linear, Exponential, or S-Curve crossfades.
                </p>
              </div>
            ) : (
              <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-3 min-h-0">
                {/* Segment Pair Picker & Overlap Status */}
                <div className="xl:col-span-4 flex flex-col gap-1.5 overflow-y-auto pr-0.5 max-h-[220px]">
                  {segmentPairs.map((pair) => {
                    const isActive = pair.id === activePair.id;
                    const overlapBadge =
                      pair.overlapSec > 0.02
                        ? `+${pair.overlapSec.toFixed(2)}s overlap`
                        : pair.overlapSec >= -0.05
                          ? '0.00s touching'
                          : `${Math.abs(pair.overlapSec).toFixed(2)}s gap`;
                    return (
                      <button
                        key={pair.id}
                        type="button"
                        onClick={() => {
                          setSelectedPairId(pair.id);
                          setSelectedTrackId(pair.track.id);
                          onSelectClip?.(pair.clipA.id);
                        }}
                        className={`w-full text-left p-2 rounded border transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-500 dark:border-emerald-400/80 text-emerald-950 dark:text-white'
                            : 'bg-white dark:bg-[#0b0e14] border-slate-200 dark:border-[#222834] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 truncate">
                            {pair.track.name} · {formatTimecode(pair.seamTime)}
                          </span>
                          <span
                            className={`text-[9px] font-mono-tabular px-1.5 py-0.5 rounded ${
                              pair.overlapSec > 0.02
                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                : pair.overlapSec >= -0.05
                                  ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {overlapBadge}
                          </span>
                        </div>
                        <p className="text-[11px] font-medium truncate mt-0.5">
                          {pair.clipA.name} → {pair.clipB.name}
                        </p>
                        <p className="text-[9px] font-mono-tabular text-slate-500 dark:text-slate-400 mt-0.5">
                          {pair.isEnabled
                            ? `${CROSSFADE_CURVE_META.find((m) => m.id === pair.curve)?.label || 'S-Curve'} · ${pair.duration.toFixed(2)}s`
                            : 'Hard Cut (Crossfade Off)'}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Live Crossfade Curve Visualizer + Controls */}
                <div className="xl:col-span-8 rounded border border-slate-200 dark:border-[#232936] bg-white dark:bg-[#0b0e14] p-2.5 flex flex-col justify-between gap-2.5">
                  {/* Live Overlapping Curves & Waveform Preview */}
                  <div className="relative h-24 w-full rounded bg-slate-950 dark:bg-[#07090d] border border-slate-300 dark:border-[#1d2330] overflow-hidden">
                    <svg viewBox="0 0 200 100" preserveAspectRatio="none" className="w-full h-full">
                      {/* Overlap shading */}
                      <rect
                        x={20}
                        y={0}
                        width={160}
                        height={100}
                        fill={activePair.isEnabled ? 'rgba(16, 185, 129, 0.07)' : 'rgba(100, 116, 139, 0.06)'}
                      />
                      <line x1={20} y1={0} x2={20} y2={100} stroke="#1f2937" strokeDasharray="2 2" strokeWidth="0.7" />
                      <line x1={180} y1={0} x2={180} y2={100} stroke="#1f2937" strokeDasharray="2 2" strokeWidth="0.7" />
                      <line x1={0} y1={50} x2={200} y2={50} stroke="#171d28" strokeWidth="0.6" />

                      {/* Outgoing Clip A tail waveform bars */}
                      {(activePair.clipA.waveform || []).slice(-32).map((bar, idx, arr) => {
                        const u = idx / Math.max(1, arr.length - 1);
                        const fadeMult = activePair.isEnabled
                          ? applyAudioFadeCurve(1 - u, activePair.curve)
                          : 1;
                        const h = Math.max(3, bar * fadeMult * 78);
                        return (
                          <rect
                            key={`wa_${idx}`}
                            x={20 + u * 160}
                            y={50 - h / 2}
                            width={160 / Math.max(1, arr.length) * 0.65}
                            height={h}
                            fill="#34d399"
                            opacity={0.32}
                          />
                        );
                      })}

                      {/* Incoming Clip B head waveform bars */}
                      {(activePair.clipB.waveform || []).slice(0, 32).map((bar, idx, arr) => {
                        const u = idx / Math.max(1, arr.length - 1);
                        const fadeMult = activePair.isEnabled
                          ? applyAudioFadeCurve(u, activePair.curve)
                          : 1;
                        const h = Math.max(3, bar * fadeMult * 78);
                        return (
                          <rect
                            key={`wb_${idx}`}
                            x={20 + u * 160}
                            y={50 - h / 2}
                            width={160 / Math.max(1, arr.length) * 0.65}
                            height={h}
                            fill="#f59e0b"
                            opacity={0.3}
                          />
                        );
                      })}

                      {/* Outgoing Fade-Out Curve (Clip A) */}
                      <polyline
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                        points={(() => {
                          const pts = ['0,12', '20,12'];
                          if (!activePair.isEnabled) {
                            pts.push('100,12', '100,92', '180,92');
                            return pts.join(' ');
                          }
                          for (let s = 0; s <= 24; s++) {
                            const u = s / 24;
                            const gain = applyAudioFadeCurve(1 - u, activePair.curve);
                            const x = 20 + u * 160;
                            const y = 92 - gain * 80;
                            pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
                          }
                          return pts.join(' ');
                        })()}
                      />

                      {/* Incoming Fade-In Curve (Clip B) */}
                      <polyline
                        fill="none"
                        stroke="#fbbf24"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                        points={(() => {
                          if (!activePair.isEnabled) {
                            return '20,92 100,92 100,12 200,12';
                          }
                          const pts: string[] = [];
                          for (let s = 0; s <= 24; s++) {
                            const u = s / 24;
                            const gain = applyAudioFadeCurve(u, activePair.curve);
                            const x = 20 + u * 160;
                            const y = 92 - gain * 80;
                            pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
                          }
                          pts.push('200,12');
                          return pts.join(' ');
                        })()}
                      />
                    </svg>
                    <div className="absolute top-1 left-2 flex items-center gap-2 text-[9px] font-mono-tabular pointer-events-none">
                      <span className="text-emerald-300">OUT: {activePair.clipA.name}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-amber-300">IN: {activePair.clipB.name}</span>
                    </div>
                    <div className="absolute top-1 right-2 text-[9px] font-mono-tabular text-slate-300 pointer-events-none">
                      {activePair.isEnabled
                        ? `${CROSSFADE_CURVE_META.find((m) => m.id === activePair.curve)?.label} · ${activePair.duration.toFixed(2)}s`
                        : 'Cut (Off)'}
                    </div>
                  </div>

                  {/* Curve Type Selector (Linear, Exponential, S-Curve) */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {CROSSFADE_CURVE_META.map((opt) => {
                      const active = activePair.isEnabled && activePair.curve === opt.id;
                      const pathD =
                        opt.id === 'linear'
                          ? 'M 2 18 L 28 2'
                          : opt.id === 'exp'
                            ? 'M 2 18 Q 18 18 28 2'
                            : 'M 2 18 C 12 18 18 2 28 2';
                      const pathOutD =
                        opt.id === 'linear'
                          ? 'M 2 2 L 28 18'
                          : opt.id === 'exp'
                            ? 'M 2 2 Q 12 18 28 18'
                            : 'M 2 2 C 12 2 18 18 28 18';
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            applyCrossfadeToPair(
                              activePair,
                              opt.id,
                              activePair.isEnabled ? activePair.duration : Math.max(0.5, activePair.overlapSec > 0.1 ? activePair.overlapSec : 1.0),
                              true,
                            )
                          }
                          className={`p-1.5 rounded border flex items-center gap-2 text-left cursor-pointer transition-colors ${
                            active
                              ? 'bg-emerald-50 dark:bg-emerald-600/20 border-emerald-500 dark:border-emerald-400 text-emerald-950 dark:text-white'
                              : 'bg-slate-50 dark:bg-[#11151e] border-slate-200 dark:border-[#242b38] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                          }`}
                        >
                          <svg viewBox="0 0 30 20" className="w-7 h-5 shrink-0">
                            <path d={pathOutD} fill="none" stroke="#10b981" strokeWidth="1.8" />
                            <path d={pathD} fill="none" stroke="#f59e0b" strokeWidth="1.8" />
                          </svg>
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold leading-tight">{opt.label}</p>
                            <p className="text-[9px] text-slate-500 dark:text-slate-400 truncate">{opt.sub}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Crossfade Duration Slider, Exact Input & Presets */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">Duration (s)</span>
                      <input
                        type="range"
                        min={0.1}
                        max={Math.max(0.5, Number(Math.min(5.0, activePair.clipA.duration * 0.85, activePair.clipB.duration * 0.85).toFixed(2)))}
                        step={0.05}
                        value={activePair.duration}
                        onChange={(e) => {
                          const commit = !xfadeCommittedRef.current;
                          xfadeCommittedRef.current = true;
                          applyCrossfadeToPair(activePair, activePair.curve, Number(e.target.value), true, commit);
                        }}
                        onPointerUp={() => {
                          xfadeCommittedRef.current = false;
                        }}
                        onPointerCancel={() => {
                          xfadeCommittedRef.current = false;
                        }}
                        onBlur={() => {
                          xfadeCommittedRef.current = false;
                        }}
                        className="studio-slider flex-1"
                      />
                      <input
                        type="number"
                        min={0.1}
                        max={5}
                        step={0.05}
                        value={activePair.duration}
                        onChange={(e) => {
                          const commit = !xfadeCommittedRef.current;
                          xfadeCommittedRef.current = true;
                          applyCrossfadeToPair(
                            activePair,
                            activePair.curve,
                            Number(e.target.value) || 0.5,
                            true,
                            commit,
                          );
                        }}
                        onBlur={() => {
                          xfadeCommittedRef.current = false;
                        }}
                        className="w-16 h-6 px-1.5 rounded bg-slate-50 dark:bg-[#11151e] border border-slate-300 dark:border-[#2a3140] font-mono-tabular text-[11px] text-slate-900 dark:text-slate-100 text-right"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      {[0.25, 0.75, 1.5, 3.0].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => applyCrossfadeToPair(activePair, activePair.curve, sec, true)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono-tabular border cursor-pointer ${
                            activePair.isEnabled && Math.abs(activePair.duration - sec) < 0.04
                              ? 'bg-emerald-50 dark:bg-emerald-600/25 border-emerald-500 dark:border-emerald-400 text-emerald-800 dark:text-emerald-100'
                              : 'bg-slate-50 dark:bg-[#12161f] border-slate-300 dark:border-[#262d3b] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                          }`}
                        >
                          {sec.toFixed(2)}s
                        </button>
                      ))}
                      {activePair.overlapSec > 0.08 && (
                        <button
                          type="button"
                          onClick={() =>
                            applyCrossfadeToPair(activePair, activePair.curve, activePair.overlapSec, true)
                          }
                          className="px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-600/20 dark:hover:bg-blue-600/35 border border-blue-400/60 dark:border-blue-500/40 text-[10px] text-blue-700 dark:text-blue-200 cursor-pointer"
                        >
                          Match Overlap ({activePair.overlapSec.toFixed(2)}s)
                        </button>
                      )}
                      {activePair.isEnabled && (
                        <button
                          type="button"
                          onClick={() => applyCrossfadeToPair(activePair, activePair.curve, 0, false)}
                          className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-red-50 dark:bg-[#151821] dark:hover:bg-red-900/30 border border-slate-300 dark:border-[#2a303d] text-[10px] text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-300 cursor-pointer"
                        >
                          Off (Cut)
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Right: VST Plugin Rack & EQ + ADR Dialogue Booth */}
      <aside className="w-full lg:w-[320px] shrink-0 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg flex flex-col overflow-hidden shadow-xs dark:shadow-none">
        <div className="px-3.5 py-2 border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#171b22] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              DSP / VST · {selectedTrack?.name || 'Track'}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">FFmpeg + Live</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
          {/* Channel 3-Band EQ & Dynamics */}
          {selectedTrack && (
            <section className="space-y-2 pb-3 border-b border-slate-200 dark:border-[#232832]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">Channel EQ & Dynamics</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => updateTrackDsp(selectedTrack.id, { compressorEnabled: !activeDsp.compressorEnabled })}
                    className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                      activeDsp.compressorEnabled
                        ? 'bg-blue-50 dark:bg-blue-600/25 border-blue-500 text-blue-700 dark:text-blue-200'
                        : 'bg-slate-50 dark:bg-[#0e1116] border-slate-300 dark:border-[#252b37] text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Comp
                  </button>
                  <button
                    type="button"
                    onClick={() => updateTrackDsp(selectedTrack.id, { limiterEnabled: !activeDsp.limiterEnabled })}
                    className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                      activeDsp.limiterEnabled
                        ? 'bg-emerald-50 dark:bg-emerald-600/25 border-emerald-500 text-emerald-700 dark:text-emerald-200'
                        : 'bg-slate-50 dark:bg-[#0e1116] border-slate-300 dark:border-[#252b37] text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Limiter
                  </button>
                  <button
                    type="button"
                    onClick={() => updateTrackDsp(selectedTrack.id, { normalizeEnabled: !activeDsp.normalizeEnabled })}
                    className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                      activeDsp.normalizeEnabled
                        ? 'bg-amber-50 dark:bg-amber-600/25 border-amber-500 dark:border-amber-400 text-amber-800 dark:text-amber-200'
                        : 'bg-slate-50 dark:bg-[#0e1116] border-slate-300 dark:border-[#252b37] text-slate-600 dark:text-slate-400'
                    }`}
                    title="Apply FFmpeg EBU R128 loudnorm normalization to clips on this track"
                  >
                    Norm
                  </button>
                </div>
              </div>
              {activeDsp.normalizeEnabled && (
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-amber-50 dark:bg-[#0e131b] border border-amber-300 dark:border-amber-500/30">
                  <span className="text-[10px] text-amber-800 dark:text-amber-200">Track Loudnorm Target</span>
                  <select
                    value={activeDsp.normalizeTargetLufs ?? -16}
                    onChange={(e) =>
                      updateTrackDsp(selectedTrack.id, { normalizeTargetLufs: Number(e.target.value) })
                    }
                    className="h-6 px-1.5 rounded bg-white dark:bg-[#090c11] border border-amber-300 dark:border-[#2a3140] text-[10px] font-mono-tabular text-slate-900 dark:text-slate-100"
                  >
                    <option value={-14}>-14 LUFS</option>
                    <option value={-16}>-16 LUFS</option>
                    <option value={-23}>-23 LUFS</option>
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                {(
                  [
                    ['Low (110 Hz)', 'eqLowDb'],
                    ['Mid (1.2 kHz)', 'eqMidDb'],
                    ['High (6.5 kHz)', 'eqHighDb'],
                  ] as const
                ).map(([lbl, key]) => (
                  <label key={key} className="flex items-center justify-between gap-2 text-[10px] text-slate-600 dark:text-slate-400">
                    <span>{lbl}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={0.5}
                        value={activeDsp[key]}
                        onChange={(e) => {
                          const commit = !dspCommittedRef.current;
                          dspCommittedRef.current = true;
                          updateTrackDsp(selectedTrack.id, { [key]: Number(e.target.value) }, commit);
                        }}
                        onPointerUp={() => {
                          dspCommittedRef.current = false;
                        }}
                        onPointerCancel={() => {
                          dspCommittedRef.current = false;
                        }}
                        onBlur={() => {
                          dspCommittedRef.current = false;
                        }}
                        className="studio-slider w-24"
                      />
                      <span className="font-mono-tabular w-10 text-right text-slate-800 dark:text-slate-200">
                        {activeDsp[key] > 0 ? `+${activeDsp[key]}` : activeDsp[key]}dB
                      </span>
                    </div>
                  </label>
                ))}
                <label className="flex items-center justify-between gap-2 text-[10px] text-slate-600 dark:text-slate-400">
                  <span>Reverb Send</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={0.8}
                      step={0.02}
                      value={activeDsp.reverbMix}
                      onChange={(e) => {
                        const commit = !dspCommittedRef.current;
                        dspCommittedRef.current = true;
                        updateTrackDsp(selectedTrack.id, { reverbMix: Number(e.target.value) }, commit);
                      }}
                      onPointerUp={() => {
                        dspCommittedRef.current = false;
                      }}
                      onPointerCancel={() => {
                        dspCommittedRef.current = false;
                      }}
                      onBlur={() => {
                        dspCommittedRef.current = false;
                      }}
                      className="studio-slider w-24"
                    />
                    <span className="font-mono-tabular w-10 text-right text-slate-800 dark:text-slate-200">
                      {Math.round(activeDsp.reverbMix * 100)}%
                    </span>
                  </div>
                </label>
              </div>
            </section>
          )}

          {/* VST Plugin Rack */}
          {selectedTrack && (
            <section className="space-y-2 pb-3 border-b border-slate-200 dark:border-[#232832]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">VST Plugin Rack</span>
                <span className="text-[10px] text-slate-500 font-mono-tabular">
                  {activeDsp.vstSlots?.length || 0} inserts
                </span>
              </div>
              <div className="flex gap-1.5">
                <select
                  value={selectedVstCatalogIdx}
                  onChange={(e) => setSelectedVstCatalogIdx(Number(e.target.value))}
                  className="flex-1 min-w-0 h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-[11px] text-slate-800 dark:text-slate-200"
                >
                  {VST_CATALOG.map((p, idx) => (
                    <option key={p.name} value={idx}>
                      {p.name} ({p.category})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addVstPlugin}
                  className="px-2.5 h-7 rounded bg-slate-100 hover:bg-blue-600 dark:bg-[#1d222b] dark:hover:bg-blue-600 border border-slate-300 dark:border-[#2c3442] text-slate-800 dark:text-slate-100 hover:text-white text-[11px] font-medium cursor-pointer"
                >
                  Insert
                </button>
              </div>
              <input
                type="text"
                value={scannedVstPath}
                onChange={(e) => setScannedVstPath(e.target.value)}
                title="Local VST3 Bridge Search Path"
                className="w-full h-6 px-2 rounded bg-slate-50 dark:bg-[#0b0e14] border border-slate-200 dark:border-[#222732] font-mono-tabular text-[10px] text-slate-600 dark:text-slate-400"
              />
              {(activeDsp.vstSlots || []).length > 0 && (
                <div className="space-y-1">
                  {activeDsp.vstSlots.map((slot) => (
                    <div
                      key={slot.id}
                      className={`p-1.5 rounded border flex items-center justify-between gap-2 ${
                        slot.bypassed
                          ? 'bg-slate-100 dark:bg-[#0d1016] border-slate-200 dark:border-[#212631] opacity-60'
                          : 'bg-slate-50 dark:bg-[#10141c] border-slate-300 dark:border-[#283142]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          updateTrackDsp(selectedTrack.id, {
                            vstSlots: activeDsp.vstSlots.map((s) =>
                              s.id === slot.id ? { ...s, bypassed: !s.bypassed } : s,
                            ),
                          })
                        }
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono-tabular border cursor-pointer ${
                          slot.bypassed
                            ? 'border-slate-400 dark:border-slate-600 text-slate-500 dark:text-slate-400'
                            : 'border-emerald-500/60 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {slot.bypassed ? 'BYP' : 'ON'}
                      </button>
                      <span className="text-[11px] text-slate-800 dark:text-slate-200 truncate flex-1">{slot.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateTrackDsp(selectedTrack.id, {
                            vstSlots: activeDsp.vstSlots.filter((s) => s.id !== slot.id),
                          })
                        }
                        className="text-slate-500 hover:text-red-500 dark:hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Automated Dialogue Replacement (ADR) Booth */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                ADR Booth (Automated Dialogue)
              </span>
              <span className="text-[10px] font-mono-tabular text-amber-600 dark:text-amber-300">
                Takes: {adrTakeCount}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5 text-[10px] text-slate-600 dark:text-slate-400">
                <span>Cue In (s)</span>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cueIn}
                    onChange={(e) => setCueIn(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] font-mono-tabular text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => setCueIn(Number(playhead.toFixed(2)))}
                    title="Set Cue In from playhead"
                    className="px-1.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1d222b] border border-slate-300 dark:border-[#2c3442] text-[10px] text-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    PH
                  </button>
                </div>
              </label>
              <label className="space-y-0.5 text-[10px] text-slate-600 dark:text-slate-400">
                <span>Duration (s)</span>
                <input
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={cueDuration}
                  onChange={(e) => setCueDuration(Math.max(0.5, Number(e.target.value) || 2))}
                  className="w-full h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] font-mono-tabular text-slate-900 dark:text-slate-100"
                />
              </label>
            </div>

            {adrPhase === 'countdown' && (
              <div className="py-2 rounded bg-amber-50 dark:bg-amber-500/15 border border-amber-400/60 dark:border-amber-500/40 text-center font-mono-tabular text-sm font-bold text-amber-800 dark:text-amber-200">
                CUE IN {countdownNum}...
              </div>
            )}
            {adrPhase === 'recording' && (
              <div className="py-2 rounded bg-red-50 dark:bg-red-600/20 border border-red-400/70 dark:border-red-500/60 text-center text-[11px] font-semibold text-red-700 dark:text-red-200">
                Recording Dialogue Take...
              </div>
            )}

            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">{adrNote}</p>

            <div className="flex items-center gap-1.5">
              {adrPhase === 'countdown' || adrPhase === 'recording' ? (
                <button
                  type="button"
                  onClick={stopAdrEarly}
                  className="flex-1 py-1.5 px-2.5 rounded bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Square className="w-3 h-3" />
                  <span>Stop ADR</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startAdrRecording}
                  className="flex-1 py-1.5 px-2.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>Record ADR Take</span>
                </button>
              )}
              {recordedBlob && (
                <button
                  type="button"
                  disabled={adrBusy}
                  onClick={handleCommitTake}
                  className="py-1.5 px-2.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold cursor-pointer"
                >
                  {adrBusy ? 'Saving...' : 'Commit to Track'}
                </button>
              )}
            </div>
            {recordedUrl && (
              <audio controls src={recordedUrl} className="w-full h-7 mt-1" />
            )}
          </section>
        </div>
      </aside>
    </div>
  );
};
