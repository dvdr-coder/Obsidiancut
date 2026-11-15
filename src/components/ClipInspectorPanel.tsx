import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Crop,
  Move,
  Palette,
  RotateCcw,
  Scissors,
  Sliders,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  AudioFadeCurve,
  AudioTransitionType,
  AudioVolumePoint,
  ClipCrop,
  ColorGradeConfig,
  DEFAULT_CLIP_EFFECTS,
  DEFAULT_COLOR_GRADE,
  MediaAsset,
  MotionType,
  TimelineClip,
  TitleTemplateId,
  TRANSITION_GROUPS,
  TRANSITION_OPTIONS,
  TransitionType,
} from '../types/editor';
import { ColorGradingPlugin } from './ColorGradingPlugin';
import { TitleStyleControls } from './TitleStyleControls';
import { getPluginFault, resetPluginFault, sanitizeClipEffects } from '../utils/pluginSandbox';
import {
  computeAspectCropPreset,
  computeClipNormalizeGain,
  DEFAULT_CLIP_CROP,
  evaluateAudioEnvelopeGain,
  isClipCropped,
  resolveFfmpegXfadeFilter,
  sanitizeClipCrop,
} from '../utils/timelineMath';

interface ClipInspectorPanelProps {
  selectedClip: TimelineClip | null;
  selectedClipAsset?: MediaAsset | null;
  gradeTargetAsset?: MediaAsset | null;
  playhead?: number;
  activeTab?: 'clip' | 'grade';
  gradeScope?: 'picture' | 'master';
  canvasTool?: 'resize' | 'crop';
  colorGrade: ColorGradeConfig;
  bypassGrade: boolean;
  onTabChange?: (t: 'clip' | 'grade') => void;
  onGradeScopeChange?: (scope: 'picture' | 'master') => void;
  onCanvasToolChange?: (tool: 'resize' | 'crop') => void;
  onUpdateClip: (id: string, patch: Partial<TimelineClip>) => void;
  onDeleteClip: (id: string) => void;
  onDuplicateClip?: (id: string) => void;
  onSplitAtPlayhead?: () => void;
  onCommitHistory?: () => void;
  onChangeColorGrade: (next: ColorGradeConfig) => void;
  onChangeAssetColorGrade?: (assetId: string, next: ColorGradeConfig) => void;
  onSyncGradeToAssetClips?: (assetId: string, grade: ColorGradeConfig) => void;
  onAddAssetToTimeline?: (asset: MediaAsset) => void;
  onToggleBypassGrade: () => void;
}

const SPEED_PRESETS = [0.5, 1.0, 1.5, 2.0];

