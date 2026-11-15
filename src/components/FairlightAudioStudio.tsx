import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
  DEFAULT_TRACK_AUDIO_DSP,
  TimelineClip,
  TimelineTrack,
  TrackAudioDsp,
  VstPluginSlot,
} from '../types/editor';
import { formatTimecode, uid } from '../utils/timelineMath';

interface FairlightAudioStudioProps {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  playhead: number;
  isPlaying: boolean;
  masterMuted: boolean;
  onTogglePlay: () => void;
  onToggleMasterMute: () => void;
  onUpdateTrack: (trackId: string, patch: Partial<TimelineTrack>) => void;
  onCreateAudioFolder: (name: string) => void;
  onAddAudioTrack: (folderId?: string) => void;
  onCommitAdrTake: (file: File, cueInSec: number, targetTrackId?: string) => Promise<void>;
}

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
  playhead,
  isPlaying,
  masterMuted,
  onTogglePlay,
  onToggleMasterMute,
  onUpdateTrack,
  onCreateAudioFolder,
  onAddAudioTrack,
  onCommitAdrTake,
}) => {
  const audioTracks = useMemo(() => tracks.filter((t) => t.kind === 'audio'), [tracks]);
  const folderTracks = useMemo(() => audioTracks.filter((t) => t.isFolder), [audioTracks]);
  const channelTracks = useMemo(() => audioTracks.filter((t) => !t.isFolder), [audioTracks]);

  const [selectedTrackId, setSelectedTrackId] = useState<string>(() => channelTracks[0]?.id || audioTracks[0]?.id || '');
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
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audioTracks.some((t) => t.id === selectedTrackId)) {
      setSelectedTrackId(channelTracks[0]?.id || audioTracks[0]?.id || '');
    }
  }, [audioTracks, channelTracks, selectedTrackId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

  const selectedTrack = audioTracks.find((t) => t.id === selectedTrackId) || audioTracks[0] || null;
  const activeDsp: TrackAudioDsp = selectedTrack?.audioDsp || DEFAULT_TRACK_AUDIO_DSP;

  const updateTrackDsp = (trackId: string, patch: Partial<TrackAudioDsp>) => {
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

  const computeMeterLevel = (trk: TimelineTrack): number => {
    const folder = trk.parentFolderId ? audioTracks.find((f) => f.id === trk.parentFolderId) : undefined;
    if (masterMuted || trk.muted || folder?.muted) return 0;
    const anySolo = audioTracks.some((t) => t.solo);
    if (anySolo && !trk.solo && !folder?.solo) return 0;

    const matching = clips.filter(
      (c) =>
        c.kind === 'audio' &&
        c.trackId === trk.id &&
        playhead >= c.startTime &&
        playhead <= c.startTime + c.duration,
    );
    if (matching.length === 0) return isPlaying ? 0.04 : 0.02;

    let energy = 0.25;
    for (const c of matching) {
      if (c.waveform && c.waveform.length > 0) {
        const rel = Math.max(0, Math.min(0.999, (playhead - c.startTime) / Math.max(0.1, c.duration)));
        const idx = Math.floor(rel * c.waveform.length);
        energy = Math.max(energy, c.waveform[idx] ?? 0.35);
      }
      energy *= c.volume;
    }
    const folderGain = folder ? folder.volume : 1;
    return Math.min(1, energy * trk.volume * folderGain);
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
        const rec = new MediaRecorder(stream);
        mediaRecorderRef.current = rec;
        const chunks: BlobPart[] = [];
        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const url = URL.createObjectURL(blob);
          setRecordedBlob(blob);
          setRecordedUrl(url);
          setAdrTakeCount((n) => n + 1);
          setAdrPhase('ready');
          setAdrNote('Take captured! Audition or commit directly to timeline.');
        };
        rec.start();
        window.setTimeout(() => {
          if (rec.state === 'recording') rec.stop();
        }, cueDuration * 1000);
      } catch {
        // Clean synthetic ADR slate fallback if browser mic is blocked
        window.setTimeout(() => {
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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
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
      <aside className="w-full lg:w-[270px] shrink-0 bg-[#14171d] border border-[#232832] rounded-lg flex flex-col overflow-hidden">
        <div className="px-3.5 py-2 border-b border-[#232832] bg-[#171b22] flex items-center justify-between">
          <span className="font-semibold text-slate-100">Folder-Track Hierarchy</span>
          <span className="text-[10px] font-mono-tabular text-slate-400">
            {folderTracks.length} buses · {channelTracks.length} ch
          </span>
        </div>

        <div className="p-3 border-b border-[#232832] space-y-2">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder Bus Name"
              className="flex-1 min-w-0 h-7 px-2 rounded bg-[#0e1116] border border-[#262c38] text-[11px] text-slate-100"
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
            className="w-full py-1.5 px-2.5 rounded bg-[#1d222b] hover:bg-[#262d39] border border-[#2c3442] text-slate-200 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3 text-emerald-400" />
            <span>Add Audio Track</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
          {folderTracks.map((folder) => {
            const children = channelTracks.filter((c) => c.parentFolderId === folder.id);
            const isSel = selectedTrack?.id === folder.id;
            return (
              <div key={folder.id} className="rounded border border-[#232832] bg-[#101318] overflow-hidden">
                <div
                  onClick={() => setSelectedTrackId(folder.id)}
                  className={`px-2 py-1.5 flex items-center justify-between gap-1 cursor-pointer ${
                    isSel ? 'bg-blue-600/20 text-white' : 'text-slate-200 hover:bg-[#171c25]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateTrack(folder.id, { collapsed: !folder.collapsed });
                    }}
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    {folder.collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  <span className="font-semibold truncate flex-1">{folder.name}</span>
                  <span className="text-[9px] font-mono-tabular text-slate-400">{children.length} trk</span>
                </div>
                {!folder.collapsed && children.length > 0 && (
                  <div className="pl-4 pr-1.5 pb-1.5 pt-1 space-y-1 border-t border-[#1e232d]">
                    {children.map((ch) => (
                      <div
                        key={ch.id}
                        onClick={() => setSelectedTrackId(ch.id)}
                        className={`px-2 py-1 rounded flex items-center justify-between gap-1 cursor-pointer text-[11px] ${
                          selectedTrack?.id === ch.id
                            ? 'bg-blue-600/25 text-blue-100'
                            : 'text-slate-300 hover:bg-[#191f29]'
                        }`}
                      >
                        <span className="truncate">{ch.name}</span>
                        <span className="text-[9px] font-mono-tabular text-slate-400">
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
                    ? 'bg-blue-600/15 border-blue-500 text-white'
                    : 'bg-[#101318] border-[#222732] text-slate-300 hover:border-slate-500'
                }`}
              >
                <span className="font-medium truncate">{ch.name}</span>
                {folderTracks.length > 0 && (
                  <select
                    value={ch.parentFolderId || ''}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onUpdateTrack(ch.id, { parentFolderId: e.target.value || undefined })
                    }
                    title="Assign track to folder bus"
                    className="h-5 px-1 rounded bg-[#0b0e14] border border-[#2a303d] text-[9px] text-slate-300 max-w-[92px]"
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

      {/* Center: Multi-Track Mixing Console */}
      <section className="flex-1 min-w-0 bg-[#14171d] border border-[#232832] rounded-lg flex flex-col overflow-hidden">
        <div className="px-3.5 py-2 border-b border-[#232832] bg-[#171b22] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-semibold text-slate-100">Fairlight Multi-Track Console</span>
            <span className="text-[11px] font-mono-tabular text-slate-400">
              {formatTimecode(playhead)} · 48 kHz Bus
            </span>
          </div>
          <div className="flex items-center gap-1.5">
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
                  ? 'bg-red-500/20 border-red-500 text-red-200'
                  : 'bg-[#101318] border-[#262c38] text-slate-300 hover:text-white'
              }`}
            >
              {masterMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              <span>{masterMuted ? 'Master Muted' : 'Master Live'}</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-x-auto p-3 flex items-stretch gap-2.5 bg-[#0c0e13]">
          {audioTracks.map((trk) => {
            const level = computeMeterLevel(trk);
            const dsp = trk.audioDsp || DEFAULT_TRACK_AUDIO_DSP;
            const isSel = selectedTrack?.id === trk.id;
            return (
              <div
                key={trk.id}
                onClick={() => setSelectedTrackId(trk.id)}
                className={`w-[132px] shrink-0 rounded-md border p-2.5 flex flex-col justify-between gap-2 cursor-pointer transition-colors ${
                  trk.isFolder
                    ? isSel
                      ? 'bg-[#172133] border-blue-400'
                      : 'bg-[#121823] border-[#293549]'
                    : isSel
                      ? 'bg-[#161c26] border-blue-400'
                      : 'bg-[#12151b] border-[#232832] hover:border-slate-500'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold text-slate-100 truncate">
                      {trk.name}
                    </span>
                    <span className="text-[9px] text-slate-500">
                      {trk.isFolder ? 'BUS' : 'TRK'}
                    </span>
                  </div>
                  <p className="text-[9px] font-mono-tabular text-slate-400 mt-0.5">
                    {(dsp.vstSlots || []).filter((s) => !s.bypassed).length} VST · {gainToDbLabel(trk.volume)}
                  </p>
                </div>

                {/* Vertical Meter + Gain Fader */}
                <div className="flex items-center justify-center gap-2 py-1">
                  <div className="w-3 h-28 rounded-sm bg-[#090b0f] border border-[#222834] p-0.5 flex flex-col justify-end overflow-hidden">
                    <div
                      style={{ height: `${Math.round(level * 100)}%` }}
                      className={`w-full rounded-xs transition-all duration-75 ${
                        level > 0.85
                          ? 'bg-red-500'
                          : level > 0.65
                            ? 'bg-amber-400'
                            : 'bg-emerald-400'
                      }`}
                    />
                  </div>
                  <div className="flex-1 flex flex-col items-center gap-1.5">
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.02}
                      value={trk.volume}
                      onChange={(e) => onUpdateTrack(trk.id, { volume: Number(e.target.value) })}
                      className="studio-slider w-20 -rotate-90 my-8"
                      title="Track Volume Fader"
                    />
                  </div>
                </div>

                {/* Mini 3-Band EQ readout + Mute / Solo */}
                <div className="space-y-1.5">
                  <div className="grid grid-cols-3 gap-1 text-[9px] font-mono-tabular text-center">
                    <div className="rounded bg-[#0d1016] py-0.5 border border-[#222732]">
                      <span className="text-slate-500 block">L</span>
                      <span className="text-slate-200">{dsp.eqLowDb > 0 ? `+${dsp.eqLowDb}` : dsp.eqLowDb}</span>
                    </div>
                    <div className="rounded bg-[#0d1016] py-0.5 border border-[#222732]">
                      <span className="text-slate-500 block">M</span>
                      <span className="text-slate-200">{dsp.eqMidDb > 0 ? `+${dsp.eqMidDb}` : dsp.eqMidDb}</span>
                    </div>
                    <div className="rounded bg-[#0d1016] py-0.5 border border-[#222732]">
                      <span className="text-slate-500 block">H</span>
                      <span className="text-slate-200">{dsp.eqHighDb > 0 ? `+${dsp.eqHighDb}` : dsp.eqHighDb}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateTrack(trk.id, { solo: !trk.solo });
                      }}
                      className={`flex-1 py-1 rounded text-[10px] font-bold cursor-pointer ${
                        trk.solo ? 'bg-amber-500 text-black' : 'bg-[#1a1f28] text-slate-400 hover:text-white'
                      }`}
                    >
                      S
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateTrack(trk.id, { muted: !trk.muted });
                      }}
                      className={`flex-1 py-1 rounded text-[10px] font-bold cursor-pointer ${
                        trk.muted ? 'bg-red-500/80 text-white' : 'bg-[#1a1f28] text-slate-400 hover:text-white'
                      }`}
                    >
                      M
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Right: VST Plugin Rack & EQ + ADR Dialogue Booth */}
      <aside className="w-full lg:w-[320px] shrink-0 bg-[#14171d] border border-[#232832] rounded-lg flex flex-col overflow-hidden">
        <div className="px-3.5 py-2 border-b border-[#232832] bg-[#171b22] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-semibold text-slate-100 truncate">
              DSP / VST · {selectedTrack?.name || 'Track'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400">FFmpeg + Live</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
          {/* Channel 3-Band EQ & Dynamics */}
          {selectedTrack && (
            <section className="space-y-2 pb-3 border-b border-[#232832]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-200">Channel EQ & Dynamics</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => updateTrackDsp(selectedTrack.id, { compressorEnabled: !activeDsp.compressorEnabled })}
                    className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                      activeDsp.compressorEnabled
                        ? 'bg-blue-600/25 border-blue-500 text-blue-200'
                        : 'bg-[#0e1116] border-[#252b37] text-slate-400'
                    }`}
                  >
                    Comp
                  </button>
                  <button
                    type="button"
                    onClick={() => updateTrackDsp(selectedTrack.id, { limiterEnabled: !activeDsp.limiterEnabled })}
                    className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                      activeDsp.limiterEnabled
                        ? 'bg-emerald-600/25 border-emerald-500 text-emerald-200'
                        : 'bg-[#0e1116] border-[#252b37] text-slate-400'
                    }`}
                  >
                    Limiter
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {(
                  [
                    ['Low (110 Hz)', 'eqLowDb'],
                    ['Mid (1.2 kHz)', 'eqMidDb'],
                    ['High (6.5 kHz)', 'eqHighDb'],
                  ] as const
                ).map(([lbl, key]) => (
                  <label key={key} className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                    <span>{lbl}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={0.5}
                        value={activeDsp[key]}
                        onChange={(e) => updateTrackDsp(selectedTrack.id, { [key]: Number(e.target.value) })}
                        className="studio-slider w-24"
                      />
                      <span className="font-mono-tabular w-10 text-right text-slate-200">
                        {activeDsp[key] > 0 ? `+${activeDsp[key]}` : activeDsp[key]}dB
                      </span>
                    </div>
                  </label>
                ))}
                <label className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                  <span>Reverb Send</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={0.8}
                      step={0.02}
                      value={activeDsp.reverbMix}
                      onChange={(e) => updateTrackDsp(selectedTrack.id, { reverbMix: Number(e.target.value) })}
                      className="studio-slider w-24"
                    />
                    <span className="font-mono-tabular w-10 text-right text-slate-200">
                      {Math.round(activeDsp.reverbMix * 100)}%
                    </span>
                  </div>
                </label>
              </div>
            </section>
          )}

          {/* VST Plugin Rack */}
          {selectedTrack && (
            <section className="space-y-2 pb-3 border-b border-[#232832]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-200">VST Plugin Rack</span>
                <span className="text-[10px] text-slate-500 font-mono-tabular">
                  {activeDsp.vstSlots?.length || 0} inserts
                </span>
              </div>
              <div className="flex gap-1.5">
                <select
                  value={selectedVstCatalogIdx}
                  onChange={(e) => setSelectedVstCatalogIdx(Number(e.target.value))}
                  className="flex-1 min-w-0 h-7 px-2 rounded bg-[#0e1116] border border-[#2a303d] text-[11px] text-slate-200"
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
                  className="px-2.5 h-7 rounded bg-[#1d222b] hover:bg-blue-600 border border-[#2c3442] text-slate-100 text-[11px] font-medium cursor-pointer"
                >
                  Insert
                </button>
              </div>
              <input
                type="text"
                value={scannedVstPath}
                onChange={(e) => setScannedVstPath(e.target.value)}
                title="Local VST3 Bridge Search Path"
                className="w-full h-6 px-2 rounded bg-[#0b0e14] border border-[#222732] font-mono-tabular text-[10px] text-slate-400"
              />
              {(activeDsp.vstSlots || []).length > 0 && (
                <div className="space-y-1">
                  {activeDsp.vstSlots.map((slot) => (
                    <div
                      key={slot.id}
                      className={`p-1.5 rounded border flex items-center justify-between gap-2 ${
                        slot.bypassed
                          ? 'bg-[#0d1016] border-[#212631] opacity-60'
                          : 'bg-[#10141c] border-[#283142]'
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
                            ? 'border-slate-600 text-slate-400'
                            : 'border-emerald-500/60 text-emerald-300'
                        }`}
                      >
                        {slot.bypassed ? 'BYP' : 'ON'}
                      </button>
                      <span className="text-[11px] text-slate-200 truncate flex-1">{slot.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateTrackDsp(selectedTrack.id, {
                            vstSlots: activeDsp.vstSlots.filter((s) => s.id !== slot.id),
                          })
                        }
                        className="text-slate-500 hover:text-red-400 cursor-pointer"
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
              <span className="text-[11px] font-semibold text-slate-200">
                ADR Booth (Automated Dialogue)
              </span>
              <span className="text-[10px] font-mono-tabular text-amber-300">
                Takes: {adrTakeCount}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5 text-[10px] text-slate-400">
                <span>Cue In (s)</span>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cueIn}
                    onChange={(e) => setCueIn(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full h-7 px-2 rounded bg-[#0e1116] border border-[#2a303d] font-mono-tabular text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => setCueIn(Number(playhead.toFixed(2)))}
                    title="Set Cue In from playhead"
                    className="px-1.5 rounded bg-[#1d222b] border border-[#2c3442] text-[10px] text-slate-200 cursor-pointer"
                  >
                    PH
                  </button>
                </div>
              </label>
              <label className="space-y-0.5 text-[10px] text-slate-400">
                <span>Duration (s)</span>
                <input
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={cueDuration}
                  onChange={(e) => setCueDuration(Math.max(0.5, Number(e.target.value) || 2))}
                  className="w-full h-7 px-2 rounded bg-[#0e1116] border border-[#2a303d] font-mono-tabular text-slate-100"
                />
              </label>
            </div>

            {adrPhase === 'countdown' && (
              <div className="py-2 rounded bg-amber-500/15 border border-amber-500/40 text-center font-mono-tabular text-sm font-bold text-amber-200">
                CUE IN {countdownNum}...
              </div>
            )}
            {adrPhase === 'recording' && (
              <div className="py-2 rounded bg-red-600/20 border border-red-500/60 text-center text-[11px] font-semibold text-red-200">
                Recording Dialogue Take...
              </div>
            )}

            <p className="text-[10px] text-slate-400 leading-snug">{adrNote}</p>

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
