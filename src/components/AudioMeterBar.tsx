import React, { useEffect, useRef, useState } from 'react';
import { dbToMeterFraction } from '../utils/timelineMath';

interface AudioMeterBarProps {
  leftDb: number;
  rightDb: number;
  orientation?: 'horizontal' | 'vertical';
  compact?: boolean;
  heightClass?: string;
  showDbLabels?: boolean;
  label?: string;
  muted?: boolean;
  clipping?: boolean;
}

export const AudioMeterBar: React.FC<AudioMeterBarProps> = ({
  leftDb,
  rightDb,
  orientation = 'vertical',
  compact = false,
  heightClass = 'h-24',
  showDbLabels = true,
  label,
  muted = false,
  clipping = false,
}) => {
  const [peakL, setPeakL] = useState<number>(-60);
  const [peakR, setPeakR] = useState<number>(-60);
  const decayTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setPeakL((prev) => (leftDb >= prev ? leftDb : prev));
    setPeakR((prev) => (rightDb >= prev ? rightDb : prev));

    if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
    decayTimerRef.current = window.setTimeout(() => {
      setPeakL(leftDb);
      setPeakR(rightDb);
    }, 900);

    return () => {
      if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
    };
  }, [leftDb, rightDb]);

  const fracL = muted ? 0 : dbToMeterFraction(leftDb);
  const fracR = muted ? 0 : dbToMeterFraction(rightDb);
  const peakFracL = muted ? 0 : dbToMeterFraction(peakL);
  const peakFracR = muted ? 0 : dbToMeterFraction(peakR);
  const maxDb = Math.max(leftDb, rightDb);
  const isHot = !muted && (clipping || maxDb > -1.0);

  if (orientation === 'horizontal') {
    const barWidth = compact ? 'w-24 sm:w-28' : 'w-full';
    return (
      <div className="flex items-center gap-2 select-none">
        {label && <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400 shrink-0">{label}</span>}
        <div className={`${barWidth} flex flex-col gap-[3px]`}>
          {[
            { ch: 'L', frac: fracL, peak: peakFracL },
            { ch: 'R', frac: fracR, peak: peakFracR },
          ].map((row) => (
            <div key={row.ch} className="flex items-center gap-1">
              <span className="text-[8px] font-mono-tabular text-slate-500 w-2 leading-none">{row.ch}</span>
              <div className="relative flex-1 h-1.5 rounded-xs bg-slate-900 dark:bg-[#090b0f] border border-slate-700 dark:border-[#222834] overflow-hidden">
                <div
                  style={{ width: `${Math.round(row.frac * 100)}%` }}
                  className="h-full transition-[width] duration-75 bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500"
                />
                {row.peak > 0.03 && (
                  <div
                    style={{ left: `calc(${Math.min(98, Math.round(row.peak * 100))}% - 1px)` }}
                    className={`absolute top-0 bottom-0 w-[2px] ${
                      row.peak > 0.92 ? 'bg-red-400' : 'bg-white/90'
                    }`}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        {showDbLabels && (
          <span
            className={`text-[10px] font-mono-tabular w-12 text-right whitespace-nowrap shrink-0 ${
              muted
                ? 'text-slate-400 dark:text-slate-500'
                : isHot
                  ? 'text-red-600 dark:text-red-400 font-semibold'
                  : maxDb > -6
                    ? 'text-amber-600 dark:text-amber-300'
                    : 'text-emerald-600 dark:text-emerald-300'
            }`}
          >
            {muted || maxDb <= -58 ? '-∞ dB' : `${maxDb.toFixed(1)} dB`}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      {label && <span className="text-[9px] font-medium text-slate-600 dark:text-slate-400">{label}</span>}
      <div className="flex items-end gap-1">
        {/* dB Scale ticks */}
        {!compact && (
          <div className={`${heightClass} flex flex-col justify-between text-[8px] font-mono-tabular text-slate-500 pr-0.5 leading-none`}>
            <span>0</span>
            <span>-12</span>
            <span>-24</span>
            <span>-48</span>
          </div>
        )}
        {/* Stereo L / R Meter Bars */}
        <div className="flex items-end gap-[3px]">
          {[
            { ch: 'L', frac: fracL, peak: peakFracL },
            { ch: 'R', frac: fracR, peak: peakFracR },
          ].map((col) => (
            <div
              key={col.ch}
              className={`relative ${compact ? 'w-2' : 'w-2.5'} ${heightClass} rounded-xs bg-slate-900 dark:bg-[#090b0f] border border-slate-700 dark:border-[#222834] p-[1px] flex flex-col justify-end overflow-hidden`}
              title={`${col.ch}: ${muted || maxDb <= -58 ? '-∞ dBFS' : `${(col.ch === 'L' ? leftDb : rightDb).toFixed(1)} dBFS`}`}
            >
              <div
                style={{ height: `${Math.round(col.frac * 100)}%` }}
                className="w-full rounded-xs transition-[height] duration-75 bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500"
              />
              {col.peak > 0.03 && (
                <div
                  style={{ bottom: `calc(${Math.min(97, Math.round(col.peak * 100))}% - 1px)` }}
                  className={`absolute left-0 right-0 h-[2px] ${
                    col.peak > 0.92 ? 'bg-red-400' : 'bg-white'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {showDbLabels && (
        <span
          className={`text-[9px] font-mono-tabular leading-none ${
            muted
              ? 'text-slate-400 dark:text-slate-500'
              : isHot
                ? 'text-red-600 dark:text-red-400 font-semibold'
                : maxDb > -6
                  ? 'text-amber-600 dark:text-amber-300'
                  : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          {muted || maxDb <= -58 ? '-∞' : `${maxDb.toFixed(1)} dB`}
        </span>
      )}
    </div>
  );
};
