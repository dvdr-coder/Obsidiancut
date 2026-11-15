import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Download, FolderOpen, Loader2, Moon, Save, Sun, Trash2 } from 'lucide-react';
import obsidianLogo from './assets/images/obsidian_cut_logo_1794556840933.jpg';
import { AutoModeBar } from './components/AutoModeBar';
import { ClipInspectorPanel } from './components/ClipInspectorPanel';
import { ExportModal } from './components/ExportModal';
import { FairlightAudioStudio } from './components/FairlightAudioStudio';
import { FusionVfxStudio } from './components/FusionVfxStudio';
import { MediaBin } from './components/MediaBin';
import { MultiMasterEditStudio } from './components/MultiMasterEditStudio';
import { PreviewCanvas } from './components/PreviewCanvas';
import { QuickRenderPage } from './components/QuickRenderPage';
import { TimelineEditor } from './components/TimelineEditor';
import { TransitionLibraryPanel } from './components/TransitionLibraryPanel';
import { TutorialModal } from './components/TutorialModal';
import {
  ColorGradeConfig,
  DEFAULT_COLOR_GRADE,
  DEFAULT_TRACK_AUDIO_DSP,
  ExportConfig,
  MediaAsset,
  NestedSequence,
  RenderJobStatus,
  TimelineClip,
  TimelineTrack,
  TitleSpec,
  TrackLayerRole,
  TransitionType,
  TrimMode,
} from './types/editor';
import {
  autoAssembleTimeline,
  AutoAssembleOptions,
  autoBuildQuickRenderTimeline,
  cloneClipKeyframes,
  cloneVolumeEnvelope,
  computeTimelineDuration,
  createClipFromAsset,
  createDefaultTracks,
  createTitleClip,
  extractTimelineRange,
  normalizeTimelineTransitions,
  nudgeClipRoll,
  nudgeClipSlip,
  QuickAutoSelectOptions,
  resolveFfmpegXfadeFilter,
  rippleDeleteClipFromList,
  splitClipAtTime,
  uid,
} from './utils/timelineMath';
import { renderTitleToExportPng } from './utils/titleRenderer';

type EditorMode = 'auto' | 'manual' | 'advanced' | 'quickrender';
type AdvancedSubTab = 'fusion' | 'fairlight' | 'multimaster' | 'transitions';

interface EditorSnapshot {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  colorGrade: ColorGradeConfig;
}

const MAX_HISTORY_SNAPSHOTS = 60;

