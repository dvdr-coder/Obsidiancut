import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Film,
  FolderPlus,
  Image as ImageIcon,
  Layers,
  Loader2,
  Music,
  Palette,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import {
  ACCEPTED_MEDIA_ACCEPT,
  MediaAsset,
  SUPPORTED_FORMAT_GROUPS,
  TimelineClip,
  TitleSpec,
  TitleTemplateId,
  TransitionType,
} from '../types/editor';
import { formatBytes, formatTimecode } from '../utils/timelineMath';
import { TitleStyleControls } from './TitleStyleControls';
import { TransitionLibraryPanel } from './TransitionLibraryPanel';

interface MediaBinProps {
  assets: MediaAsset[];
  uploading: boolean;
  loadingSample: boolean;
  playhead: number;
  selectedGradeAssetId?: string | null;
  selectedClip?: TimelineClip | null;
  visualClipCount?: number;
  onUploadFiles: (files: FileList | File[]) => void;
  onLoadSamplePack: () => void;
  onAddVisualToTimeline: (asset: MediaAsset, asOverlay?: boolean) => void;
  onAddAudioToTimeline: (asset: MediaAsset) => void;
  onAddTitleClip: (spec: TitleSpec, duration: number) => void;
  onOpenAssetColorGrade?: (asset: MediaAsset) => void;
  onApplyTransition?: (type: TransitionType, duration: number) => void;
  onApplyTransitionToAll?: (type: TransitionType, duration: number) => void;
  onDeleteAsset: (id: string) => void;
}

const TITLE_PRESETS: { template: TitleTemplateId; label: string; spec: TitleSpec; dur: number }[] = [
  {
    template: 'main_title',
    label: 'Main Cinema Title',
    dur: 4.0,
    spec: {
      template: 'main_title',
      heading: 'NORTHERN HORIZON',
      subheading: 'A VISUAL JOURNEY',
      bodyText: '',
      textColor: '#ffffff',
      accentColor: '#3b82f6',
      bgColor: 'transparent',
      fontFamily: 'Outfit',
      fontSize: 1.0,
      align: 'center',
    },
  },
  {
    template: 'lower_third',
    label: 'Lower Third Nameplate',
    dur: 4.0,
    spec: {
      template: 'lower_third',
      heading: 'Elena Rostova',
      subheading: 'Lead Cinematographer',
      bodyText: '',
      textColor: '#ffffff',
      accentColor: '#3b82f6',
      bgColor: 'transparent',
      fontFamily: 'Outfit',
      fontSize: 1.0,
      align: 'left',
    },
  },
  {
    template: 'subtitle',
    label: 'Subtitle Caption',
    dur: 3.5,
    spec: {
      template: 'subtitle',
      heading: 'First light breaks across the ridge.',
      subheading: '',
      bodyText: '',
      textColor: '#f8fafc',
      accentColor: '#3b82f6',
      bgColor: 'transparent',
      fontFamily: 'Public Sans',
      fontSize: 1.0,
      align: 'center',
    },
  },
  {
    template: 'vector_badge',
    label: 'Vector Crest Title',
    dur: 4.0,
    spec: {
      template: 'vector_badge',
      heading: 'STUDIO CUT',
      subheading: '4K MASTER',
      bodyText: '',
      textColor: '#ffffff',
      accentColor: '#f59e0b',
      bgColor: 'transparent',
      fontFamily: 'Outfit',
      fontSize: 1.0,
      align: 'center',
    },
  },
  {
    template: 'scrolling_credits',
    label: 'Scrolling Motion Picture Credits',
    dur: 8.0,
    spec: {
      template: 'scrolling_credits',
      heading: 'END CREDITS',
      subheading: '',
      bodyText:
        'Directed By :: Jordan Vance\nCinematography :: Elena Rostova\nEdited By :: Obsidian Cut\nColor Grading :: Studio Lab\nMusic & Sound :: Pulse Audio\n\nFilmed on Location',
      textColor: '#f8fafc',
      accentColor: '#60a5fa',
      bgColor: 'transparent',
      fontFamily: 'Outfit',
      fontSize: 1.0,
      align: 'center',
    },
  },
];

