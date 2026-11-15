import React, { useEffect, useState } from 'react';
import { Music, Wand2 } from 'lucide-react';
import { MediaAsset } from '../types/editor';
import { AutoAssembleOptions } from '../utils/timelineMath';

interface AutoModeBarProps {
  visualAssets: MediaAsset[];
  audioAssets: MediaAsset[];
  onAutoAssemble: (audioId: string | null, options: AutoAssembleOptions) => void;
}

export const AutoModeBar: React.FC<AutoModeBarProps> = ({
  visualAssets,
  audioAssets,
  onAutoAssemble,
}) => {
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [beatStride, setBeatStride] = useState<AutoAssembleOptions['beatStride']>(2);
  const [transitionStyle, setTransitionStyle] =
    useState<AutoAssembleOptions['transitionStyle']>('dynamic');
  const [transitionDuration, setTransitionDuration] = useState<number>(0.45);
  const [enableMotion, setEnableMotion] = useState<boolean>(true);
  const [maxSongDuration, setMaxSongDuration] = useState<number>(32);

  useEffect(() => {
    if (!selectedAudioId && audioAssets.length > 0) {
      setSelectedAudioId(audioAssets[0].id);
    } else if (selectedAudioId && !audioAssets.some((a) => a.id === selectedAudioId)) {
      setSelectedAudioId(audioAssets[0]?.id || '');
    }
  }, [audioAssets, selectedAudioId]);

  const activeSong = audioAssets.find((a) => a.id === selectedAudioId) || null;

  return (
    <div className="bg-white dark:bg-[#14171d] border border-slate-200 dark:border-[#232832] rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-xs dark:shadow-none">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-slate-600 dark:text-slate-400">Background Song</label>
          <select
            value={selectedAudioId}
            onChange={(e) => setSelectedAudioId(e.target.value)}
            className="h-8 px-2.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 min-w-[175px]"
          >
            {audioAssets.length === 0 ? (
              <option value="">No music (use timed cuts)</option>
            ) : (
              <>
                {audioAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.bpm ? `(${a.bpm} BPM)` : ''}
                  </option>
                ))}
                <option value="">Silent (no background song)</option>
              </>
            )}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-slate-600 dark:text-slate-400">Beat Sync Pace</label>
          <select
            value={String(beatStride)}
            onChange={(e) => {
              const v = e.target.value;
              setBeatStride(v === 'fit' ? 'fit' : (Number(v) as 1 | 2 | 4));
            }}
            className="h-8 px-2.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="1">Fast · Every Beat</option>
            <option value="2">Balanced · Every 2 Beats</option>
            <option value="4">Cinematic · Every 4 Beats</option>
            <option value="fit">Fit All Slides Evenly</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-slate-600 dark:text-slate-400">Transition Mix</label>
          <select
            value={transitionStyle}
            onChange={(e) =>
              setTransitionStyle(e.target.value as AutoAssembleOptions['transitionStyle'])
            }
            className="h-8 px-2.5 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="dynamic">Dynamic Variety</option>
            <option value="crossfade">Smooth Crossfades</option>
            <option value="directional">Slides & Wipes</option>
            <option value="geometric">Iris & Radial</option>
            <option value="cut">Hard Beat Cuts</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-slate-600 dark:text-slate-400">Length Limit</label>
          <select
            value={String(maxSongDuration)}
            onChange={(e) => setMaxSongDuration(Number(e.target.value))}
            className="h-8 px-2 rounded bg-slate-50 dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="15">15s Short / Reel</option>
            <option value="32">32s Highlight</option>
            <option value="60">60s Feature</option>
            <option value="300">Full Song</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-slate-600 dark:text-slate-400">
            Transition ({transitionStyle === 'cut' ? '0.00s' : `${transitionDuration.toFixed(2)}s`})
          </label>
          <input
            type="range"
            min="0.15"
            max="1.2"
            step="0.05"
            disabled={transitionStyle === 'cut'}
            value={transitionDuration}
            onChange={(e) => setTransitionDuration(Number(e.target.value))}
            className="studio-slider w-24 mt-1.5"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 self-end h-8 cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={enableMotion}
            onChange={(e) => setEnableMotion(e.target.checked)}
            className="rounded border-slate-300 dark:border-[#2a303d] bg-white dark:bg-[#0e1116] text-blue-600"
          />
          <span>Ken Burns Motion</span>
        </label>
      </div>

      <div className="flex items-center gap-3 self-end">
        {activeSong && (
          <span className="text-xs text-slate-600 dark:text-slate-400 font-mono-tabular hidden xl:inline">
            <Music className="w-3 h-3 inline mr-1 text-blue-500 dark:text-blue-400" />
            {activeSong.bpm || 120} BPM · {activeSong.beats?.length || 0} beats
          </span>
        )}

        <button
          type="button"
          disabled={visualAssets.length === 0}
          title={
            visualAssets.length === 0
              ? 'Upload photos/videos or load the Sample Pack first'
              : `Generate beat-synced slideshow from ${visualAssets.length} visual file(s)`
          }
          onClick={() =>
            onAutoAssemble(selectedAudioId || null, {
              beatStride,
              transitionStyle,
              transitionDuration,
              enableMotion,
              maxSongDuration,
            })
          }
          className="h-9 px-4 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Wand2 className="w-3.5 h-3.5" />
          <span>
            {visualAssets.length === 0
              ? 'Add Media to Auto-Sync'
              : `Auto-Assemble (${visualAssets.length})`}
          </span>
        </button>
      </div>
    </div>
  );
};