export const ClipInspectorPanel: React.FC<ClipInspectorPanelProps> = ({
  selectedClip,
  selectedClipAsset = null,
  gradeTargetAsset = null,
  playhead = 0,
  activeTab,
  gradeScope,
  canvasTool = 'resize',
  colorGrade,
  bypassGrade,
  onTabChange,
  onGradeScopeChange,
  onCanvasToolChange,
  onUpdateClip,
  onDeleteClip,
  onDuplicateClip,
  onSplitAtPlayhead,
  onCommitHistory,
  onChangeColorGrade,
  onChangeAssetColorGrade,
  onSyncGradeToAssetClips,
  onAddAssetToTimeline,
  onToggleBypassGrade,
}) => {
  const [localTab, setLocalTab] = useState<'clip' | 'grade'>('clip');
  const [localScope, setLocalScope] = useState<'picture' | 'master'>('picture');
  const tab = activeTab ?? localTab;
  const setTab = (next: 'clip' | 'grade') => {
    setLocalTab(next);
    onTabChange?.(next);
  };
  const [, setFaultTick] = useState(0);
  const inputCommittedRef = useRef<boolean>(false);
  const sliderCommittedRef = useRef<boolean>(false);
  const chromaCommittedRef = useRef<boolean>(false);

  useEffect(() => {
    inputCommittedRef.current = false;
    sliderCommittedRef.current = false;
    chromaCommittedRef.current = false;
  }, [selectedClip?.id]);

  const commitInputOnce = () => {
    if (!inputCommittedRef.current) {
      onCommitHistory?.();
      inputCommittedRef.current = true;
    }
  };
  const resetInputCommit = () => {
    inputCommittedRef.current = false;
  };
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    title: true,
    timing: true,
    transition: true,
    audio: true,
    transform: true,
    crop: true,
    effects: false,
  });

  const fxFault = getPluginFault('clip-fx');

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const canGradeClip = Boolean(
    selectedClip && (selectedClip.kind === 'image' || selectedClip.kind === 'video'),
  );
  const hasIndividualTarget = Boolean(gradeTargetAsset || canGradeClip);
  const effectiveScope: 'picture' | 'master' = hasIndividualTarget
    ? (gradeScope ?? localScope)
    : 'master';
  const setScope = (next: 'picture' | 'master') => {
    setLocalScope(next);
    onGradeScopeChange?.(next);
  };

  if (tab === 'grade') {
    const targetName =
      gradeTargetAsset?.name ||
      (canGradeClip ? selectedClip?.name : undefined);
    const activePicConfig: ColorGradeConfig =
      gradeTargetAsset
        ? (gradeTargetAsset.colorGrade || { ...DEFAULT_COLOR_GRADE })
        : (canGradeClip && selectedClip?.colorGrade)
          ? selectedClip.colorGrade
          : { ...DEFAULT_COLOR_GRADE };

    const handleIndividualChange = (next: ColorGradeConfig) => {
      if (gradeTargetAsset && onChangeAssetColorGrade) {
        onChangeAssetColorGrade(gradeTargetAsset.id, next);
      } else if (canGradeClip && selectedClip) {
        onUpdateClip(selectedClip.id, { colorGrade: next });
      }
    };

    const syncAssetId = gradeTargetAsset?.id || (canGradeClip ? selectedClip?.mediaId : undefined);

    return (
      <div className="w-full lg:w-[296px] shrink-0 flex flex-col bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg overflow-hidden shadow-xs dark:shadow-none">
        <PanelTabs tab={tab} onSelect={setTab} hasClip={Boolean(selectedClip)} />

        {/* Individual Picture vs Master Timeline Scope Switcher */}
        <div className="px-3 py-2 border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#101318] flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={!hasIndividualTarget}
            onClick={() => setScope('picture')}
            title={
              hasIndividualTarget
                ? `Grade only ${targetName}`
                : 'Select a picture in Media Bin or a clip on timeline first'
            }
            className={`flex-1 py-1 px-2 rounded text-[11px] font-medium transition-colors whitespace-nowrap truncate disabled:opacity-40 cursor-pointer ${
              effectiveScope === 'picture'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-200 dark:bg-[#171b22] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            This Picture
          </button>
          <button
            type="button"
            onClick={() => setScope('master')}
            title="Apply color grading across the entire timeline"
            className={`flex-1 py-1 px-2 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              effectiveScope === 'master'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-200 dark:bg-[#171b22] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Master (All)
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {effectiveScope === 'picture' && hasIndividualTarget ? (
            <ColorGradingPlugin
              embedded
              title="Picture Color Grade"
              subtitle={targetName}
              previewImageUrl={
                gradeTargetAsset
                  ? gradeTargetAsset.thumbUrl || gradeTargetAsset.fileUrl
                  : undefined
              }
              onAddPictureToTimeline={
                gradeTargetAsset && onAddAssetToTimeline
                  ? () => onAddAssetToTimeline(gradeTargetAsset)
                  : undefined
              }
              onSyncToAllMatchingClips={
                !gradeTargetAsset && syncAssetId && onSyncGradeToAssetClips
                  ? () => onSyncGradeToAssetClips(syncAssetId, activePicConfig)
                  : undefined
              }
              config={activePicConfig}
              bypass={bypassGrade}
              onChange={handleIndividualChange}
              onToggleBypass={onToggleBypassGrade}
              onCommitHistory={canGradeClip ? onCommitHistory : undefined}
            />
          ) : (
            <ColorGradingPlugin
              embedded
              title="Master Color Grade"
              subtitle="Applies to full timeline"
              config={colorGrade}
              bypass={bypassGrade}
              onChange={onChangeColorGrade}
              onToggleBypass={onToggleBypassGrade}
              onCommitHistory={onCommitHistory}
            />
          )}
        </div>
      </div>
    );
  }

  const updateFx = (patch: Partial<TimelineClip['effects']>) => {
    if (!selectedClip) return;
    onUpdateClip(selectedClip.id, {
      effects: sanitizeClipEffects({ ...selectedClip.effects, ...patch }),
    });
  };

  const applyCornerPreset = (x: number, y: number, scale = 0.25) => {
    if (!selectedClip) return;
    onCommitHistory?.();
    onUpdateClip(selectedClip.id, { x, y, scale, scaleX: 1, scaleY: 1, fit: 'contain' });
  };

  const activeCrop: ClipCrop = sanitizeClipCrop(selectedClip?.crop);
  const clipIsCropped = isClipCropped(activeCrop);
  const currentScaleX = selectedClip?.scaleX ?? 1;
  const currentScaleY = selectedClip?.scaleY ?? 1;
  const hasNonUniformScale =
    Math.abs(currentScaleX - 1) > 0.005 || Math.abs(currentScaleY - 1) > 0.005;

  const updateCrop = (patch: Partial<ClipCrop>) => {
    if (!selectedClip) return;
    onUpdateClip(selectedClip.id, {
      crop: sanitizeClipCrop({ ...activeCrop, ...patch }),
    });
  };

  const hasCustomFx =
    selectedClip &&
    (Math.abs(selectedClip.effects.brightness) > 0.01 ||
      Math.abs(selectedClip.effects.gamma - 1) > 0.02 ||
      Math.abs(selectedClip.effects.hue) > 1 ||
      selectedClip.effects.greyscale ||
      selectedClip.effects.chromaKeyEnabled);

  return (
    <aside className="w-full lg:w-[296px] shrink-0 flex flex-col bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg overflow-hidden shadow-xs dark:shadow-none">
      <PanelTabs tab={tab} onSelect={setTab} hasClip={Boolean(selectedClip)} />

      {!selectedClip ? (
        <div className="flex-1 p-5 flex flex-col items-center justify-center text-center space-y-3">
          <Sliders className="w-5 h-5 text-slate-400 dark:text-slate-600" />
          <div>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Select Any Timeline Clip</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Click a photo, video, title, or song on the timeline below to edit timing, speed, reverse, chroma key, overlays, or transitions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTab('grade')}
            className="px-3.5 py-1.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1d222b] dark:hover:bg-[#262d39] border border-slate-300 dark:border-[#2c3340] text-xs font-medium text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
          >
            Open Color Grading Plug-in
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
          {/* Header + Quick Clip Actions */}
          <div className="pb-2.5 border-b border-slate-200 dark:border-[#232832] space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{selectedClip.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                  {selectedClip.kind} · {selectedClip.startTime.toFixed(2)}s →{' '}
                  {(selectedClip.startTime + selectedClip.duration).toFixed(2)}s
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {onSplitAtPlayhead && (
                <button
                  type="button"
                  onClick={onSplitAtPlayhead}
                  title="Split selected clip at current playhead (S)"
                  className="flex-1 py-1 px-2 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1a1f28] dark:hover:bg-[#242b38] border border-slate-300 dark:border-[#2a313e] text-[11px] text-slate-800 dark:text-slate-200 flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Scissors className="w-3 h-3 text-blue-500 dark:text-blue-400" />
                  <span>Split</span>
                </button>
              )}
              {onDuplicateClip && (
                <button
                  type="button"
                  onClick={() => onDuplicateClip(selectedClip.id)}
                  title="Duplicate clip immediately after (Ctrl+D)"
                  className="flex-1 py-1 px-2 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1a1f28] dark:hover:bg-[#242b38] border border-slate-300 dark:border-[#2a313e] text-[11px] text-slate-800 dark:text-slate-200 flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Copy className="w-3 h-3 text-blue-500 dark:text-blue-400" />
                  <span>Duplicate</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onDeleteClip(selectedClip.id)}
                title="Remove clip from timeline (Delete)"
                className="py-1 px-2 rounded text-[11px] text-red-600 dark:text-red-400 hover:bg-red-500/15 border border-red-300 dark:border-red-900/40 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Remove</span>
              </button>
            </div>
            {(selectedClip.kind === 'image' || selectedClip.kind === 'video') && (
              <button
                type="button"
                onClick={() => {
                  setScope('picture');
                  setTab('grade');
                }}
                className={`w-full py-1 px-2 rounded border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  selectedClip.colorGrade?.enabled
                    ? 'bg-blue-50 dark:bg-blue-600/20 border-blue-500/60 text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-600/30'
                    : 'bg-slate-100 dark:bg-[#1a1f28] border-slate-300 dark:border-[#2a313e] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#242b38]'
                }`}
              >
                <Palette className="w-3 h-3 text-blue-500 dark:text-blue-400" />
                <span>
                  {selectedClip.colorGrade?.enabled
                    ? 'Edit Picture Color Grade (Active)'
                    : 'Color Grade This Picture'}
                </span>
              </button>
            )}
          </div>

          {/* Vector Title / Credits Editor if Title Clip */}
          {selectedClip.kind === 'title' && selectedClip.title && (
            <CollapsibleSection
              title="Vector Title & Credits"
              open={openSections.title}
              onToggle={() => toggleSection('title')}
            >
              <div className="space-y-2.5">
                <select
                  value={selectedClip.title.template}
                  onChange={(e) => {
                    onCommitHistory?.();
                    onUpdateClip(selectedClip.id, {
                      title: { ...selectedClip.title!, template: e.target.value as TitleTemplateId },
                    });
                  }}
                  className="w-full h-8 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100"
                >
                  <option value="main_title">Main Cinema Title</option>
                  <option value="lower_third">Editorial Lower Third</option>
                  <option value="subtitle">Subtitle Caption</option>
                  <option value="vector_badge">Vector Crest / Stamp</option>
                  <option value="scrolling_credits">Scrolling Motion Picture Credits</option>
                </select>

                <input
                  type="text"
                  value={selectedClip.title.heading}
                  placeholder="Heading"
                  onChange={(e) => {
                    commitInputOnce();
                    onUpdateClip(selectedClip.id, {
                      title: { ...selectedClip.title!, heading: e.target.value },
                    });
                  }}
                  onBlur={resetInputCommit}
                  className="w-full h-8 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100"
                />

                {selectedClip.title.template !== 'scrolling_credits' &&
                  selectedClip.title.template !== 'subtitle' && (
                    <input
                      type="text"
                      value={selectedClip.title.subheading}
                      placeholder="Subheading"
                      onChange={(e) => {
                        commitInputOnce();
                        onUpdateClip(selectedClip.id, {
                          title: { ...selectedClip.title!, subheading: e.target.value },
                        });
                      }}
                      onBlur={resetInputCommit}
                      className="w-full h-8 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100"
                    />
                  )}

                {selectedClip.title.template === 'scrolling_credits' && (
                  <textarea
                    rows={4}
                    value={selectedClip.title.bodyText}
                    placeholder="Role :: Name (one per line)"
                    onChange={(e) => {
                      commitInputOnce();
                      onUpdateClip(selectedClip.id, {
                        title: { ...selectedClip.title!, bodyText: e.target.value },
                      });
                    }}
                    onBlur={resetInputCommit}
                    className="w-full p-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 font-mono-tabular text-[11px]"
                  />
                )}

                <TitleStyleControls
                  spec={selectedClip.title}
                  onChange={(nextTitle) => onUpdateClip(selectedClip.id, { title: nextTitle })}
                  onCommit={() => onCommitHistory?.()}
                />
              </div>
            </CollapsibleSection>
          )}

          {/* Timing & Speed Time-Mapping */}
          <CollapsibleSection
            title="Timing & Playback Speed"
            open={openSections.timing}
            onToggle={() => toggleSection('timing')}
          >
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Clip Duration (s)</span>
                  <input
                    type="number"
                    min={0.2}
                    step={0.1}
                    value={selectedClip.duration}
                    onChange={(e) => {
                      commitInputOnce();
                      onUpdateClip(selectedClip.id, {
                        duration: Math.max(0.2, Number(e.target.value) || 0.2),
                      });
                    }}
                    onBlur={resetInputCommit}
                    className="h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Start Offset (s)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={selectedClip.trimStart}
                    onChange={(e) => {
                      commitInputOnce();
                      onUpdateClip(selectedClip.id, {
                        trimStart: Math.max(0, Number(e.target.value) || 0),
                      });
                    }}
                    onBlur={resetInputCommit}
                    className="h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 font-mono-tabular"
                  />
                </label>
              </div>

              {(selectedClip.kind === 'video' || selectedClip.kind === 'audio') && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 dark:text-slate-400">Speed Presets</span>
                    <span className="font-mono-tabular text-slate-800 dark:text-slate-200">
                      {selectedClip.speed.toFixed(2)}×
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {SPEED_PRESETS.map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        onClick={() => {
                          onCommitHistory?.();
                          onUpdateClip(selectedClip.id, { speed: sp });
                        }}
                        className={`py-1 rounded text-[10px] font-mono-tabular border transition-colors cursor-pointer ${
                          Math.abs(selectedClip.speed - sp) < 0.03
                            ? 'bg-blue-50 dark:bg-blue-600/25 border-blue-500 text-blue-700 dark:text-blue-100'
                            : 'bg-slate-50 dark:bg-[#101318] border-slate-300 dark:border-[#262c38] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {sp}×
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0.25}
                    max={4.0}
                    step={0.05}
                    value={selectedClip.speed}
                    onChange={(e) => {
                      if (!sliderCommittedRef.current) {
                        onCommitHistory?.();
                        sliderCommittedRef.current = true;
                      }
                      onUpdateClip(selectedClip.id, { speed: Number(e.target.value) });
                    }}
                    onPointerUp={() => {
                      sliderCommittedRef.current = false;
                    }}
                    onPointerCancel={() => {
                      sliderCommittedRef.current = false;
                    }}
                    onBlur={() => {
                      sliderCommittedRef.current = false;
                    }}
                    className="studio-slider w-full"
                  />
                  <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedClip.reverse}
                      onChange={(e) => {
                        onCommitHistory?.();
                        onUpdateClip(selectedClip.id, { reverse: e.target.checked });
                      }}
                      className="rounded border-slate-300 dark:border-[#2a303d] bg-white dark:bg-[#0e1116]"
                    />
                    <span>Play Backwards (Reverse)</span>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Fade In (s)</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={selectedClip.fadeIn}
                    onChange={(e) => {
                      commitInputOnce();
                      onUpdateClip(selectedClip.id, { fadeIn: Math.max(0, Number(e.target.value) || 0) });
                    }}
                    onBlur={resetInputCommit}
                    className="h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 font-mono-tabular"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Fade Out (s)</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={selectedClip.fadeOut}
                    onChange={(e) => {
                      commitInputOnce();
                      onUpdateClip(selectedClip.id, { fadeOut: Math.max(0, Number(e.target.value) || 0) });
                    }}
                    onBlur={resetInputCommit}
                    className="h-7 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 font-mono-tabular"
                  />
                </label>
              </div>
            </div>
          </CollapsibleSection>

          {/* Transition After Clip (Visual Non-Title Clips) */}
          {(selectedClip.kind === 'image' || selectedClip.kind === 'video') && (
            <CollapsibleSection
              title="Transitions"
              open={openSections.transition}
              onToggle={() => toggleSection('transition')}
            >
              <div className="space-y-2">
                <label htmlFor="clip-transitions-select" className="flex flex-col gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Transitions</span>
                  <select
                    id="clip-transitions-select"
                    aria-label="Transitions"
                    value={selectedClip.transitionOut}
                    onChange={(e) => {
                      onCommitHistory?.();
                      const nextType = e.target.value as TransitionType;
                      const nextDur =
                        nextType === 'cut'
                          ? 0
                          : Number(Math.max(0.25, selectedClip.transitionDuration || 0.45).toFixed(2));
                      onUpdateClip(selectedClip.id, {
                        transitionOut: nextType,
                        transitionDuration: nextDur,
                        transition: {
                          type: nextType,
                          duration: nextDur,
                          targetClipId: selectedClip.transition?.targetClipId ?? null,
                          overlapSec: selectedClip.transition?.overlapSec ?? 0,
                          ffmpegFilter: resolveFfmpegXfadeFilter(nextType),
                        },
                      });
                    }}
                    className="w-full h-8 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 text-[11px]"
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
                </label>
                {selectedClip.transitionOut !== 'cut' && (
                  <FxSlider
                    label="Transition Duration"
                    value={selectedClip.transitionDuration}
                    display={`${selectedClip.transitionDuration.toFixed(2)}s`}
                    min={0.1}
                    max={1.8}
                    step={0.05}
                    onCommitHistory={onCommitHistory}
                    onChange={(v) =>
                      onUpdateClip(selectedClip.id, {
                        transitionDuration: v,
                        transition: {
                          type: selectedClip.transitionOut,
                          duration: v,
                          targetClipId: selectedClip.transition?.targetClipId ?? null,
                          overlapSec: selectedClip.transition?.overlapSec ?? 0,
                          ffmpegFilter: resolveFfmpegXfadeFilter(selectedClip.transitionOut),
                        },
                      })
                    }
                  />
                )}
                <p className="text-[10px] text-slate-500">
                  Applies Fade, Dissolve, Wipe, or directional effects between this clip and the next clip on the track.
                </p>
              </div>
            </CollapsibleSection>
          )}

          {/* Music Layer, Volume Envelope, Ducking & Audio Transition Controls */}
          {(selectedClip.kind === 'audio' || (selectedClip.kind === 'video' && selectedClip.hasAudio)) && (
            <CollapsibleSection
              title={selectedClip.kind === 'audio' ? 'Music Layer & Volume Envelope' : 'Audio Mixing & Envelope'}
              open={openSections.audio}
              onToggle={() => toggleSection('audio')}
            >
              <div className="space-y-3">
                {/* Quick Music Cuts & Actions */}
                <div className="grid grid-cols-2 gap-1.5">
                  {onSplitAtPlayhead && (
                    <button
                      type="button"
                      onClick={onSplitAtPlayhead}
                      className="px-2 py-1.5 rounded bg-slate-100 hover:bg-blue-50 dark:bg-[#1a212d] dark:hover:bg-blue-600/30 border border-slate-300 dark:border-[#2c3442] text-[10px] font-medium text-slate-800 dark:text-slate-200 flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Scissors className="w-3 h-3 text-blue-500 dark:text-blue-400" />
                      <span>Cut @ Playhead</span>
                    </button>
                  )}
                  {onDuplicateClip && (
                    <button
                      type="button"
                      onClick={() => onDuplicateClip(selectedClip.id)}
                      className="px-2 py-1.5 rounded bg-slate-100 hover:bg-emerald-50 dark:bg-[#1a212d] dark:hover:bg-emerald-600/30 border border-slate-300 dark:border-[#2c3442] text-[10px] font-medium text-slate-800 dark:text-slate-200 flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      <span>Loop / Repeat</span>
                    </button>
                  )}
                </div>

                {/* Background Music (BGM) Presets & Auto-Ducking */}
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold block mb-1">
                    Background Music Level Presets
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { label: 'Lead 100%', v: 1.0 },
                      { label: 'BGM 35%', v: 0.35 },
                      { label: 'Voice 18%', v: 0.18 },
                      { label: 'Boost 140%', v: 1.4 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          onCommitHistory?.();
                          onUpdateClip(selectedClip.id, { volume: preset.v });
                        }}
                        className={`px-1 py-1 rounded text-[10px] font-medium border cursor-pointer ${
                          Math.abs((selectedClip.volume ?? 1) - preset.v) < 0.03
                            ? 'bg-emerald-50 dark:bg-emerald-600/25 border-emerald-500 text-emerald-700 dark:text-emerald-100'
                            : 'bg-slate-50 dark:bg-[#101319] border-slate-300 dark:border-[#262c38] text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedClip.muted}
                      onChange={(e) => {
                        onCommitHistory?.();
                        onUpdateClip(selectedClip.id, { muted: e.target.checked });
                      }}
                    />
                    <span>Mute Clip</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedClip.backgroundDucking)}
                      onChange={(e) => {
                        onCommitHistory?.();
                        onUpdateClip(selectedClip.id, {
                          backgroundDucking: e.target.checked,
                          duckLevel: selectedClip.duckLevel ?? 0.3,
                        });
                      }}
                    />
                    <span>Auto-Duck BGM</span>
                  </label>
                </div>

                {selectedClip.backgroundDucking && (
                  <FxSlider
                    label="Duck Under Voice Level"
                    value={selectedClip.duckLevel ?? 0.3}
                    display={`${Math.round((selectedClip.duckLevel ?? 0.3) * 100)}%`}
                    min={0.1}
                    max={0.8}
                    step={0.05}
                    onCommitHistory={onCommitHistory}
                    onChange={(v) => onUpdateClip(selectedClip.id, { duckLevel: v })}
                  />
                )}

                <FxSlider
                  label="Base Volume"
                  value={selectedClip.volume}
                  display={`${Math.round(selectedClip.volume * 100)}%`}
                  min={0}
                  max={2}
                  step={0.05}
                  onCommitHistory={onCommitHistory}
                  onChange={(v) => onUpdateClip(selectedClip.id, { volume: v })}
                />

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onCommitHistory?.();
                      const normVol = computeClipNormalizeGain(selectedClip.waveform, 0.84);
                      onUpdateClip(selectedClip.id, { volume: normVol });
                    }}
                    className="flex-1 py-1.5 px-2.5 rounded bg-blue-50 hover:bg-blue-100 dark:bg-[#141d29] dark:hover:bg-blue-600/25 border border-blue-300 dark:border-blue-500/40 text-[10px] font-medium text-blue-700 dark:text-blue-200 cursor-pointer transition-colors"
                    title="Analyze clip waveform peaks and normalize Base Volume toward -1.5 dBFS headroom"
                  >
                    Auto-Normalize Clip Level (-1.5 dB Peak)
                  </button>
                </div>

                {/* Interactive Waveform + Incremental Volume Envelope Graph */}
                <div className="p-2 rounded bg-slate-900 dark:bg-[#0c1016] border border-slate-700 dark:border-[#232935] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                      Waveform Volume Curve
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onCommitHistory?.();
                        const rel = Math.max(
                          0.02,
                          Math.min(0.98, (playhead - selectedClip.startTime) / Math.max(0.1, selectedClip.duration)),
                        );
                        const t = Number.isFinite(rel) && playhead >= selectedClip.startTime && playhead <= selectedClip.startTime + selectedClip.duration
                          ? Number(rel.toFixed(3))
                          : 0.5;
                        const existing = selectedClip.volumeEnvelope && selectedClip.volumeEnvelope.length > 0
                          ? [...selectedClip.volumeEnvelope]
                          : [
                              { id: `vp_s_${Date.now()}`, time: 0, gain: Number((selectedClip.volume ?? 1).toFixed(2)) },
                              { id: `vp_e_${Date.now() + 1}`, time: 1, gain: Number((selectedClip.volume ?? 1).toFixed(2)) },
                            ];
                        const curGain = evaluateAudioEnvelopeGain(existing, t, selectedClip.volume ?? 1);
                        existing.push({ id: `vp_${Date.now().toString(36)}`, time: t, gain: Number(curGain.toFixed(2)) });
                        existing.sort((a, b) => a.time - b.time);
                        onUpdateClip(selectedClip.id, { volumeEnvelope: existing });
                      }}
                      className="px-1.5 py-0.5 rounded bg-emerald-600/25 hover:bg-emerald-600/40 border border-emerald-500/40 text-[10px] text-emerald-200 cursor-pointer"
                    >
                      + Point
                    </button>
                  </div>

                  {/* Interactive SVG Waveform & Drag Graph */}
                  <div
                    className="relative h-20 w-full rounded bg-[#080b0f] border border-[#1d232e] overflow-hidden cursor-crosshair select-none"
                    onDoubleClick={(e) => {
                      onCommitHistory?.();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const normT = Math.max(0, Math.min(1, Number(((e.clientX - rect.left) / rect.width).toFixed(3))));
                      const fracTop = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                      const gain = Number(((1 - fracTop) * 2).toFixed(2));
                      const existing = selectedClip.volumeEnvelope && selectedClip.volumeEnvelope.length > 0
                        ? [...selectedClip.volumeEnvelope]
                        : [
                            { id: `vp_s_${Date.now()}`, time: 0, gain: Number((selectedClip.volume ?? 1).toFixed(2)) },
                            { id: `vp_e_${Date.now() + 1}`, time: 1, gain: Number((selectedClip.volume ?? 1).toFixed(2)) },
                          ];
                      existing.push({ id: `vp_${Date.now().toString(36)}`, time: normT, gain });
                      existing.sort((a, b) => a.time - b.time);
                      onUpdateClip(selectedClip.id, { volumeEnvelope: existing });
                    }}
                    title="Double-click to insert volume node · Drag nodes to ramp volume up or down"
                  >
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                      <line x1="0" y1="50" x2="100" y2="50" stroke="#1f2937" strokeDasharray="2 2" strokeWidth="0.6" />
                      {(selectedClip.waveform || []).slice(0, 64).map((bar, idx, arr) => {
                        const norm = arr.length > 1 ? idx / (arr.length - 1) : 0;
                        const envG = evaluateAudioEnvelopeGain(
                          selectedClip.volumeEnvelope,
                          norm,
                          selectedClip.volume ?? 1,
                        );
                        const h = Math.max(4, Math.min(92, bar * Math.min(1.5, envG) * 90));
                        return (
                          <rect
                            key={idx}
                            x={(idx / Math.max(1, arr.length)) * 100}
                            y={(100 - h) / 2}
                            width={100 / Math.max(1, arr.length) * 0.72}
                            height={h}
                            fill="#10b981"
                            opacity={0.42}
                          />
                        );
                      })}
                      <polyline
                        fill="none"
                        stroke="#fde047"
                        strokeWidth="1.6"
                        vectorEffect="non-scaling-stroke"
                        points={(() => {
                          const pts = selectedClip.volumeEnvelope && selectedClip.volumeEnvelope.length > 0
                            ? [...selectedClip.volumeEnvelope].sort((a, b) => a.time - b.time)
                            : [
                                { id: 'a', time: 0, gain: selectedClip.volume ?? 1 },
                                { id: 'b', time: 1, gain: selectedClip.volume ?? 1 },
                              ];
                          const out: string[] = [];
                          if (pts[0].time > 0) {
                            out.push(`0,${((1 - pts[0].gain / 2) * 100).toFixed(2)}`);
                          }
                          for (const p of pts) {
                            out.push(`${(p.time * 100).toFixed(2)},${Math.max(0, Math.min(100, (1 - p.gain / 2) * 100)).toFixed(2)}`);
                          }
                          if (pts[pts.length - 1].time < 1) {
                            out.push(`100,${((1 - pts[pts.length - 1].gain / 2) * 100).toFixed(2)}`);
                          }
                          return out.join(' ');
                        })()}
                      />
                    </svg>
                    {(selectedClip.volumeEnvelope || []).map((pt) => (
                      <div
                        key={pt.id}
                        style={{
                          left: `${pt.time * 100}%`,
                          top: `${Math.max(5, Math.min(95, (1 - pt.gain / 2) * 100))}%`,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const container = e.currentTarget.parentElement;
                          if (!container) return;
                          if (e.shiftKey || e.button === 2) {
                            onCommitHistory?.();
                            onUpdateClip(selectedClip.id, {
                              volumeEnvelope: (selectedClip.volumeEnvelope || []).filter((x) => x.id !== pt.id),
                            });
                            return;
                          }
                          const rect = container.getBoundingClientRect();
                          let committed = false;
                          const onMove = (ev: MouseEvent) => {
                            if (!committed) {
                              committed = true;
                              onCommitHistory?.();
                            }
                            const normT = Math.max(0, Math.min(1, Number(((ev.clientX - rect.left) / rect.width).toFixed(3))));
                            const fracTop = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
                            const gain = Number(((1 - fracTop) * 2).toFixed(2));
                            const nextEnv: AudioVolumePoint[] = (selectedClip.volumeEnvelope || [])
                              .map((p) => (p.id === pt.id ? { ...p, time: normT, gain } : p))
                              .sort((a, b) => a.time - b.time);
                            onUpdateClip(selectedClip.id, { volumeEnvelope: nextEnv });
                          };
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                          };
                          window.addEventListener('mousemove', onMove);
                          window.addEventListener('mouseup', onUp);
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        title={`${Math.round(pt.gain * 100)}% @ ${(pt.time * selectedClip.duration).toFixed(2)}s (Shift/Right-click delete)`}
                        className="absolute -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 bg-amber-300 border border-black cursor-move"
                      />
                    ))}
                  </div>

                  {/* Incremental Increase/Decrease Ramp Presets */}
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onCommitHistory?.();
                        onUpdateClip(selectedClip.id, {
                          volumeEnvelope: [
                            { id: `vp_ru1_${Date.now()}`, time: 0, gain: 0.1 },
                            { id: `vp_ru2_${Date.now() + 1}`, time: 0.35, gain: 0.9 },
                            { id: `vp_ru3_${Date.now() + 2}`, time: 1, gain: 1.0 },
                          ],
                        });
                      }}
                      className="px-1.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] text-slate-200 cursor-pointer"
                    >
                      ↗ Ramp Up (Swell)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onCommitHistory?.();
                        onUpdateClip(selectedClip.id, {
                          volumeEnvelope: [
                            { id: `vp_rd1_${Date.now()}`, time: 0, gain: 1.0 },
                            { id: `vp_rd2_${Date.now() + 1}`, time: 0.65, gain: 0.85 },
                            { id: `vp_rd3_${Date.now() + 2}`, time: 1, gain: 0.08 },
                          ],
                        });
                      }}
                      className="px-1.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] text-slate-200 cursor-pointer"
                    >
                      ↘ Ramp Down (Outro)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onCommitHistory?.();
                        onUpdateClip(selectedClip.id, {
                          volumeEnvelope: [
                            { id: `vp_md1_${Date.now()}`, time: 0, gain: 0.95 },
                            { id: `vp_md2_${Date.now() + 1}`, time: 0.22, gain: 0.25 },
                            { id: `vp_md3_${Date.now() + 2}`, time: 0.78, gain: 0.25 },
                            { id: `vp_md4_${Date.now() + 3}`, time: 1, gain: 0.95 },
                          ],
                        });
                      }}
                      className="px-1.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] text-slate-200 cursor-pointer"
                    >
                      ∿ Mid Dialogue Dip
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onCommitHistory?.();
                        onUpdateClip(selectedClip.id, { volumeEnvelope: [] });
                      }}
                      className="px-1.5 py-1 rounded bg-slate-800 hover:bg-red-900/40 border border-slate-600 text-[10px] text-slate-300 hover:text-red-300 cursor-pointer"
                    >
                      Clear Curve
                    </button>
                  </div>
                </div>

                {/* Fade Curves & Audio Transitions */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 block mb-1">Fade Curve Shape</label>
                    <select
                      value={selectedClip.audioFadeCurve || 'scurve'}
                      onChange={(e) => {
                        onCommitHistory?.();
                        onUpdateClip(selectedClip.id, { audioFadeCurve: e.target.value as AudioFadeCurve });
                      }}
                      className="w-full h-7 px-1.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#262c38] text-[11px] text-slate-900 dark:text-slate-100"
                    >
                      <option value="scurve">S-Curve (Smooth)</option>
                      <option value="linear">Linear Ramp</option>
                      <option value="exp">Exponential Swell</option>
                      <option value="log">Logarithmic</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 block mb-1">Music Transition Out</label>
                    <select
                      value={selectedClip.audioTransitionOut || 'cut'}
                      onChange={(e) => {
                        onCommitHistory?.();
                        const t = e.target.value as AudioTransitionType;
                        onUpdateClip(selectedClip.id, {
                          audioTransitionOut: t,
                          audioCrossfadeCurve:
                            t === 'crossfade_lin' ? 'linear' : t === 'crossfade_exp' ? 'exp' : 'scurve',
                          audioTransitionDuration:
                            t === 'cut' ? 0 : Math.max(0.4, selectedClip.audioTransitionDuration || 1.2),
                        });
                      }}
                      className="w-full h-7 px-1.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#262c38] text-[11px] text-slate-900 dark:text-slate-100"
                    >
                      <option value="cut">Hard Cut</option>
                      <option value="crossfade_eq">Crossfade (S-Curve)</option>
                      <option value="crossfade_lin">Crossfade (Linear)</option>
                      <option value="crossfade_exp">Crossfade (Exponential)</option>
                      <option value="dip_swell">Dip &amp; Swell</option>
                    </select>
                  </div>
                </div>

                {(selectedClip.audioTransitionOut || 'cut') !== 'cut' && (
                  <FxSlider
                    label="Audio Crossfade Length"
                    value={selectedClip.audioTransitionDuration ?? 1.2}
                    display={`${(selectedClip.audioTransitionDuration ?? 1.2).toFixed(1)}s`}
                    min={0.2}
                    max={4.0}
                    step={0.1}
                    onCommitHistory={onCommitHistory}
                    onChange={(v) => onUpdateClip(selectedClip.id, { audioTransitionDuration: v })}
                  />
                )}

                <FxSlider
                  label="Fade In"
                  value={selectedClip.fadeIn || 0}
                  display={`${(selectedClip.fadeIn || 0).toFixed(2)}s`}
                  min={0}
                  max={Math.max(0.5, Number((selectedClip.duration * 0.48).toFixed(2)))}
                  step={0.05}
                  onCommitHistory={onCommitHistory}
                  onChange={(v) => onUpdateClip(selectedClip.id, { fadeIn: v })}
                />
                <FxSlider
                  label="Fade Out"
                  value={selectedClip.fadeOut || 0}
                  display={`${(selectedClip.fadeOut || 0).toFixed(2)}s`}
                  min={0}
                  max={Math.max(0.5, Number((selectedClip.duration * 0.48).toFixed(2)))}
                  step={0.05}
                  onCommitHistory={onCommitHistory}
                  onChange={(v) => onUpdateClip(selectedClip.id, { fadeOut: v })}
                />

                <FxSlider
                  label="Stereo Pan (L / R)"
                  value={selectedClip.pan}
                  display={
                    Math.abs(selectedClip.pan) < 0.04
                      ? 'Center'
                      : selectedClip.pan < 0
                        ? `L ${Math.round(Math.abs(selectedClip.pan) * 100)}`
                        : `R ${Math.round(selectedClip.pan * 100)}`
                  }
                  min={-1}
                  max={1}
                  step={0.05}
                  onCommitHistory={onCommitHistory}
                  onChange={(v) => onUpdateClip(selectedClip.id, { pan: v })}
                />
              </div>
            </CollapsibleSection>
          )}

          {/* Transform, Overlay, Watermark & Rotation for Visual Clips */}
          {selectedClip.kind !== 'audio' && (
            <>
              <CollapsibleSection
                title="Position, Size & Overlays"
                open={openSections.transform}
                onToggle={() => toggleSection('transform')}
                rightAction={
                  <button
                    type="button"
                    onClick={() => {
                      onCommitHistory?.();
                      onUpdateClip(selectedClip.id, {
                        scale: 1,
                        scaleX: 1,
                        scaleY: 1,
                        x: 0,
                        y: 0,
                        rotation: 0,
                        opacity: 1,
                      });
                    }}
                    className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    Reset
                  </button>
                }
              >
                <div className="space-y-2.5">
                  {onCanvasToolChange && (
                    <div className="flex items-center gap-1 p-0.5 rounded bg-slate-100 dark:bg-[#0e1116] border border-slate-200 dark:border-[#232832]">
                      <button
                        type="button"
                        onClick={() => onCanvasToolChange('resize')}
                        className={`flex-1 py-1 px-2 rounded text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                          canvasTool === 'resize'
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <Move className="w-3 h-3" />
                        <span>Resize / Move</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onCanvasToolChange('crop')}
                        className={`flex-1 py-1 px-2 rounded text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                          canvasTool === 'crop'
                            ? 'bg-amber-600 text-white'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <Crop className="w-3 h-3" />
                        <span>Crop Frame</span>
                      </button>
                    </div>
                  )}

                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500">Quick Watermark / PiP Corner Presets</span>
                    <div className="grid grid-cols-5 gap-1">
                      <button type="button" onClick={() => applyCornerPreset(-34, -34)} title="Top Left corner" className="py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1c212b] dark:hover:bg-[#272e3b] text-slate-800 dark:text-slate-200 text-[10px] cursor-pointer">TL</button>
                      <button type="button" onClick={() => applyCornerPreset(34, -34)} title="Top Right corner" className="py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1c212b] dark:hover:bg-[#272e3b] text-slate-800 dark:text-slate-200 text-[10px] cursor-pointer">TR</button>
                      <button type="button" onClick={() => applyCornerPreset(-34, 34)} title="Bottom Left corner" className="py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1c212b] dark:hover:bg-[#272e3b] text-slate-800 dark:text-slate-200 text-[10px] cursor-pointer">BL</button>
                      <button type="button" onClick={() => applyCornerPreset(34, 34)} title="Bottom Right corner" className="py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1c212b] dark:hover:bg-[#272e3b] text-slate-800 dark:text-slate-200 text-[10px] cursor-pointer">BR</button>
                      <button type="button" onClick={() => { onCommitHistory?.(); onUpdateClip(selectedClip.id, { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, fit: 'cover' }); }} title="Full frame center" className="py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1c212b] dark:hover:bg-[#272e3b] text-slate-800 dark:text-slate-200 text-[10px] cursor-pointer">Full</button>
                    </div>
                  </div>

                  <FxSlider
                    label="Uniform Scale"
                    value={selectedClip.scale}
                    display={`${Math.round(selectedClip.scale * 100)}%`}
                    min={0.1}
                    max={3.0}
                    step={0.02}
                    onCommitHistory={onCommitHistory}
                    onChange={(v) => onUpdateClip(selectedClip.id, { scale: v })}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <FxSlider
                      label="Width (X)"
                      value={currentScaleX}
                      display={`${Math.round(currentScaleX * 100)}%`}
                      min={0.15}
                      max={3.0}
                      step={0.02}
                      onCommitHistory={onCommitHistory}
                      onChange={(v) => onUpdateClip(selectedClip.id, { scaleX: v })}
                    />
                    <FxSlider
                      label="Height (Y)"
                      value={currentScaleY}
                      display={`${Math.round(currentScaleY * 100)}%`}
                      min={0.15}
                      max={3.0}
                      step={0.02}
                      onCommitHistory={onCommitHistory}
                      onChange={(v) => onUpdateClip(selectedClip.id, { scaleY: v })}
                    />
                  </div>
                  {hasNonUniformScale && (
                    <button
                      type="button"
                      onClick={() => {
                        onCommitHistory?.();
                        onUpdateClip(selectedClip.id, { scaleX: 1, scaleY: 1 });
                      }}
                      className="w-full py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1a1f28] dark:hover:bg-[#242b38] border border-slate-300 dark:border-[#2a313e] text-[10px] text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                      Restore 1:1 Proportions
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <FxSlider
                      label="Horizontal (X)"
                      value={selectedClip.x}
                      display={`${Math.round(selectedClip.x)}%`}
                      min={-80}
                      max={80}
                      step={1}
                      onCommitHistory={onCommitHistory}
                      onChange={(v) => onUpdateClip(selectedClip.id, { x: v })}
                    />
                    <FxSlider
                      label="Vertical (Y)"
                      value={selectedClip.y}
                      display={`${Math.round(selectedClip.y)}%`}
                      min={-80}
                      max={80}
                      step={1}
                      onCommitHistory={onCommitHistory}
                      onChange={(v) => onUpdateClip(selectedClip.id, { y: v })}
                    />
                  </div>
                  <FxSlider
                    label="Rotation"
                    value={selectedClip.rotation}
                    display={`${Math.round(selectedClip.rotation)}°`}
                    min={-180}
                    max={180}
                    step={1}
                    onCommitHistory={onCommitHistory}
                    onChange={(v) => onUpdateClip(selectedClip.id, { rotation: v })}
                  />
                  <FxSlider
                    label="Opacity"
                    value={selectedClip.opacity}
                    display={`${Math.round(selectedClip.opacity * 100)}%`}
                    min={0}
                    max={1}
                    step={0.02}
                    onCommitHistory={onCommitHistory}
                    onChange={(v) => onUpdateClip(selectedClip.id, { opacity: v })}
                  />

                  {(selectedClip.kind === 'image' || selectedClip.kind === 'video') && (
                    <div className={`grid ${selectedClip.kind === 'image' ? 'grid-cols-2' : 'grid-cols-1'} gap-2 pt-1`}>
                      {selectedClip.kind === 'image' && (
                        <select
                          value={selectedClip.motion}
                          onChange={(e) => {
                            onCommitHistory?.();
                            onUpdateClip(selectedClip.id, { motion: e.target.value as MotionType });
                          }}
                          className="h-7 px-1.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-200 text-[11px]"
                        >
                          <option value="none">Motion: Static</option>
                          <option value="zoomIn">Zoom In</option>
                          <option value="zoomOut">Zoom Out</option>
                          <option value="panLeft">Pan Left</option>
                          <option value="panRight">Pan Right</option>
                        </select>
                      )}
                      <select
                        value={selectedClip.fit}
                        onChange={(e) => {
                          onCommitHistory?.();
                          onUpdateClip(selectedClip.id, { fit: e.target.value as 'cover' | 'contain' });
                        }}
                        className="h-7 px-1.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-200 text-[11px]"
                      >
                        <option value="cover">Fill Frame</option>
                        <option value="contain">Fit Whole</option>
                      </select>
                    </div>
                  )}
                </div>
              </CollapsibleSection>

              {/* Interactive Layer Crop */}
              <CollapsibleSection
                title={`Crop Frame${clipIsCropped ? ' · Active' : ''}`}
                open={openSections.crop}
                onToggle={() => toggleSection('crop')}
                rightAction={
                  clipIsCropped ? (
                    <button
                      type="button"
                      onClick={() => {
                        onCommitHistory?.();
                        onUpdateClip(selectedClip.id, { crop: { ...DEFAULT_CLIP_CROP } });
                      }}
                      className="text-[11px] text-amber-600 dark:text-amber-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      Uncrop
                    </button>
                  ) : undefined
                }
              >
                <div className="space-y-2.5">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>Aspect Crop Presets</span>
                      <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                        Visible {Math.round((1 - activeCrop.left - activeCrop.right) * 100)}% ×{' '}
                        {Math.round((1 - activeCrop.top - activeCrop.bottom) * 100)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onCommitHistory?.();
                          onUpdateClip(selectedClip.id, { crop: { ...DEFAULT_CLIP_CROP } });
                        }}
                        className={`py-1 rounded text-[10px] cursor-pointer ${
                          !clipIsCropped
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-[#1c212b] dark:hover:bg-[#272e3b] text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        Full
                      </button>
                      {(
                        [
                          ['16:9', 16 / 9],
                          ['4:3', 4 / 3],
                          ['1:1', 1],
                          ['9:16', 9 / 16],
                        ] as const
                      ).map(([label, ratio]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            onCommitHistory?.();
                            const nextCrop = computeAspectCropPreset(
                              ratio,
                              selectedClipAsset?.width || 1920,
                              selectedClipAsset?.height || 1080,
                            );
                            onUpdateClip(selectedClip.id, { crop: nextCrop });
                          }}
                          className="py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1c212b] dark:hover:bg-[#272e3b] text-[10px] text-slate-800 dark:text-slate-200 cursor-pointer"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <FxSlider
                      label="Crop Top"
                      value={activeCrop.top}
                      display={`${Math.round(activeCrop.top * 100)}%`}
                      min={0}
                      max={0.85}
                      step={0.01}
                      onCommitHistory={onCommitHistory}
                      onChange={(v) => updateCrop({ top: v })}
                    />
                    <FxSlider
                      label="Crop Bottom"
                      value={activeCrop.bottom}
                      display={`${Math.round(activeCrop.bottom * 100)}%`}
                      min={0}
                      max={0.85}
                      step={0.01}
                      onCommitHistory={onCommitHistory}
                      onChange={(v) => updateCrop({ bottom: v })}
                    />
                    <FxSlider
                      label="Crop Left"
                      value={activeCrop.left}
                      display={`${Math.round(activeCrop.left * 100)}%`}
                      min={0}
                      max={0.85}
                      step={0.01}
                      onCommitHistory={onCommitHistory}
                      onChange={(v) => updateCrop({ left: v })}
                    />
                    <FxSlider
                      label="Crop Right"
                      value={activeCrop.right}
                      display={`${Math.round(activeCrop.right * 100)}%`}
                      min={0}
                      max={0.85}
                      step={0.01}
                      onCommitHistory={onCommitHistory}
                      onChange={(v) => updateCrop({ right: v })}
                    />
                  </div>
                </div>
              </CollapsibleSection>

              {/* Per-Clip Digital Video Effects & Chroma Key */}
              <CollapsibleSection
                title={`Effects & Chroma Key${hasCustomFx ? ' · Active' : ''}`}
                open={openSections.effects || Boolean(hasCustomFx)}
                onToggle={() => toggleSection('effects')}
                rightAction={
                  <button
                    type="button"
                    onClick={() => {
                      onCommitHistory?.();
                      updateFx({ ...DEFAULT_CLIP_EFFECTS });
                    }}
                    className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                }
              >
                <div className="space-y-2.5">
                  {fxFault && (
                    <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700/60 text-[11px] text-amber-800 dark:text-amber-200 flex items-center justify-between gap-2">
                      <span className="truncate">FX plugin quarantined: {fxFault}</span>
                      <button
                        type="button"
                        onClick={() => {
                          resetPluginFault('clip-fx');
                          setFaultTick((n) => n + 1);
                        }}
                        className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] shrink-0"
                      >
                        Reset
                      </button>
                    </div>
                  )}

                  <FxSlider
                    label="Brightness"
                    value={selectedClip.effects.brightness}
                    display={`${selectedClip.effects.brightness >= 0 ? '+' : ''}${selectedClip.effects.brightness.toFixed(2)}`}
                    min={-0.45}
                    max={0.45}
                    step={0.02}
                    onCommitHistory={onCommitHistory}
                    onChange={(v) => updateFx({ brightness: v })}
                  />
                  <FxSlider
                    label="Gamma"
                    value={selectedClip.effects.gamma}
                    display={selectedClip.effects.gamma.toFixed(2)}
                    min={0.5}
                    max={1.8}
                    step={0.02}
                    onCommitHistory={onCommitHistory}
                    onChange={(v) => updateFx({ gamma: v })}
                  />
                  <FxSlider
                    label="Hue Shift"
                    value={selectedClip.effects.hue}
                    display={`${Math.round(selectedClip.effects.hue)}°`}
                    min={-180}
                    max={180}
                    step={2}
                    onCommitHistory={onCommitHistory}
                    onChange={(v) => updateFx({ hue: v })}
                  />

                  <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={selectedClip.effects.greyscale}
                      onChange={(e) => {
                        onCommitHistory?.();
                        updateFx({ greyscale: e.target.checked });
                      }}
                    />
                    <span>Black & White (Greyscale)</span>
                  </label>

                  {/* Chroma Key (Green / Blue Screen) */}
                  <div className="p-2.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-200 dark:border-[#242a36] space-y-2">
                    <label className="flex items-center justify-between text-slate-800 dark:text-slate-200 cursor-pointer">
                      <span className="font-medium flex items-center gap-1.5">
                        <Wand2 className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
                        Remove Background (Chroma Key)
                      </span>
                      <input
                        type="checkbox"
                        checked={selectedClip.effects.chromaKeyEnabled}
                        onChange={(e) => {
                          onCommitHistory?.();
                          updateFx({ chromaKeyEnabled: e.target.checked });
                        }}
                      />
                    </label>

                    {selectedClip.effects.chromaKeyEnabled && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">Screen Color</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                onCommitHistory?.();
                                updateFx({ chromaKeyColor: '#00ff00' });
                              }}
                              className="w-5 h-5 rounded bg-[#00ff00] border border-slate-400 dark:border-white/30"
                              title="Green Screen"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                onCommitHistory?.();
                                updateFx({ chromaKeyColor: '#0000ff' });
                              }}
                              className="w-5 h-5 rounded bg-[#0000ff] border border-slate-400 dark:border-white/30"
                              title="Blue Screen"
                            />
                            <input
                              type="color"
                              value={selectedClip.effects.chromaKeyColor}
                              onChange={(e) => {
                                if (!chromaCommittedRef.current) {
                                  onCommitHistory?.();
                                  chromaCommittedRef.current = true;
                                }
                                updateFx({ chromaKeyColor: e.target.value });
                              }}
                              onBlur={() => {
                                chromaCommittedRef.current = false;
                              }}
                              className="w-7 h-5 rounded bg-transparent border border-slate-300 dark:border-[#2a303d]"
                            />
                          </div>
                        </div>
                        <FxSlider
                          label="Color Tolerance"
                          value={selectedClip.effects.chromaKeySimilarity}
                          display={selectedClip.effects.chromaKeySimilarity.toFixed(2)}
                          min={0.03}
                          max={0.5}
                          step={0.01}
                          onCommitHistory={onCommitHistory}
                          onChange={(v) => updateFx({ chromaKeySimilarity: v })}
                        />
                        <FxSlider
                          label="Edge Smoothness"
                          value={selectedClip.effects.chromaKeyBlend}
                          display={selectedClip.effects.chromaKeyBlend.toFixed(2)}
                          min={0}
                          max={0.3}
                          step={0.01}
                          onCommitHistory={onCommitHistory}
                          onChange={(v) => updateFx({ chromaKeyBlend: v })}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </CollapsibleSection>
            </>
          )}
        </div>
      )}
    </aside>
  );
};

const PanelTabs: React.FC<{
  tab: 'clip' | 'grade';
  onSelect: (t: 'clip' | 'grade') => void;
  hasClip: boolean;
}> = ({ tab, onSelect, hasClip }) => (
  <div className="flex border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#171b22] shrink-0">
    <button
      type="button"
      onClick={() => onSelect('clip')}
      className={`flex-1 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
        tab === 'clip'
          ? 'text-slate-900 dark:text-white border-b-2 border-blue-500 bg-white dark:bg-[#14171d]'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
      }`}
    >
      {hasClip ? 'Clip Inspector' : 'Clip & FX'}
    </button>
    <button
      type="button"
      onClick={() => onSelect('grade')}
      className={`flex-1 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
        tab === 'grade'
          ? 'text-slate-900 dark:text-white border-b-2 border-blue-500 bg-white dark:bg-[#14171d]'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
      }`}
    >
      Color Plug-in
    </button>
  </div>
);

const CollapsibleSection: React.FC<{
  title: string;
  open: boolean;
  onToggle: () => void;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, open, onToggle, rightAction, children }) => (
  <div className="pb-3 border-b border-slate-200 dark:border-[#232832] last:border-b-0 last:pb-0">
    <div className="flex items-center justify-between gap-2 mb-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-left font-semibold text-slate-800 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white transition-colors cursor-pointer"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
        )}
        <span>{title}</span>
      </button>
      {rightAction}
    </div>
    {open && children}
  </div>
);

const FxSlider: React.FC<{
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
  onCommitHistory?: () => void;
}> = ({ label, value, display, min, max, step, onChange, onCommitHistory }) => {
  const committedRef = useRef(false);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-500 dark:text-slate-400">{label}</span>
        <span className="text-slate-800 dark:text-slate-200 font-mono-tabular">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          if (!committedRef.current) {
            onCommitHistory?.();
            committedRef.current = true;
          }
          onChange(Number(e.target.value));
        }}
        onPointerUp={() => {
          committedRef.current = false;
        }}
        onPointerCancel={() => {
          committedRef.current = false;
        }}
        onBlur={() => {
          committedRef.current = false;
        }}
        className="studio-slider w-full"
      />
    </div>
  );
};