export const MediaBin: React.FC<MediaBinProps> = ({
  assets,
  uploading,
  loadingSample,
  playhead,
  selectedGradeAssetId,
  selectedClip = null,
  visualClipCount = 0,
  onUploadFiles,
  onLoadSamplePack,
  onAddVisualToTimeline,
  onAddAudioToTimeline,
  onAddTitleClip,
  onOpenAssetColorGrade,
  onApplyTransition,
  onApplyTransitionToAll,
  onDeleteAsset,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [tab, setTab] = useState<'media' | 'transitions' | 'titles'>('media');
  const [assetFilter, setAssetFilter] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [showFormats, setShowFormats] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [draftTemplate, setDraftTemplate] = useState<TitleTemplateId>('main_title');
  const [draftSpec, setDraftSpec] = useState<TitleSpec>(TITLE_PRESETS[0].spec);
  const [draftDur, setDraftDur] = useState<number>(4.0);

  const counts = useMemo(() => {
    let image = 0;
    let video = 0;
    let audio = 0;
    for (const a of assets) {
      if (a.mediaType === 'image') image += 1;
      else if (a.mediaType === 'video') video += 1;
      else if (a.mediaType === 'audio') audio += 1;
    }
    return { all: assets.length, image, video, audio };
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assets.filter((a) => {
      if (assetFilter !== 'all' && a.mediaType !== assetFilter) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assets, assetFilter, searchQuery]);

  const visualAssets = filteredAssets.filter((a) => a.mediaType === 'image' || a.mediaType === 'video');
  const audioAssets = filteredAssets.filter((a) => a.mediaType === 'audio');

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUploadFiles(e.dataTransfer.files);
    }
  };

  const selectTemplate = (tpl: TitleTemplateId) => {
    const found = TITLE_PRESETS.find((p) => p.template === tpl) || TITLE_PRESETS[0];
    setDraftTemplate(tpl);
    setDraftSpec({ ...found.spec });
    setDraftDur(found.dur);
  };

  const totalSupportedFormats =
    SUPPORTED_FORMAT_GROUPS.images.length +
    SUPPORTED_FORMAT_GROUPS.videos.length +
    SUPPORTED_FORMAT_GROUPS.audio.length;

  return (
    <aside className="w-full lg:w-[312px] shrink-0 flex flex-col bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg overflow-hidden shadow-xs dark:shadow-none">
      {/* Tabs: Media Assets | Transitions | Titles & Credits */}
      <div className="flex border-b border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#171b22] shrink-0">
        <button
          type="button"
          onClick={() => setTab('media')}
          className={`flex-1 py-2 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
            tab === 'media'
              ? 'text-slate-900 dark:text-white border-b-2 border-blue-500 bg-white dark:bg-[#14171d]'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Media ({assets.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('transitions')}
          className={`flex-1 py-2 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer ${
            tab === 'transitions'
              ? 'text-slate-900 dark:text-white border-b-2 border-blue-500 bg-white dark:bg-[#14171d]'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3 h-3" />
          <span>Transitions</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('titles')}
          className={`flex-1 py-2 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer ${
            tab === 'titles'
              ? 'text-slate-900 dark:text-white border-b-2 border-blue-500 bg-white dark:bg-[#14171d]'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Type className="w-3 h-3" />
          <span>Titles</span>
        </button>
      </div>

      {tab === 'transitions' ? (
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
          visualClipCount={visualClipCount}
          onApplyTransition={(type, dur) => onApplyTransition?.(type, dur)}
          onApplyTransitionToAll={(type, dur) => onApplyTransitionToAll?.(type, dur)}
        />
      ) : tab === 'titles' ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
          <div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">Choose a Vector Style</p>
            <div className="space-y-1">
              {TITLE_PRESETS.map((p) => (
                <button
                  key={p.template}
                  type="button"
                  onClick={() => selectTemplate(p.template)}
                  className={`w-full px-2.5 py-1.5 rounded text-left border transition-colors cursor-pointer ${
                    draftTemplate === p.template
                      ? 'bg-blue-50 dark:bg-blue-600/20 border-blue-500 text-blue-800 dark:text-blue-100'
                      : 'bg-slate-50 dark:bg-[#101318] border-slate-200 dark:border-[#232832] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-[#232832]">
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Title Text</span>
              <input
                type="text"
                value={draftSpec.heading}
                onChange={(e) => setDraftSpec({ ...draftSpec, heading: e.target.value })}
                placeholder="Heading / Caption"
                className="w-full h-8 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100"
              />
            </label>
            {draftTemplate !== 'scrolling_credits' && draftTemplate !== 'subtitle' && (
              <label className="block space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Subtitle</span>
                <input
                  type="text"
                  value={draftSpec.subheading}
                  onChange={(e) => setDraftSpec({ ...draftSpec, subheading: e.target.value })}
                  placeholder="Subheading"
                  className="w-full h-8 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100"
                />
              </label>
            )}
            {draftTemplate === 'scrolling_credits' && (
              <label className="block space-y-1">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Credits Lines (Role :: Name)</span>
                <textarea
                  rows={4}
                  value={draftSpec.bodyText}
                  onChange={(e) => setDraftSpec({ ...draftSpec, bodyText: e.target.value })}
                  placeholder="Role :: Name (one per line)"
                  className="w-full p-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 font-mono-tabular text-[11px]"
                />
              </label>
            )}

            <TitleStyleControls spec={draftSpec} onChange={setDraftSpec} />

            <label className="flex items-center justify-between gap-2 rounded border border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#101318] px-2 py-1.5 text-[11px] text-slate-700 dark:text-slate-300">
              <span>Clip Duration (s)</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={draftDur}
                onChange={(e) => setDraftDur(Math.max(0.5, Number(e.target.value) || 2))}
                className="w-20 h-7 px-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 font-mono-tabular text-right focus:outline-none focus:border-blue-500"
              />
            </label>

            <button
              type="button"
              onClick={() => onAddTitleClip(draftSpec, draftDur)}
              className="w-full py-2 px-3 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Insert at Playhead ({formatTimecode(playhead)})</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Upload Dropzone */}
          <div className="p-3 border-b border-slate-200 dark:border-[#232832] space-y-2">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={handleDrop}
              className={`border border-dashed rounded-md p-2.5 text-center transition-colors ${
                isDraggingOver
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-slate-300 dark:border-[#2f3644] bg-slate-50 dark:bg-[#101318] hover:border-slate-400 dark:hover:border-slate-500'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPTED_MEDIA_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onUploadFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                className="w-full flex flex-col items-center gap-1 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 text-blue-500 dark:text-blue-400 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                )}
                <span className="font-medium">
                  {uploading ? 'Analyzing media & building proxies...' : 'Drop or Click to Upload Media'}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  JPG, PNG, HEIC, AVIF, TIFF, SVG, MP4, MOV, MKV, AVI, MP3, FLAC, WAV…
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowFormats((prev) => !prev)}
                className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 cursor-pointer"
              >
                <span>{showFormats ? 'Hide' : `View all ${totalSupportedFormats} supported formats`}</span>
                {showFormats ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showFormats && (
                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-[#232832] text-left space-y-1.5 text-[10px] text-slate-500 dark:text-slate-400 max-h-32 overflow-y-auto">
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Photos ({SUPPORTED_FORMAT_GROUPS.images.length}): </span>
                    <span className="font-mono-tabular">
                      {SUPPORTED_FORMAT_GROUPS.images.map((e) => e.slice(1).toUpperCase()).join(', ')}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Videos ({SUPPORTED_FORMAT_GROUPS.videos.length}): </span>
                    <span className="font-mono-tabular">
                      {SUPPORTED_FORMAT_GROUPS.videos.map((e) => e.slice(1).toUpperCase()).join(', ')}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Audio ({SUPPORTED_FORMAT_GROUPS.audio.length}): </span>
                    <span className="font-mono-tabular">
                      {SUPPORTED_FORMAT_GROUPS.audio.map((e) => e.slice(1).toUpperCase()).join(', ')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onLoadSamplePack}
              disabled={loadingSample || uploading}
              className="w-full py-1.5 px-3 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1d222b] dark:hover:bg-[#262d39] border border-slate-300 dark:border-[#2c3340] text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loadingSample ? (
                <Loader2 className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 animate-spin" />
              ) : (
                <FolderPlus className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
              )}
              <span>{loadingSample ? 'Loading Sample Pack...' : 'Load Sample Photos + 120 BPM'}</span>
            </button>

            {assets.length > 0 && (
              <div className="space-y-1.5">
                <div className="grid grid-cols-4 gap-1">
                  {(
                    [
                      { id: 'all', label: 'All', count: counts.all },
                      { id: 'image', label: 'Photos', count: counts.image },
                      { id: 'video', label: 'Videos', count: counts.video },
                      { id: 'audio', label: 'Audio', count: counts.audio },
                    ] as const
                  ).map((flt) => (
                    <button
                      key={flt.id}
                      type="button"
                      onClick={() => setAssetFilter(flt.id)}
                      className={`py-1 px-1 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                        assetFilter === flt.id
                          ? 'bg-blue-50 dark:bg-blue-600/20 border-blue-500 text-blue-700 dark:text-blue-200'
                          : 'bg-slate-50 dark:bg-[#0e1116] border-slate-300 dark:border-[#242a36] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {flt.label} ({flt.count})
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter media assets by name..."
                    className="w-full h-7 pl-8 pr-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#242a36] text-[11px] text-slate-900 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
              <span>Media Assets</span>
              <span className="font-mono-tabular text-slate-700 dark:text-slate-300">{filteredAssets.length} items</span>
            </div>

            {assetFilter !== 'audio' && (
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Visual Media & Logos</span>
                  <span className="font-mono-tabular">{visualAssets.length}</span>
                </div>
                {visualAssets.length === 0 ? (
                  <p className="text-xs text-slate-500 py-1">
                    {searchQuery || assetFilter !== 'all'
                      ? 'No visual files match your filter.'
                      : 'No photos or video clips yet.'}
                  </p>
                ) : (
                <div className="space-y-1.5">
                  {visualAssets.map((asset) => (
                    <div
                      key={asset.id}
                      draggable
                      onDoubleClick={() => onAddVisualToTimeline(asset, false)}
                      onDragStart={(e) => {
                        const payload = JSON.stringify(asset);
                        e.dataTransfer.setData('application/obsidiancut-asset', payload);
                        e.dataTransfer.setData('application/framecut-asset', payload);
                      }}
                      title="Double-click to add to Main Track, or drag onto any video track"
                      className="flex items-center gap-2 p-1.5 rounded bg-slate-50 dark:bg-[#101318] border border-slate-200 dark:border-[#222732] hover:border-slate-400 dark:hover:border-[#3b4557] transition-colors cursor-grab active:cursor-grabbing"
                    >
                      <div className="w-11 h-8 rounded bg-slate-200 dark:bg-[#1a1f27] overflow-hidden shrink-0 flex items-center justify-center">
                        {asset.thumbUrl ? (
                          <img
                            src={asset.thumbUrl}
                            alt={asset.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : asset.mediaType === 'video' ? (
                          <Film className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">{asset.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono-tabular truncate">
                          {asset.width}×{asset.height}
                          {asset.mediaType === 'video' && asset.duration > 0
                            ? ` · ${asset.duration.toFixed(1)}s`
                            : ''}
                          {asset.isVfr ? ' · VFR' : ''}
                          {asset.hasProxy ? ' · Proxy' : ''}
                          {asset.codec ? ` · ${asset.codec.toUpperCase()}` : ''}
                          {asset.colorGrade?.enabled ? ' · Graded' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onAddVisualToTimeline(asset, false)}
                          title="Add to Main Track (V1)"
                          className="px-1.5 py-1 rounded bg-slate-200 hover:bg-blue-600 dark:bg-[#1d222b] dark:hover:bg-blue-600 text-[10px] font-medium text-slate-800 dark:text-slate-200 hover:text-white flex items-center gap-0.5 transition-colors cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add</span>
                        </button>
                        {onOpenAssetColorGrade && asset.mediaType === 'image' && (
                          <button
                            type="button"
                            onClick={() => onOpenAssetColorGrade(asset)}
                            title="Color grade this uploaded picture"
                            aria-label={`Color grade ${asset.name}`}
                            className={`p-1 rounded transition-colors cursor-pointer ${
                              selectedGradeAssetId === asset.id || asset.colorGrade?.enabled
                                ? 'bg-blue-50 dark:bg-blue-600/25 text-blue-600 dark:text-blue-300 border border-blue-500/60'
                                : 'bg-slate-200 hover:bg-blue-600/80 dark:bg-[#1d222b] dark:hover:bg-blue-600/80 text-slate-700 dark:text-slate-300 hover:text-white'
                            }`}
                          >
                            <Palette className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onAddVisualToTimeline(asset, true)}
                          title="Add as Overlay / Watermark on top track"
                          className="p-1 rounded bg-slate-200 hover:bg-indigo-600 dark:bg-[#1d222b] dark:hover:bg-indigo-600 text-slate-700 dark:text-slate-300 hover:text-white transition-colors cursor-pointer"
                        >
                          <Layers className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteAsset(asset.id)}
                          title="Delete file from project"
                          className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-200 dark:hover:bg-[#232832] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {(assetFilter === 'all' || assetFilter === 'audio') && (
            <div className={assetFilter === 'all' ? 'pt-2 border-t border-slate-200 dark:border-[#232832]' : ''}>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">Audio & Music</span>
                <span className="font-mono-tabular">{audioAssets.length}</span>
              </div>
              {audioAssets.length === 0 ? (
                <p className="text-xs text-slate-500 py-1">
                  {searchQuery || assetFilter !== 'all' ? 'No audio files match your filter.' : 'No songs uploaded yet.'}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {audioAssets.map((asset) => (
                    <div
                      key={asset.id}
                      draggable
                      onDoubleClick={() => onAddAudioToTimeline(asset)}
                      onDragStart={(e) => {
                        const payload = JSON.stringify(asset);
                        e.dataTransfer.setData('application/obsidiancut-asset', payload);
                        e.dataTransfer.setData('application/framecut-asset', payload);
                      }}
                      title="Double-click or drag onto any audio track"
                      className="flex items-center gap-2 p-2 rounded bg-slate-50 dark:bg-[#101318] border border-slate-200 dark:border-[#222732] hover:border-slate-400 dark:hover:border-[#3b4557] transition-colors cursor-grab active:cursor-grabbing"
                    >
                      <div className="w-8 h-8 rounded bg-blue-50 dark:bg-[#192231] flex items-center justify-center shrink-0">
                        <Music className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">{asset.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono-tabular truncate">
                          {formatTimecode(asset.duration)}
                          {asset.bpm ? ` · ${asset.bpm} BPM` : ''}
                          {asset.codec ? ` · ${asset.codec.toUpperCase()}` : ''}
                          {asset.hasProxy ? ' · Proxy' : ''}
                          {` · ${formatBytes(asset.size)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onAddAudioToTimeline(asset)}
                          title="Add song to audio track"
                          className="px-1.5 py-1 rounded bg-slate-200 hover:bg-blue-600 dark:bg-[#1d222b] dark:hover:bg-blue-600 text-[10px] font-medium text-slate-800 dark:text-slate-200 hover:text-white flex items-center gap-0.5 transition-colors cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteAsset(asset.id)}
                          title="Delete song from project"
                          className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-200 dark:hover:bg-[#232832] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
};
