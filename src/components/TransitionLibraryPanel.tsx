import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, Sparkles, Wand2 } from 'lucide-react';
import {
  TRANSITION_GROUPS,
  TRANSITION_OPTIONS,
  TransitionType,
} from '../types/editor';

interface TransitionLibraryPanelProps {
  selectedTransition: TransitionType | null;
  selectedClipName?: string | null;
  selectedDuration: number;
  hasTargetClip: boolean;
  visualClipCount: number;
  onApplyTransition: (type: TransitionType, duration: number, shouldCommit?: boolean) => void;
  onApplyTransitionToAll: (type: TransitionType, duration: number) => void;
}

const DURATION_PRESETS = [0.25, 0.45, 0.75, 1.2];

const TransitionPreviewThumbnail: React.FC<{ type: TransitionType; active: boolean }> = ({
  type,
  active,
}) => {
  return (
    <div
      className={`relative h-10 w-full rounded overflow-hidden border bg-[#0b0e14] ${
        active ? 'border-blue-400/80' : 'border-[#252b37]'
      }`}
    >
      {/* Outgoing Clip A (cool slate) */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1f293d] to-[#111827] flex items-center justify-start pl-2">
        <span className="text-[9px] font-mono-tabular font-semibold text-slate-300/80">A</span>
      </div>

      {/* Incoming Clip B visual geometry preview */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-blue-600/80 to-indigo-700/85 flex items-center justify-end pr-2 transition-all"
        style={(() => {
          switch (type) {
            case 'cut':
              return { clipPath: 'inset(0 0 0 50%)' };
            case 'fade':
            case 'dissolve':
              return { opacity: 0.55 };
            case 'fadeblack':
              return {
                background: 'linear-gradient(90deg, transparent 25%, #000000 50%, rgba(37,99,235,0.85) 85%)',
              };
            case 'fadewhite':
              return {
                background: 'linear-gradient(90deg, transparent 25%, #ffffff 50%, rgba(37,99,235,0.85) 85%)',
              };
            case 'fadegrays':
              return {
                background: 'linear-gradient(90deg, transparent 20%, #64748b 50%, rgba(37,99,235,0.85) 85%)',
              };
            case 'wipe':
            case 'wipeleft':
            case 'slideleft':
            case 'smoothleft':
              return { clipPath: 'inset(0 0 0 42%)' };
            case 'wiperight':
            case 'slideright':
            case 'smoothright':
              return { clipPath: 'inset(0 42% 0 0)' };
            case 'wipeup':
            case 'slideup':
            case 'smoothup':
              return { clipPath: 'inset(42% 0 0 0)' };
            case 'wipedown':
            case 'slidedown':
            case 'smoothdown':
              return { clipPath: 'inset(0 0 42% 0)' };
            case 'diagtl':
              return { clipPath: 'polygon(0 0, 75% 0, 0 75%)' };
            case 'diagtr':
              return { clipPath: 'polygon(25% 0, 100% 0, 100% 75%)' };
            case 'circleopen':
              return { clipPath: 'circle(34% at 50% 50%)' };
            case 'circleclose':
              return { clipPath: 'circle(24% at 50% 50%)', opacity: 0.85 };
            case 'vertopen':
              return { clipPath: 'inset(0 24% 0 24%)' };
            case 'horzopen':
              return { clipPath: 'inset(24% 0 24% 0)' };
            case 'radial':
              return { clipPath: 'polygon(50% 50%, 50% 0, 100% 0, 100% 100%, 50% 100%)' };
            case 'squeezeh':
              return { clipPath: 'inset(0 18% 0 18%)' };
            case 'squeezev':
              return { clipPath: 'inset(18% 0 18% 0)' };
            case 'pixelize':
              return {
                backgroundImage:
                  'repeating-conic-gradient(rgba(59,130,246,0.65) 0% 25%, rgba(15,23,42,0.75) 0% 50%)',
                backgroundSize: '8px 8px',
              };
            case 'hblur':
              return {
                background: 'linear-gradient(90deg, transparent 10%, rgba(96,165,250,0.6) 50%, rgba(37,99,235,0.9) 90%)',
              };
            default:
              return { opacity: 0.6 };
          }
        })()}
      >
        <span className="text-[9px] font-mono-tabular font-semibold text-white">B</span>
      </div>
    </div>
  );
};

export const TransitionLibraryPanel: React.FC<TransitionLibraryPanelProps> = ({
  selectedTransition,
  selectedClipName,
  selectedDuration,
  hasTargetClip,
  visualClipCount,
  onApplyTransition,
  onApplyTransitionToAll,
}) => {
  const [groupFilter, setGroupFilter] = useState<string>('All');
  const [query, setQuery] = useState<string>('');
  const [duration, setDuration] = useState<number>(selectedDuration || 0.45);
  const [pickedType, setPickedType] = useState<TransitionType>(selectedTransition || 'dissolve');
  const sliderCommittedRef = useRef<boolean>(false);

  useEffect(() => {
    setDuration(selectedDuration > 0 ? selectedDuration : 0.45);
    if (selectedTransition) {
      setPickedType(selectedTransition);
    }
  }, [selectedClipName, selectedDuration, selectedTransition]);

  const activeType = selectedTransition || pickedType;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TRANSITION_OPTIONS.filter((opt) => {
      if (groupFilter !== 'All' && opt.group !== groupFilter) return false;
      if (q && !opt.label.toLowerCase().includes(q) && !opt.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [groupFilter, query]);

  const handleCardClick = (type: TransitionType) => {
    setPickedType(type);
    if (hasTargetClip) {
      onApplyTransition(type, type === 'cut' ? 0 : duration);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 text-xs">
      {/* Header & Target Readout */}
      <div className="p-3 border-b border-slate-200 dark:border-[#232832] space-y-2.5 shrink-0 bg-slate-50 dark:bg-[#11141a]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-900 dark:text-slate-200 truncate">
              Transition Library ({TRANSITION_OPTIONS.length})
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {hasTargetClip
                ? `Target: ${selectedClipName || 'Selected Clip'}`
                : 'Click a visual clip on timeline, or apply to all clips'}
            </p>
          </div>
          <span className="text-[10px] font-mono-tabular text-blue-600 dark:text-blue-300 shrink-0">
            {duration.toFixed(2)}s
          </span>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transitions (iris, wipe, blur...)"
            className="w-full h-7 pl-8 pr-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#242a36] text-[11px] text-slate-900 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Duration Quick Selector */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
            <span>Transition Duration</span>
            <div className="flex items-center gap-1">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setDuration(preset);
                    if (hasTargetClip && activeType !== 'cut') {
                      onApplyTransition(activeType, preset);
                    }
                  }}
                  className={`px-1.5 py-0.5 rounded font-mono-tabular text-[10px] border transition-colors cursor-pointer ${
                    Math.abs(duration - preset) < 0.02
                      ? 'bg-blue-50 dark:bg-blue-600/25 border-blue-500 text-blue-700 dark:text-blue-200'
                      : 'bg-white dark:bg-[#0e1116] border-slate-300 dark:border-[#252b37] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {preset}s
                </button>
              ))}
            </div>
          </div>
          <input
            type="range"
            min={0.1}
            max={1.8}
            step={0.05}
            value={duration}
            onChange={(e) => {
              const val = Number(e.target.value);
              setDuration(val);
              if (hasTargetClip && activeType !== 'cut') {
                const shouldCommit = !sliderCommittedRef.current;
                sliderCommittedRef.current = true;
                onApplyTransition(activeType, val, shouldCommit);
              }
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
        </div>

        {/* Category Filter Buttons */}
        <div className="flex flex-wrap gap-1">
          {['All', ...TRANSITION_GROUPS].map((grp) => (
            <button
              key={grp}
              type="button"
              onClick={() => setGroupFilter(grp)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                groupFilter === grp
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-white dark:bg-[#0e1116] border-slate-300 dark:border-[#242a36] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {grp}
            </button>
          ))}
        </div>
      </div>

      {/* Transition Grid */}
      <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2 content-start">
        {filtered.length === 0 ? (
          <div className="col-span-2 py-6 text-center text-[11px] text-slate-500">
            No transitions match “{query}”.
          </div>
        ) : (
          filtered.map((opt) => {
            const isSelected = activeType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleCardClick(opt.value)}
                title={opt.description}
                className={`p-2 rounded border text-left transition-colors flex flex-col gap-1.5 cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-600/15 border-blue-500 text-blue-900 dark:text-white'
                    : 'bg-slate-50 dark:bg-[#101318] border-slate-200 dark:border-[#222732] hover:border-slate-400 dark:hover:border-slate-500 text-slate-800 dark:text-slate-200'
                }`}
              >
                <TransitionPreviewThumbnail type={opt.value} active={isSelected} />
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-medium truncate">{opt.label}</span>
                  {isSelected && <Check className="w-3 h-3 text-blue-500 dark:text-blue-400 shrink-0" />}
                </div>
                <p className="text-[9px] text-slate-500 dark:text-slate-400 truncate">{opt.description}</p>
              </button>
            );
          })
        )}
      </div>

      {/* Batch Apply Footer */}
      <div className="p-2.5 border-t border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#11141a] flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          disabled={!hasTargetClip}
          onClick={() => onApplyTransition(activeType, activeType === 'cut' ? 0 : duration)}
          className="flex-1 py-1.5 px-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
        >
          <Wand2 className="w-3 h-3" />
          <span>Apply to Clip</span>
        </button>
        <button
          type="button"
          disabled={visualClipCount < 2}
          onClick={() => onApplyTransitionToAll(activeType, activeType === 'cut' ? 0 : duration)}
          title="Apply selected transition between all touching visual clips"
          className="py-1.5 px-2.5 rounded bg-white hover:bg-slate-100 dark:bg-[#1d222b] dark:hover:bg-[#272f3d] border border-slate-300 dark:border-[#2c3442] disabled:opacity-40 text-slate-700 dark:text-slate-200 text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
        >
          <Sparkles className="w-3 h-3 text-amber-500 dark:text-amber-400" />
          <span>Apply All</span>
        </button>
      </div>
    </div>
  );
};