export default function App() {
  const [mode, setMode] = useState<EditorMode>('auto');
  const [advancedTab, setAdvancedTab] = useState<AdvancedSubTab>('fusion');
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [tracks, setTracks] = useState<TimelineTrack[]>(() => createDefaultTracks());
  const [clips, setClips] = useState<TimelineClip[]>([]);

  const [playhead, setPlayhead] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [masterMuted, setMasterMuted] = useState<boolean>(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [gradeTargetAssetId, setGradeTargetAssetId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'clip' | 'grade'>('clip');
  const [gradeScope, setGradeScope] = useState<'picture' | 'master'>('picture');
  const [canvasTool, setCanvasTool] = useState<'resize' | 'crop'>('resize');
  const [trimMode, setTrimMode] = useState<TrimMode>('pointer');
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  const [nestedSequences, setNestedSequences] = useState<NestedSequence[]>([]);

  const [colorGrade, setColorGrade] = useState<ColorGradeConfig>(DEFAULT_COLOR_GRADE);
  const [bypassGrade, setBypassGrade] = useState<boolean>(false);

  const [exportConfig, setExportConfig] = useState<ExportConfig>({
    resolution: '1920x1080',
    fps: 30,
    format: 'mp4',
    speedProfile: 'veryfast',
    autoDownload: true,
    normalizeAudio: false,
    normalizeTargetLufs: -14,
  });
  const [exportModalOpen, setExportModalOpen] = useState<boolean>(false);
  const [tutorialOpen, setTutorialOpen] = useState<boolean>(false);
  const [rippleMode, setRippleMode] = useState<boolean>(false);
  const [freeformRoughCut, setFreeformRoughCut] = useState<boolean>(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return localStorage.getItem('obsidiancut_theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [logoFailed, setLogoFailed] = useState<boolean>(false);
  const [renderJob, setRenderJob] = useState<RenderJobStatus | null>(null);
  const autoDownloadedJobRef = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('obsidiancut_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const [uploading, setUploading] = useState<boolean>(false);
  const [loadingSample, setLoadingSample] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const toastTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);

  const notify = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 2400);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    };
  }, []);

  // Bounded immutable Undo/Redo stack
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const colorGradeRef = useRef(colorGrade);
  colorGradeRef.current = colorGrade;
  const historyPastRef = useRef<EditorSnapshot[]>([]);
  const historyFutureRef = useRef<EditorSnapshot[]>([]);
  const [historyDepth, setHistoryDepth] = useState({ past: 0, future: 0 });

  const commitHistory = () => {
    const snap: EditorSnapshot = {
      tracks: tracksRef.current,
      clips: clipsRef.current,
      colorGrade: colorGradeRef.current,
    };
    const nextPast = [...historyPastRef.current, snap].slice(-MAX_HISTORY_SNAPSHOTS);
    historyPastRef.current = nextPast;
    historyFutureRef.current = [];
    setHistoryDepth({ past: nextPast.length, future: 0 });
  };

  const handleUndo = () => {
    const past = historyPastRef.current;
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    const current: EditorSnapshot = {
      tracks: tracksRef.current,
      clips: clipsRef.current,
      colorGrade: colorGradeRef.current,
    };
    historyPastRef.current = past.slice(0, -1);
    historyFutureRef.current = [current, ...historyFutureRef.current].slice(0, MAX_HISTORY_SNAPSHOTS);
    setTracks(prev.tracks);
    setClips(prev.clips);
    setColorGrade(prev.colorGrade);
    setHistoryDepth({ past: historyPastRef.current.length, future: historyFutureRef.current.length });
    notify('Undid last change');
  };

  const handleRedo = () => {
    const future = historyFutureRef.current;
    if (future.length === 0) return;
    const next = future[0];
    const current: EditorSnapshot = {
      tracks: tracksRef.current,
      clips: clipsRef.current,
      colorGrade: colorGradeRef.current,
    };
    historyPastRef.current = [...historyPastRef.current, current].slice(-MAX_HISTORY_SNAPSHOTS);
    historyFutureRef.current = future.slice(1);
    setTracks(next.tracks);
    setClips(next.clips);
    setColorGrade(next.colorGrade);
    setHistoryDepth({ past: historyPastRef.current.length, future: historyFutureRef.current.length });
    notify('Redid change');
  };

  const assetsMap = useMemo(() => {
    const map = new Map<string, MediaAsset>();
    for (const a of assets) map.set(a.id, a);
    return map;
  }, [assets]);

  const visualAssets = useMemo(
    () => assets.filter((a) => a.mediaType === 'image' || a.mediaType === 'video'),
    [assets],
  );
  const audioAssets = useMemo(
    () => assets.filter((a) => a.mediaType === 'audio'),
    [assets],
  );

  const totalDuration = useMemo(() => computeTimelineDuration(clips), [clips]);
  const selectedClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) || null,
    [clips, selectedClipId],
  );
  const selectedClipAsset = useMemo(
    () => (selectedClip?.mediaId ? assetsMap.get(selectedClip.mediaId) || null : null),
    [selectedClip, assetsMap],
  );
  const gradeTargetAsset = useMemo(
    () => (gradeTargetAssetId ? assetsMap.get(gradeTargetAssetId) || null : null),
    [gradeTargetAssetId, assetsMap],
  );

  // Load persisted workspace media on mount
  useEffect(() => {
    fetch('/api/media')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.assets) && data.assets.length > 0) {
          setAssets(data.assets);
        }
      })
      .catch(() => {});
  }, []);

  // Poll background render job and auto-download when complete
  useEffect(() => {
    if (!renderJob || (renderJob.status !== 'queued' && renderJob.status !== 'rendering')) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/render/${encodeURIComponent(renderJob.jobId)}`);
        if (!res.ok) return;
        const nextJob = (await res.json()) as RenderJobStatus;
        setRenderJob(nextJob);

        if (
          nextJob.status === 'completed' &&
          exportConfig.autoDownload &&
          autoDownloadedJobRef.current !== nextJob.jobId
        ) {
          autoDownloadedJobRef.current = nextJob.jobId;
          const a = document.createElement('a');
          a.href = `/api/render/${nextJob.jobId}/download`;
          a.download = nextJob.outputName || `obsidiancut_export.${exportConfig.format}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      } catch {
        // transient network error; continue polling
      }
    }, 650);

    return () => window.clearInterval(timer);
  }, [renderJob?.jobId, renderJob?.status, exportConfig.autoDownload, exportConfig.format]);

  const handleSplitAtPlayhead = () => {
    const target =
      (selectedClip &&
      playhead > selectedClip.startTime + 0.15 &&
      playhead < selectedClip.startTime + selectedClip.duration - 0.15
        ? selectedClip
        : clips.find(
            (c) => playhead > c.startTime + 0.15 && playhead < c.startTime + c.duration - 0.15,
          )) || null;
    if (!target) {
      notify('Move the playhead inside a clip to split it');
      return;
    }
    const parts = splitClipAtTime(target, playhead);
    if (!parts) return;
    commitHistory();
    setClips((prev) => prev.flatMap((c) => (c.id === target.id ? parts : [c])));
    setSelectedClipId(parts[1].id);
    notify(`Split "${target.name}" at playhead`);
  };

  const handleDuplicateClip = (id: string) => {
    const target = clips.find((c) => c.id === id);
    if (!target) return;
    commitHistory();
    const copy: TimelineClip = {
      ...target,
      id: uid('cl'),
      name: `${target.name} (Copy)`,
      startTime: Number((target.startTime + target.duration).toFixed(3)),
      effects: { ...target.effects },
      crop: target.crop ? { ...target.crop } : undefined,
      colorGrade: target.colorGrade ? { ...target.colorGrade } : undefined,
      title: target.title ? { ...target.title } : undefined,
      fusion: target.fusion
        ? {
            ...target.fusion,
            rotoscopePoints: target.fusion.rotoscopePoints.map((p) => ({ ...p })),
          }
        : undefined,
      keyframes: cloneClipKeyframes(target.keyframes),
      volumeEnvelope: cloneVolumeEnvelope(target.volumeEnvelope),
    };
    setClips((prev) => [...prev, copy]);
    setSelectedClipId(copy.id);
    notify(`Duplicated "${target.name}"`);
  };

  // Keyboard shortcuts: Space, ,/./Arrows, S split, Ctrl+D duplicate, Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y, Delete/Backspace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedClipId) {
        e.preventDefault();
        handleDuplicateClip(selectedClipId);
      } else if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === ',' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        const dt = 1 / exportConfig.fps;
        setPlayhead((t) => Math.max(0, Math.round((t - dt) * exportConfig.fps) / exportConfig.fps));
      } else if (e.key === '.' || e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        const dt = 1 / exportConfig.fps;
        setPlayhead((t) =>
          Math.min(totalDuration, Math.round((t + dt) * exportConfig.fps) / exportConfig.fps),
        );
      } else if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setMarkIn(Number(playhead.toFixed(3)));
        notify(`Marked In at ${playhead.toFixed(2)}s`);
      } else if (e.key.toLowerCase() === 'o' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setMarkOut(Number(playhead.toFixed(3)));
        notify(`Marked Out at ${playhead.toFixed(2)}s`);
      } else if (e.key.toLowerCase() === 'j' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setIsPlaying(false);
        const step = 5 / exportConfig.fps;
        setPlayhead((t) => Math.max(0, Number((t - step).toFixed(3))));
      } else if (e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setIsPlaying(false);
      } else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (isPlaying) {
          const step = 5 / exportConfig.fps;
          setPlayhead((t) => Math.min(totalDuration, Number((t + step).toFixed(3))));
        } else {
          setIsPlaying(true);
        }
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSplitAtPlayhead();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        e.preventDefault();
        commitHistory();
        setClips((prev) =>
          rippleMode
            ? rippleDeleteClipFromList(prev, selectedClipId)
            : prev.filter((c) => c.id !== selectedClipId),
        );
        setSelectedClipId(null);
        notify(rippleMode ? 'Ripple deleted clip' : 'Removed clip');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exportConfig.fps, totalDuration, selectedClipId, playhead, clips, rippleMode, isPlaying]);

  const handleUploadFiles = async (fileList: FileList | File[]) => {
    const form = new FormData();
    const files = Array.from(fileList);
    if (files.length === 0) return;
    for (const f of files) form.append('files', f);

    setUploading(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/media/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const added: MediaAsset[] = data.assets || [];
      const rejected: { name: string; reason: string }[] = data.rejected || [];
      setAssets((prev) => [...prev, ...added]);
      if (rejected.length > 0) {
        setErrorBanner(
          `Skipped ${rejected.map((r) => `${r.name} (${r.reason})`).join(', ')}`,
        );
      }
      if (added.length > 0) {
        notify(`Added ${added.length} asset${added.length === 1 ? '' : 's'} to Media Assets`);
      }
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleLoadSamplePack = async () => {
    setLoadingSample(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/sample-pack', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load sample pack');
      const added: MediaAsset[] = data.assets || [];
      setAssets((prev) => [...prev, ...added]);

      if (clips.length === 0) {
        const visuals = added.filter((a) => a.mediaType !== 'audio');
        const song = added.find((a) => a.mediaType === 'audio') || null;
        const mainVTrack = tracks.find((t) => t.id === 'trk_v1') || tracks.find((t) => t.kind === 'video');
        const mainATrack = tracks.find((t) => t.kind === 'audio');
        const assembled = autoAssembleTimeline(
          visuals,
          song,
          {
            beatStride: 2,
            transitionStyle: 'dynamic',
            transitionDuration: 0.4,
            enableMotion: true,
            maxSongDuration: 16,
          },
          mainVTrack?.id || 'trk_v1',
          mainATrack?.id || 'trk_a1',
        );
        setClips(assembled.clips);
        setPlayhead(0);
        notify('Sample pack loaded & synced to 120 BPM');
      } else {
        notify('Sample media added to Media Bin');
      }
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setLoadingSample(false);
    }
  };

  const handleDeleteAsset = async (id: string) => {
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to delete media asset (${res.status})`);
      }
      commitHistory();
      setAssets((prev) => prev.filter((a) => a.id !== id));
      setClips((prev) => prev.filter((c) => c.mediaId !== id));
      notify('Media asset removed');
    } catch (err) {
      setErrorBanner((err as Error).message || 'Could not remove media asset');
    }
  };

  const addVisualToTimeline = (asset: MediaAsset, asOverlay = false) => {
    const videoTracks = tracks.filter((t) => t.kind === 'video');
    const targetTrack = asOverlay
      ? videoTracks.find((t) => t.layerRole === 'overlay') || videoTracks[0]
      : [...videoTracks].reverse().find((t) => t.layerRole !== 'overlay') || videoTracks[videoTracks.length - 1];
    if (!targetTrack) return;

    let startT = playhead;
    if (!asOverlay) {
      const existing = clips.filter((c) => c.trackId === targetTrack.id);
      startT = existing.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
    }
    commitHistory();
    const newClip = createClipFromAsset(asset, targetTrack.id, startT, asOverlay);
    setClips((prev) => [...prev, newClip]);
    setSelectedClipId(newClip.id);
    notify(asOverlay ? `Added "${asset.name}" as overlay` : `Added "${asset.name}" to timeline`);
  };

  const addAudioToTimeline = (asset: MediaAsset) => {
    const audioTrack = tracks.find((t) => t.kind === 'audio');
    if (!audioTrack) return;
    commitHistory();
    const newClip = createClipFromAsset(asset, audioTrack.id, 0, false);
    setClips((prev) => [...prev, newClip]);
    setSelectedClipId(newClip.id);
    notify(`Added audio "${asset.name}"`);
  };

  const addTitleClip = (spec: TitleSpec, duration: number) => {
    const topVideoTrack = tracks.find((t) => t.kind === 'video');
    if (!topVideoTrack) return;
    commitHistory();
    const newClip = createTitleClip(spec, topVideoTrack.id, playhead, duration);
    setClips((prev) => [...prev, newClip]);
    setSelectedClipId(newClip.id);
    notify('Title inserted at playhead');
  };

  const handleAutoAssemble = (audioId: string | null, options: AutoAssembleOptions) => {
    const song = audioId ? assetsMap.get(audioId) || null : null;
    const videoTracks = tracks.filter((t) => t.kind === 'video');
    const mainV = videoTracks[videoTracks.length - 1]?.id || 'trk_v1';
    const mainA = tracks.find((t) => t.kind === 'audio')?.id || 'trk_a1';
    const assembled = autoAssembleTimeline(visualAssets, song, options, mainV, mainA);

    commitHistory();
    // Preserve upper overlay/title tracks when re-assembling main V1 + A1
    const preservedOverlays = clips.filter((c) => c.trackId !== mainV && c.trackId !== mainA);
    setClips([...assembled.clips, ...preservedOverlays]);
    setPlayhead(0);
    setIsPlaying(true);
    notify(`Auto-assembled ${assembled.clips.length} clips`);
  };

  const handleOpenAssetColorGrade = (asset: MediaAsset) => {
    setGradeTargetAssetId(asset.id);
    setGradeScope('picture');
    setInspectorTab('grade');
    const existingClip = clips.find((c) => c.mediaId === asset.id);
    if (existingClip) {
      setSelectedClipId(existingClip.id);
      setIsPlaying(false);
      setPlayhead(Number((existingClip.startTime + Math.min(0.2, existingClip.duration * 0.25)).toFixed(3)));
    }
  };

  const handleChangeAssetColorGrade = (assetId: string, next: ColorGradeConfig) => {
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, colorGrade: next } : a)));
    setClips((prev) =>
      prev.map((c) => (c.mediaId === assetId ? { ...c, colorGrade: { ...next } } : c)),
    );
    fetch(`/api/media/${encodeURIComponent(assetId)}/color-grade`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colorGrade: next }),
    }).catch(() => {});
  };

  const handleSyncGradeToAssetClips = (assetId: string, grade: ColorGradeConfig) => {
    commitHistory();
    handleChangeAssetColorGrade(assetId, grade);
    notify('Applied color grade to all clips using this picture');
  };

  const handleSaveProject = () => {
    const normalizedClips = normalizeTimelineTransitions(clips);
    const assetColorGrades: Record<string, ColorGradeConfig> = {};
    for (const a of assets) {
      if (a.colorGrade) assetColorGrades[a.id] = a.colorGrade;
    }
    const payload = {
      version: 1,
      app: 'Obsidian Cut',
      savedAt: new Date().toISOString(),
      tracks,
      clips: normalizedClips,
      colorGrade,
      assetColorGrades,
      exportConfig,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `obsidiancut_project_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify('Project saved as JSON');
  };

  const handleLoadProjectFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.tracks) || !Array.isArray(parsed.clips)) {
        throw new Error('Invalid Obsidian Cut project JSON (missing tracks or clips)');
      }
      setIsPlaying(false);
      commitHistory();
      setTracks(parsed.tracks);
      setClips(parsed.clips);
      if (parsed.colorGrade) setColorGrade(parsed.colorGrade);
      if (parsed.assetColorGrades && typeof parsed.assetColorGrades === 'object') {
        setAssets((prev) =>
          prev.map((a) =>
            parsed.assetColorGrades[a.id] ? { ...a, colorGrade: parsed.assetColorGrades[a.id] } : a,
          ),
        );
      }
      if (parsed.exportConfig) setExportConfig(parsed.exportConfig);
      setPlayhead(0);
      setSelectedClipId(null);
      notify(`Loaded "${file.name}"`);
    } catch (err) {
      setErrorBanner((err as Error).message || 'Could not load project file');
    }
  };

  const handleClearTimeline = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = window.setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    setConfirmClear(false);
    setIsPlaying(false);
    commitHistory();
    setClips([]);
    setPlayhead(0);
    setSelectedClipId(null);
    notify('Timeline cleared (Ctrl+Z to undo)');
  };

  const buildNewTrack = (kind: 'video' | 'audio', currentTracks: TimelineTrack[], parentFolderId?: string, layerRole?: TrackLayerRole): TimelineTrack => {
    const role: TrackLayerRole = layerRole || (kind === 'audio' ? 'audio' : 'video');
    const roleCount =
      role === 'overlay'
        ? currentTracks.filter((t) => t.kind === 'video' && t.layerRole === 'overlay').length + 1
        : role === 'video'
          ? currentTracks.filter((t) => t.kind === 'video' && t.layerRole !== 'overlay').length + 1
          : currentTracks.filter((t) => t.kind === 'audio' && !t.isFolder).length + 1;
    const name =
      role === 'overlay'
        ? `OV${roleCount} Overlay`
        : role === 'video'
          ? `V${roleCount} Layer`
          : `A${roleCount} Audio`;
    return {
      id: uid('trk'),
      name,
      kind,
      layerRole: role,
      muted: false,
      solo: false,
      hidden: false,
      volume: 1,
      parentFolderId,
      audioDsp: kind === 'audio' ? { ...DEFAULT_TRACK_AUDIO_DSP, vstSlots: [] } : undefined,
    };
  };

  const handleAddTrack = (kind: 'video' | 'audio', parentFolderId?: string, layerRole?: TrackLayerRole) => {
    commitHistory();
    const role: TrackLayerRole = layerRole || (kind === 'audio' ? 'audio' : 'video');
    const newTrack = buildNewTrack(kind, tracks, parentFolderId, role);
    setTracks((prev) => {
      if (role === 'overlay') {
        return [newTrack, ...prev];
      }
      if (kind === 'video') {
        // Place new video tracks right below existing overlay layers and above base video/audio tracks
        const firstVideoOrAudioIdx = prev.findIndex((t) => t.kind === 'audio' || t.layerRole !== 'overlay');
        if (firstVideoOrAudioIdx === -1) return [...prev, newTrack];
        const next = [...prev];
        next.splice(firstVideoOrAudioIdx, 0, newTrack);
        return next;
      }
      return [...prev, newTrack];
    });
    notify(`Stacked ${newTrack.name}`);
  };

  const handleMoveTrack = (trackId: string, direction: 'up' | 'down') => {
    const idx = tracks.findIndex((t) => t.id === trackId);
    if (idx === -1) return;
    const target = tracks[idx];
    const step = direction === 'up' ? -1 : 1;
    let swapIdx = idx + step;
    while (swapIdx >= 0 && swapIdx < tracks.length) {
      if (tracks[swapIdx].kind === target.kind && !tracks[swapIdx].isFolder) {
        break;
      }
      swapIdx += step;
    }
    if (swapIdx < 0 || swapIdx >= tracks.length) return;
    commitHistory();
    setTracks((prev) => {
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[swapIdx];
      next[swapIdx] = temp;
      return next;
    });
  };

  const handleCreateAudioFolder = (name: string) => {
    commitHistory();
    const folder: TimelineTrack = {
      id: uid('fld'),
      name,
      kind: 'audio',
      muted: false,
      solo: false,
      hidden: false,
      volume: 1,
      isFolder: true,
      collapsed: false,
      audioDsp: { ...DEFAULT_TRACK_AUDIO_DSP, vstSlots: [] },
    };
    setTracks((prev) => [...prev, folder]);
    notify(`Created Audio Folder Bus "${name}"`);
  };

  const handleApplyTransition = (type: TransitionType, duration: number, shouldCommit = true) => {
    if (!selectedClip) return;
    if (shouldCommit) commitHistory();
    const d = type === 'cut' ? 0 : Number(Math.max(0.1, duration).toFixed(2));
    handleUpdateClip(selectedClip.id, {
      transitionOut: type,
      transitionDuration: d,
      transition: {
        type,
        duration: d,
        targetClipId: selectedClip.transition?.targetClipId ?? null,
        overlapSec: selectedClip.transition?.overlapSec ?? 0,
        ffmpegFilter: resolveFfmpegXfadeFilter(type),
      },
    });
    if (shouldCommit) {
      notify(`Applied ${type} transition to "${selectedClip.name}"`);
    }
  };

  const handleApplyTransitionToAll = (type: TransitionType, duration: number) => {
    commitHistory();
    const d = type === 'cut' ? 0 : Number(Math.max(0.1, duration).toFixed(2));
    setClips((prev) =>
      normalizeTimelineTransitions(
        prev.map((c) =>
          c.kind === 'image' || c.kind === 'video'
            ? {
                ...c,
                transitionOut: type,
                transitionDuration: d,
              }
            : c,
        ),
      ),
    );
    notify(`Applied ${type} transition across all visual clips`);
  };

  const handleNudgeTrim = (clipAId: string, clipBId: string | null, deltaFrames: number) => {
    const dt = deltaFrames / Math.max(1, exportConfig.fps);
    commitHistory();
    if (trimMode === 'slip') {
      setClips((prev) => nudgeClipSlip(prev, clipAId, dt));
      notify(`Slipped source in-point by ${deltaFrames}f`);
    } else if (trimMode === 'roll' && clipBId) {
      setClips((prev) => nudgeClipRoll(prev, clipAId, clipBId, dt));
      notify(`Rolled A/B cut point by ${deltaFrames}f`);
    } else {
      setClips((prev) =>
        normalizeTimelineTransitions(
          prev.map((c) =>
            c.id === clipAId ? { ...c, duration: Number(Math.max(0.25, c.duration + dt).toFixed(3)) } : c,
          ),
        ),
      );
      notify(`Trimmed clip out-point by ${deltaFrames}f`);
    }
  };

  const handleExtractInOutRange = () => {
    if (markIn === null || markOut === null) return;
    commitHistory();
    setClips((prev) => extractTimelineRange(prev, markIn, markOut, true));
    setPlayhead(Math.min(markIn, markOut));
    setMarkIn(null);
    setMarkOut(null);
    notify('Extracted In/Out range with ripple close');
  };

  const uploadSingleGeneratedFile = async (file: File): Promise<MediaAsset | null> => {
    const form = new FormData();
    form.append('files', file);
    const res = await fetch('/api/media/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.assets) || data.assets.length === 0) {
      throw new Error(data.error || 'Failed to upload generated asset');
    }
    const created: MediaAsset = data.assets[0];
    setAssets((prev) => [...prev, created]);
    return created;
  };

  const handleCommitAdrTake = async (file: File, cueInSec: number, targetTrackId?: string) => {
    try {
      const asset = await uploadSingleGeneratedFile(file);
      if (!asset) return;
      const audioTrack =
        (targetTrackId && tracks.find((t) => t.id === targetTrackId && !t.isFolder)) ||
        tracks.find((t) => t.kind === 'audio' && !t.isFolder);
      if (!audioTrack) return;
      commitHistory();
      const clip = createClipFromAsset(asset, audioTrack.id, cueInSec, false);
      setClips((prev) => [...prev, clip]);
      setSelectedClipId(clip.id);
      notify(`Committed ADR take onto ${audioTrack.name}`);
    } catch (err) {
      setErrorBanner((err as Error).message);
    }
  };

  const handleInsertBakedOverlay = async (pngDataUrl: string, label: string, duration: number) => {
    try {
      const blob = await (await fetch(pngDataUrl)).blob();
      const safeSlug = label.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 32);
      const file = new File([blob], `${safeSlug}.png`, { type: 'image/png' });
      const asset = await uploadSingleGeneratedFile(file);
      if (!asset) return;
      const topVideo = tracks.find((t) => t.kind === 'video');
      if (!topVideo) return;
      commitHistory();
      const clip = createClipFromAsset(asset, topVideo.id, playhead, true);
      clip.name = label;
      clip.duration = duration;
      clip.x = 0;
      clip.y = 0;
      clip.scale = 1;
      clip.fit = 'contain';
      setClips((prev) => [...prev, clip]);
      setSelectedClipId(clip.id);
      notify(`Inserted "${label}" onto ${topVideo.name}`);
    } catch (err) {
      setErrorBanner((err as Error).message);
    }
  };

  const handleCreateNestedSequence = (name: string) => {
    const seq: NestedSequence = {
      id: uid('seq'),
      name,
      createdAt: new Date().toISOString(),
      tracks: tracks.map((t) => ({
        ...t,
        audioDsp: t.audioDsp
          ? { ...t.audioDsp, vstSlots: (t.audioDsp.vstSlots || []).map((s) => ({ ...s })) }
          : undefined,
      })),
      clips: clips.map((c) => ({
        ...c,
        effects: { ...c.effects },
        crop: c.crop ? { ...c.crop } : undefined,
        colorGrade: c.colorGrade ? { ...c.colorGrade } : undefined,
        title: c.title ? { ...c.title } : undefined,
        fusion: c.fusion
          ? {
              ...c.fusion,
              rotoscopePoints: c.fusion.rotoscopePoints.map((p) => ({ ...p })),
            }
          : undefined,
        keyframes: cloneClipKeyframes(c.keyframes),
        volumeEnvelope: cloneVolumeEnvelope(c.volumeEnvelope),
      })),
    };
    setNestedSequences((prev) => [seq, ...prev]);
    notify(`Saved nested timeline "${name}"`);
  };

  const handleLoadNestedSequence = (seqId: string) => {
    const found = nestedSequences.find((s) => s.id === seqId);
    if (!found) return;
    commitHistory();
    setTracks(
      found.tracks.map((t) => ({
        ...t,
        audioDsp: t.audioDsp
          ? { ...t.audioDsp, vstSlots: (t.audioDsp.vstSlots || []).map((s) => ({ ...s })) }
          : undefined,
      })),
    );
    setClips(
      found.clips.map((c) => ({
        ...c,
        effects: { ...c.effects },
        crop: c.crop ? { ...c.crop } : undefined,
        colorGrade: c.colorGrade ? { ...c.colorGrade } : undefined,
        title: c.title ? { ...c.title } : undefined,
        fusion: c.fusion
          ? {
              ...c.fusion,
              rotoscopePoints: c.fusion.rotoscopePoints.map((p) => ({ ...p })),
            }
          : undefined,
        keyframes: cloneClipKeyframes(c.keyframes),
        volumeEnvelope: cloneVolumeEnvelope(c.volumeEnvelope),
      })),
    );
    setPlayhead(0);
    setSelectedClipId(null);
    notify(`Loaded nested timeline "${found.name}"`);
  };

  const handleSwitchMulticamAngle = (asset: MediaAsset, camNumber: number) => {
    const mainV =
      tracks.filter((t) => t.kind === 'video').slice(-1)[0] || tracks.find((t) => t.kind === 'video');
    if (!mainV) return;
    commitHistory();
    const clip = createClipFromAsset(asset, mainV.id, playhead, false);
    clip.name = `CAM ${camNumber} · ${asset.name}`;
    clip.duration = Math.min(clip.duration, 2.5);
    setClips((prev) => [...prev, clip]);
    setSelectedClipId(clip.id);
    notify(`Cut to CAM ${camNumber} at ${playhead.toFixed(2)}s`);
  };

  const handleUpdateTrack = (trackId: string, patch: Partial<TimelineTrack>) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...patch } : t)));
  };

  const handleDeleteTrack = (trackId: string) => {
    commitHistory();
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    setClips((prev) => prev.filter((c) => c.trackId !== trackId));
  };

  const handleUpdateClip = (id: string, patch: Partial<TimelineClip>) => {
    setClips((prev) =>
      normalizeTimelineTransitions(prev.map((c) => (c.id === id ? { ...c, ...patch } : c))),
    );
  };

  const handleDeleteClip = (id: string) => {
    commitHistory();
    setClips((prev) =>
      rippleMode ? rippleDeleteClipFromList(prev, id) : prev.filter((c) => c.id !== id),
    );
    if (selectedClipId === id) setSelectedClipId(null);
    notify(rippleMode ? 'Ripple deleted clip' : 'Removed clip');
  };

  const handleDropAssetOnTrack = (asset: MediaAsset, trackId: string, startTime: number) => {
    commitHistory();
    const trk = tracks.find((t) => t.id === trackId);
    const videoTracks = tracks.filter((t) => t.kind === 'video');
    const isOverlay = Boolean(
      trk &&
        trk.kind === 'video' &&
        (trk.layerRole === 'overlay' || (videoTracks.indexOf(trk) === 0 && videoTracks.length > 1 && trk.layerRole !== 'video')),
    );
    const clip = createClipFromAsset(asset, trackId, startTime, isOverlay);
    setClips((prev) => [...prev, clip]);
    setSelectedClipId(clip.id);
    notify(`Placed "${asset.name}" on ${trk?.name || 'track'}`);
  };

  const handleDropAssetCreateTrack = (asset: MediaAsset, role: TrackLayerRole, startTime: number) => {
    commitHistory();
    const kind: 'video' | 'audio' = role === 'audio' ? 'audio' : 'video';
    const newTrack = buildNewTrack(kind, tracks, undefined, role);
    setTracks((prev) => {
      if (role === 'overlay') {
        return [newTrack, ...prev];
      }
      if (kind === 'video') {
        const firstVideoOrAudioIdx = prev.findIndex((t) => t.kind === 'audio' || t.layerRole !== 'overlay');
        if (firstVideoOrAudioIdx === -1) return [...prev, newTrack];
        const next = [...prev];
        next.splice(firstVideoOrAudioIdx, 0, newTrack);
        return next;
      }
      return [...prev, newTrack];
    });
    const clip = createClipFromAsset(asset, newTrack.id, startTime, role === 'overlay');
    setClips((prev) => [...prev, clip]);
    setSelectedClipId(clip.id);
    notify(`Stacked ${newTrack.name} with "${asset.name}"`);
  };

  const enqueueRender = async (clipsToRender: TimelineClip[], cfgToRender: ExportConfig) => {
    if (clipsToRender.length === 0) return;
    setErrorBanner(null);
    autoDownloadedJobRef.current = null;

    // Pre-render crisp alpha PNGs for any vector title / scrolling credits clips at export resolution
    const [expW, expH] = cfgToRender.resolution.split('x').map(Number);
    const preparedClips = clipsToRender.map((c) => {
      if (c.kind === 'title' && c.title) {
        const rendered = renderTitleToExportPng(c.title, expW, expH);
        return {
          ...c,
          renderedOverlayPng: rendered.dataUrl,
          renderedOverlayHeight: rendered.outHeight,
        };
      }
      return c;
    });

    const normalizedClips = normalizeTimelineTransitions(preparedClips);

    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracks,
          clips: normalizedClips,
          colorGrade,
          export: cfgToRender,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to enqueue render');
      setRenderJob({ jobId: data.jobId, status: 'queued', progress: 0 });
    } catch (err) {
      setErrorBanner((err as Error).message);
    }
  };

  const handleStartRender = async () => {
    await enqueueRender(clips, exportConfig);
  };

  const handleAutoSelectQuickRender = async (
    opts: QuickAutoSelectOptions,
    renderNow = false,
  ) => {
    setErrorBanner(null);
    let sourceAssets = assets;
    if (sourceAssets.length === 0) {
      setLoadingSample(true);
      try {
        const res = await fetch('/api/sample-pack', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load sample media');
        const loaded: MediaAsset[] = data.assets || [];
        sourceAssets = loaded;
        setAssets(loaded);
      } catch (err) {
        setErrorBanner((err as Error).message);
        setLoadingSample(false);
        return;
      } finally {
        setLoadingSample(false);
      }
    }

    const videoTracks = tracks.filter((t) => t.kind === 'video');
    const mainV = videoTracks[videoTracks.length - 1]?.id || 'trk_v1';
    const mainA = tracks.find((t) => t.kind === 'audio' && !t.isFolder)?.id || 'trk_a1';
    const built = autoBuildQuickRenderTimeline(sourceAssets, opts, mainV, mainA);

    if (built.clips.length === 0) {
      notify('Upload photos, videos, or music to auto-assemble');
      return;
    }

    commitHistory();
    setClips(built.clips);
    setSelectedClipId(built.clips[0]?.id || null);
    setPlayhead(0);
    setMasterMuted(false);

    const nextExportCfg: ExportConfig = {
      ...exportConfig,
      normalizeAudio: opts.autoNormalize,
      normalizeTargetLufs: opts.targetLufs,
    };
    setExportConfig(nextExportCfg);

    if (renderNow) {
      setIsPlaying(false);
      notify(
        `Auto-built ${built.visualCount} clips${built.selectedAudioName ? ` + "${built.selectedAudioName}"` : ''} — starting render`,
      );
      await enqueueRender(built.clips, nextExportCfg);
    } else {
      setIsPlaying(true);
      notify(
        `Auto-selected ${built.visualCount} clips${built.selectedAudioName ? ` + music "${built.selectedAudioName}"` : ''} — playing now`,
      );
    }
  };

  const isBackgroundRendering =
    !exportModalOpen &&
    mode !== 'quickrender' &&
    renderJob &&
    (renderJob.status === 'queued' || renderJob.status === 'rendering');

  return (
    <div className="min-h-screen flex flex-col bg-[#f1f5f9] dark:bg-[#0d0f12] text-slate-900 dark:text-slate-100">
      {/* Three-Zone Top Bar */}
      <header className="h-[52px] px-5 border-b border-slate-200 dark:border-[#222732] bg-white dark:bg-[#12151a] flex items-center justify-between gap-6 shrink-0">
        <a
          href="/"
          className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 dark:text-white font-display whitespace-nowrap shrink-0"
        >
          {!logoFailed ? (
            <img
              src={obsidianLogo}
              alt="Obsidian Cut"
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
              className="w-7 h-7 rounded object-cover border border-slate-300 dark:border-[#2c3340] shrink-0"
            />
          ) : (
            <span className="w-7 h-7 rounded bg-gradient-to-br from-blue-500 to-slate-800 border border-blue-400/50 flex items-center justify-center text-xs font-bold text-white shrink-0">
              OC
            </span>
          )}
          <span>Obsidian Cut</span>
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setMode('auto')}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'auto'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-blue-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Auto Sync
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'manual'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-blue-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Endless Workspace
          </button>
          <button
            type="button"
            onClick={() => setMode('advanced')}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'advanced'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-blue-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Advanced Studio
          </button>
          <button
            type="button"
            onClick={() => setMode('quickrender')}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'quickrender'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-emerald-500 dark:decoration-emerald-400'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Quick Render
          </button>
          <button
            type="button"
            onClick={() => setTutorialOpen(true)}
            className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
          >
            <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Tutorial</span>
          </button>
          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Export Settings
          </button>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Switch to Light mode' : 'Switch to Dark mode'}
            title={theme === 'dark' ? 'Switch to Light mode' : 'Switch to Dark mode'}
            className="px-2.5 py-1.5 rounded bg-slate-100 dark:bg-[#1a1e26] hover:bg-slate-200 dark:hover:bg-[#232934] border border-slate-300 dark:border-[#2c3340] text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Light</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-blue-600" />
                <span className="hidden sm:inline">Dark</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            disabled={clips.length === 0}
            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export HD</span>
          </button>
        </div>
      </header>

      {errorBanner && (
        <div className="px-5 py-2 bg-red-50 dark:bg-red-950/60 border-b border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-200 flex items-center justify-between">
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-red-700 dark:text-red-300 hover:text-red-950 dark:hover:text-white underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {isBackgroundRendering && (
        <div className="px-5 py-2 bg-blue-50 dark:bg-[#111926] border-b border-blue-200 dark:border-blue-800/50 text-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-blue-900 dark:text-blue-200">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 dark:text-blue-400" />
            <span>
              Background HD render running ({renderJob.progress}%
              {renderJob.speed ? ` · ${renderJob.speed}` : ''}) — file will auto-download when done.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            className="text-blue-700 dark:text-blue-300 hover:text-blue-950 dark:hover:text-white font-medium whitespace-nowrap"
          >
            View Progress
          </button>
        </div>
      )}

      <main className="flex-1 p-3 flex flex-col gap-3 min-h-0">
        {/* Workspace Mode Switcher + Project Utilities + Auto Studio Controls */}
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 p-1 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-md">
                <button
                  type="button"
                  onClick={() => setMode('auto')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    mode === 'auto'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Auto Mode (Beat Sync)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('manual')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    mode === 'manual'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Endless Workspace (Boundless Tracks)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('advanced')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    mode === 'advanced'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Advanced Mode (Fusion · Fairlight · MultiMaster)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('quickrender')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    mode === 'quickrender'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Quick Render
                </button>
              </div>
              <button
                type="button"
                onClick={() => setTutorialOpen(true)}
                className="md:hidden px-2.5 py-1.5 rounded bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Tutorial</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular mr-1">
                {tracks.length} tracks · {clips.length} clips · {totalDuration.toFixed(1)}s
              </span>
              <input
                ref={projectInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  handleLoadProjectFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={handleSaveProject}
                disabled={clips.length === 0}
                title="Download timeline project as JSON"
                className="px-2.5 py-1 rounded bg-white dark:bg-[#14171d] hover:bg-slate-100 dark:hover:bg-[#1e2430] border border-slate-200 dark:border-[#232832] disabled:opacity-40 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
              >
                <Save className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                <span>Save</span>
              </button>
              <button
                type="button"
                onClick={() => projectInputRef.current?.click()}
                title="Load saved project JSON"
                className="px-2.5 py-1 rounded bg-white dark:bg-[#14171d] hover:bg-slate-100 dark:hover:bg-[#1e2430] border border-slate-200 dark:border-[#232832] text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                <span>Load</span>
              </button>
              {clips.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearTimeline}
                  title="Clear all clips from the timeline (Ctrl+Z to undo)"
                  className={`px-2.5 py-1 rounded border text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                    confirmClear
                      ? 'bg-red-600/15 dark:bg-red-600/20 border-red-500 text-red-700 dark:text-red-200 font-medium'
                      : 'bg-white dark:bg-[#14171d] hover:bg-red-50 dark:hover:bg-[#1e2430] border-slate-200 dark:border-[#232832] text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-300'
                  }`}
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{confirmClear ? 'Confirm Clear?' : 'Clear'}</span>
                </button>
              )}
            </div>
          </div>

          {mode === 'auto' && (
            <AutoModeBar
              visualAssets={visualAssets}
              audioAssets={audioAssets}
              onAutoAssemble={handleAutoAssemble}
              onLoadSamplePack={handleLoadSamplePack}
            />
          )}

          {mode === 'advanced' && (
            <div className="px-3 py-2 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'fusion', label: 'Fusion (VFX & Motion Graphics)' },
                    { id: 'fairlight', label: 'Fairlight (Audio Post-Production)' },
                    { id: 'multimaster', label: 'MultiMaster Trim & Bins' },
                    { id: 'transitions', label: 'Transition Library' },
                  ] as const
                ).map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setAdvancedTab(sub.id)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      advancedTab === sub.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-[#0e1116] border border-slate-200 dark:border-[#262c38] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                J/K/L Shuttle · I/O Mark In/Out
              </span>
            </div>
          )}
        </div>

        {/* Center Studio Area */}
        {mode === 'advanced' ? (
          advancedTab === 'fusion' ? (
            <FusionVfxStudio
              selectedClip={selectedClip}
              selectedClipAsset={selectedClipAsset}
              clips={clips}
              assetsMap={assetsMap}
              playhead={playhead}
              onPlayheadChange={(t) => {
                setIsPlaying(false);
                setPlayhead(t);
              }}
              onSelectClip={(id) => {
                setSelectedClipId(id);
                setGradeTargetAssetId(null);
              }}
              onUpdateClip={handleUpdateClip}
              onCommitHistory={commitHistory}
              onInsertBakedOverlay={handleInsertBakedOverlay}
            />
          ) : advancedTab === 'fairlight' ? (
            <FairlightAudioStudio
              tracks={tracks}
              clips={clips}
              selectedClipId={selectedClipId}
              playhead={playhead}
              isPlaying={isPlaying}
              masterMuted={masterMuted}
              normalizeAudio={Boolean(exportConfig.normalizeAudio)}
              normalizeTargetLufs={exportConfig.normalizeTargetLufs ?? -14}
              onTogglePlay={() => setIsPlaying((p) => !p)}
              onSeekPlayhead={(t) => setPlayhead(t)}
              onToggleMasterMute={() => setMasterMuted((m) => !m)}
              onToggleMasterNormalize={(enabled) =>
                setExportConfig((prev) => ({
                  ...prev,
                  normalizeAudio: enabled,
                  normalizeTargetLufs: prev.normalizeTargetLufs ?? -14,
                }))
              }
              onChangeMasterNormalizeTarget={(lufs) =>
                setExportConfig((prev) => ({
                  ...prev,
                  normalizeTargetLufs: lufs,
                }))
              }
              onSelectClip={(id) => {
                setSelectedClipId(id);
                setGradeTargetAssetId(null);
              }}
              onUpdateClip={handleUpdateClip}
              onCommitHistory={commitHistory}
              onUpdateTrack={handleUpdateTrack}
              onCreateAudioFolder={handleCreateAudioFolder}
              onAddAudioTrack={(folderId) => handleAddTrack('audio', folderId)}
              onCommitAdrTake={handleCommitAdrTake}
            />
          ) : advancedTab === 'multimaster' ? (
            <MultiMasterEditStudio
              assets={assets}
              tracks={tracks}
              clips={clips}
              selectedClip={selectedClip}
              playhead={playhead}
              fps={exportConfig.fps}
              trimMode={trimMode}
              markIn={markIn}
              markOut={markOut}
              nestedSequences={nestedSequences}
              onSetTrimMode={setTrimMode}
              onNudgeTrim={handleNudgeTrim}
              onSetMarkIn={setMarkIn}
              onSetMarkOut={setMarkOut}
              onExtractInOutRange={handleExtractInOutRange}
              onCreateNestedSequence={handleCreateNestedSequence}
              onLoadNestedSequence={handleLoadNestedSequence}
              onDeleteNestedSequence={(seqId) =>
                setNestedSequences((prev) => prev.filter((s) => s.id !== seqId))
              }
              onAddVisualToTimeline={addVisualToTimeline}
              onSwitchMulticamAngle={handleSwitchMulticamAngle}
            />
          ) : (
            <div className="flex flex-col lg:flex-row gap-3 min-h-[380px] lg:h-[445px]">
              <div className="w-full lg:w-[340px] shrink-0 bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg overflow-hidden flex flex-col">
                <TransitionLibraryPanel
                  selectedTransition={
                    selectedClip && (selectedClip.kind === 'image' || selectedClip.kind === 'video')
                      ? selectedClip.transitionOut
                      : null
                  }
                  selectedClipName={selectedClip?.name}
                  selectedDuration={selectedClip?.transitionDuration || 0.45}
                  hasTargetClip={Boolean(
                    selectedClip && (selectedClip.kind === 'image' || selectedClip.kind === 'video'),
                  )}
                  visualClipCount={clips.filter((c) => c.kind === 'image' || c.kind === 'video').length}
                  onApplyTransition={handleApplyTransition}
                  onApplyTransitionToAll={handleApplyTransitionToAll}
                />
              </div>
              <div className="flex-1 min-w-0 min-h-[280px]">
                <PreviewCanvas
                  tracks={tracks}
                  clips={clips}
                  assetsMap={assetsMap}
                  selectedClipId={selectedClipId}
                  canvasTool={canvasTool}
                  colorGrade={colorGrade}
                  bypassGrade={bypassGrade}
                  resolution={exportConfig.resolution}
                  fps={exportConfig.fps}
                  playhead={playhead}
                  isPlaying={isPlaying}
                  masterMuted={masterMuted}
                  normalizeAudio={Boolean(exportConfig.normalizeAudio)}
                  normalizeTargetLufs={exportConfig.normalizeTargetLufs ?? -14}
                  loadingSample={loadingSample}
                  uploading={uploading}
                  onPlayheadChange={setPlayhead}
                  onSelectClip={(id) => {
                    setSelectedClipId(id);
                    if (id) setGradeTargetAssetId(null);
                  }}
                  onUpdateClip={handleUpdateClip}
                  onCommitHistory={commitHistory}
                  onCanvasToolChange={setCanvasTool}
                  onTogglePlay={() => {
                    if (!isPlaying && playhead >= totalDuration && totalDuration > 0) {
                      setPlayhead(0);
                    }
                    setIsPlaying((p) => !p);
                  }}
                  onToggleMute={() => setMasterMuted((m) => !m)}
                  onLoadSamplePack={handleLoadSamplePack}
                  onUploadFiles={handleUploadFiles}
                  onOpenTutorial={() => setTutorialOpen(true)}
                />
              </div>
            </div>
          )
        ) : mode === 'quickrender' ? (
          <QuickRenderPage
            assets={assets}
            assetsMap={assetsMap}
            tracks={tracks}
            clips={clips}
            selectedClipId={selectedClipId}
            colorGrade={colorGrade}
            bypassGrade={bypassGrade}
            totalDuration={totalDuration}
            playhead={playhead}
            isPlaying={isPlaying}
            masterMuted={masterMuted}
            exportConfig={exportConfig}
            renderJob={renderJob}
            loadingSample={loadingSample}
            uploading={uploading}
            onChangeConfig={setExportConfig}
            onStartRender={handleStartRender}
            onTogglePlay={() => {
              if (!isPlaying && playhead >= totalDuration && totalDuration > 0) {
                setPlayhead(0);
              }
              setIsPlaying((p) => !p);
            }}
            onSeekPlayhead={(t) => {
              setIsPlaying(false);
              setPlayhead(t);
            }}
            onPlayheadChange={setPlayhead}
            onToggleMasterMute={() => setMasterMuted((m) => !m)}
            onSelectClip={(id) => {
              setSelectedClipId(id);
              if (id) setGradeTargetAssetId(null);
            }}
            onUpdateClip={handleUpdateClip}
            onCommitHistory={commitHistory}
            onLoadSamplePack={handleLoadSamplePack}
            onUploadFiles={handleUploadFiles}
            onOpenTimelineMode={() => setMode('manual')}
            onOpenTutorial={() => setTutorialOpen(true)}
            onAutoSelectQuickRender={handleAutoSelectQuickRender}
          />
        ) : (
        <div className="flex flex-col lg:flex-row gap-3 min-h-[360px] lg:h-[445px]">
          <MediaBin
            assets={assets}
            uploading={uploading}
            loadingSample={loadingSample}
            playhead={playhead}
            selectedGradeAssetId={gradeTargetAssetId}
            selectedClip={selectedClip}
            visualClipCount={clips.filter((c) => c.kind === 'image' || c.kind === 'video').length}
            onUploadFiles={handleUploadFiles}
            onLoadSamplePack={handleLoadSamplePack}
            onAddVisualToTimeline={addVisualToTimeline}
            onAddAudioToTimeline={addAudioToTimeline}
            onAddTitleClip={addTitleClip}
            onOpenAssetColorGrade={handleOpenAssetColorGrade}
            onApplyTransition={handleApplyTransition}
            onApplyTransitionToAll={handleApplyTransitionToAll}
            onDeleteAsset={handleDeleteAsset}
          />

          <div className="flex-1 min-w-0 min-h-[280px]">
            <PreviewCanvas
              tracks={tracks}
              clips={clips}
              assetsMap={assetsMap}
              selectedClipId={selectedClipId}
              canvasTool={canvasTool}
              colorGrade={colorGrade}
              bypassGrade={bypassGrade}
              resolution={exportConfig.resolution}
              fps={exportConfig.fps}
              playhead={playhead}
              isPlaying={isPlaying}
              masterMuted={masterMuted}
              normalizeAudio={Boolean(exportConfig.normalizeAudio)}
              normalizeTargetLufs={exportConfig.normalizeTargetLufs ?? -14}
              loadingSample={loadingSample}
              uploading={uploading}
              onPlayheadChange={setPlayhead}
              onSelectClip={(id) => {
                setSelectedClipId(id);
                if (id) setGradeTargetAssetId(null);
              }}
              onUpdateClip={handleUpdateClip}
              onCommitHistory={commitHistory}
              onCanvasToolChange={setCanvasTool}
              onTogglePlay={() => {
                if (!isPlaying && playhead >= totalDuration && totalDuration > 0) {
                  setPlayhead(0);
                }
                setIsPlaying((p) => !p);
              }}
              onToggleMute={() => setMasterMuted((m) => !m)}
              onLoadSamplePack={handleLoadSamplePack}
              onUploadFiles={handleUploadFiles}
              onOpenTutorial={() => setTutorialOpen(true)}
            />
          </div>

          <ClipInspectorPanel
            selectedClip={selectedClip}
            selectedClipAsset={selectedClipAsset}
            gradeTargetAsset={gradeTargetAsset}
            playhead={playhead}
            activeTab={inspectorTab}
            gradeScope={gradeScope}
            canvasTool={canvasTool}
            colorGrade={colorGrade}
            bypassGrade={bypassGrade}
            onTabChange={setInspectorTab}
            onGradeScopeChange={setGradeScope}
            onCanvasToolChange={setCanvasTool}
            onUpdateClip={handleUpdateClip}
            onDeleteClip={handleDeleteClip}
            onDuplicateClip={handleDuplicateClip}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onCommitHistory={commitHistory}
            onChangeColorGrade={setColorGrade}
            onChangeAssetColorGrade={handleChangeAssetColorGrade}
            onSyncGradeToAssetClips={handleSyncGradeToAssetClips}
            onAddAssetToTimeline={(asset) => addVisualToTimeline(asset, false)}
            onToggleBypassGrade={() => setBypassGrade((b) => !b)}
          />
        </div>
        )}

        {/* Bottom Boundless Tracks Timeline (hidden in dedicated Quick Render page for simpler focus) */}
        {mode !== 'quickrender' && (
          <TimelineEditor
            tracks={tracks}
            clips={clips}
            assetsMap={assetsMap}
            fps={exportConfig.fps}
            playhead={playhead}
            selectedClipId={selectedClipId}
            canUndo={historyDepth.past > 0}
            canRedo={historyDepth.future > 0}
            rippleMode={rippleMode}
            freeformRoughCut={freeformRoughCut}
            markIn={markIn}
            markOut={markOut}
            onSelectClip={(id) => {
              setSelectedClipId(id);
              setGradeTargetAssetId(null);
            }}
            onPlayheadChange={(t) => {
              setIsPlaying(false);
              setPlayhead(t);
            }}
            onAddTrack={(kind, role) => handleAddTrack(kind, undefined, role)}
            onMoveTrack={handleMoveTrack}
            onUpdateTrack={handleUpdateTrack}
            onDeleteTrack={handleDeleteTrack}
            onUpdateClip={handleUpdateClip}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onDeleteClip={handleDeleteClip}
            onDuplicateClip={handleDuplicateClip}
            onDropAssetOnTrack={handleDropAssetOnTrack}
            onDropAssetCreateTrack={handleDropAssetCreateTrack}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onToggleRippleMode={() => setRippleMode((r) => !r)}
            onToggleFreeformRoughCut={() => {
              setFreeformRoughCut((prev) => {
                const next = !prev;
                notify(next ? 'Endless Rough Cut enabled (snap unlocked)' : 'Standard Snapping restored');
                return next;
              });
            }}
            onCommitHistory={commitHistory}
          />
        )}
      </main>

      <ExportModal
        isOpen={exportModalOpen}
        config={exportConfig}
        job={renderJob}
        slideCount={clips.filter((c) => c.kind !== 'audio').length}
        totalDuration={totalDuration}
        onChangeConfig={setExportConfig}
        onStartRender={handleStartRender}
        onClose={() => setExportModalOpen(false)}
      />

      <TutorialModal
        isOpen={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
        onLoadSamplePack={handleLoadSamplePack}
        onSwitchMode={(nextMode) => setMode(nextMode)}
      />

      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 px-3.5 py-2 rounded-md bg-white dark:bg-[#171c26] border border-blue-400 dark:border-blue-500/40 text-xs text-slate-900 dark:text-slate-100 shadow-lg flex items-center gap-2 pointer-events-none"
        >
          <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}
