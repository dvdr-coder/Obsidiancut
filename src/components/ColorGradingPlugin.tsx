import React from 'react';
import { AlertTriangle, Eye, Plus, RotateCcw, Sliders } from 'lucide-react';
import { ColorGradeConfig, ColorPreset, DEFAULT_COLOR_GRADE } from '../types/editor';
import { getPluginFault, resetPluginFault, sanitizeColorGrade } from '../utils/pluginSandbox';
import { resolveEffectiveColorGrade } from '../utils/timelineMath';

interface ColorGradingPluginProps {
  config: ColorGradeConfig;
  bypass: boolean;
  embedded?: boolean;
  title?: string;
  subtitle?: string;
  previewImageUrl?: string;
  onAddPictureToTimeline?: () => void;
  onSyncToAllMatchingClips?: () => void;
  onChange: (next: ColorGradeConfig) => void;
  onToggleBypass: () => void;
}

const PRESETS: { id: ColorPreset; label: string }[] = [
  { id: 'none', label: 'Neutral' },
  { id: 'cinematic_teal', label: 'Teal & Orange' },
  { id: 'kodak_warm', label: 'Warm Film' },
  { id: 'mono_noir', label: 'Mono Noir' },
  { id: 'matte_fade', label: 'Matte Fade' },
  { id: 'vivid_hdr', label: 'Vivid HDR' },
];

export const ColorGradingPlugin: React.FC<ColorGradingPluginProps> = ({
  config,
  bypass,
  embedded = false,
  title = 'Color Grading Plug-in',
  subtitle,
  previewImageUrl,
  onAddPictureToTimeline,
  onSyncToAllMatchingClips,
  onChange,
  onToggleBypass,
}) => {
  const faultMsg = getPluginFault('color-grading');

  const update = <K extends keyof ColorGradeConfig>(key: K, val: ColorGradeConfig[K]) => {
    onChange(sanitizeColorGrade({ ...config, enabled: true, [key]: val }));
  };

  const previewEff =
    config.enabled && !bypass ? resolveEffectiveColorGrade(sanitizeColorGrade(config)) : null;
  const cssFilter = previewEff
    ? `brightness(${Math.max(10, Math.round((1 + previewEff.brightness) * (1 + (previewEff.gamma - 1) * 0.25) * 100))}%) contrast(${Math.max(10, Math.round(previewEff.contrast * 100))}%) saturate(${Math.max(0, Math.round(previewEff.saturation * 100))}%)`
    : 'none';

  return (
    <aside
      className={
        embedded
          ? 'w-full flex flex-col bg-transparent overflow-hidden'
          : 'w-full lg:w-[272px] shrink-0 flex flex-col bg-[#14171d] border border-[#232832] rounded-lg overflow-hidden'
      }
    >
      <div className="px-3.5 py-2.5 border-b border-[#232832] flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <Sliders className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-slate-100 truncate">{title}</h2>
            {subtitle && (
              <p className="text-[10px] text-slate-400 truncate">{subtitle}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...config, enabled: !config.enabled })}
          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors shrink-0 ${
            config.enabled
              ? 'bg-blue-600 text-white'
              : 'bg-[#1e232c] text-slate-400 hover:text-slate-200'
          }`}
        >
          {config.enabled ? 'Active' : 'Bypassed'}
        </button>
      </div>

      {faultMsg && (
        <div className="px-3.5 py-2 bg-amber-950/50 border-b border-amber-700/50 text-[11px] text-amber-200 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 truncate">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">Plugin isolated: {faultMsg}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              resetPluginFault('color-grading');
              onChange({ ...DEFAULT_COLOR_GRADE, enabled: false });
            }}
            className="text-amber-300 underline shrink-0"
          >
            Reset
          </button>
        </div>
      )}

      <div className="p-3.5 space-y-4 overflow-y-auto flex-1">
        {previewImageUrl && (
          <div className="space-y-1.5">
            <div className="relative w-full h-28 rounded overflow-hidden border border-[#242a36] bg-[#0b0d11] flex items-center justify-center">
              <img
                src={previewImageUrl}
                alt={subtitle || 'Uploaded picture preview'}
                referrerPolicy="no-referrer"
                style={{ filter: cssFilter }}
                className="max-w-full max-h-full object-contain"
              />
              {previewEff && Math.abs(previewEff.temperature) > 0.01 && (
                <div
                  className="absolute inset-0 pointer-events-none mix-blend-soft-light"
                  style={{
                    background:
                      previewEff.temperature > 0
                        ? `rgba(255, 165, 65, ${Math.min(0.45, previewEff.temperature * 0.7)})`
                        : `rgba(60, 145, 255, ${Math.min(0.45, Math.abs(previewEff.temperature) * 0.7)})`,
                  }}
                />
              )}
              {previewEff && Math.abs(previewEff.tint) > 0.01 && (
                <div
                  className="absolute inset-0 pointer-events-none mix-blend-soft-light"
                  style={{
                    background:
                      previewEff.tint > 0
                        ? `rgba(70, 210, 110, ${Math.min(0.35, previewEff.tint * 0.6)})`
                        : `rgba(215, 70, 190, ${Math.min(0.35, Math.abs(previewEff.tint) * 0.6)})`,
                  }}
                />
              )}
              {previewEff && previewEff.vignette > 0.02 && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: `radial-gradient(circle, rgba(0,0,0,0) 35%, rgba(0,0,0,${Math.min(0.88, previewEff.vignette * 0.9)}) 100%)`,
                  }}
                />
              )}
            </div>
            {onAddPictureToTimeline && (
              <button
                type="button"
                onClick={onAddPictureToTimeline}
                className="w-full py-1 px-2 rounded bg-[#1d222b] hover:bg-blue-600 border border-[#2c3340] text-[11px] font-medium text-slate-200 hover:text-white flex items-center justify-center gap-1 transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>Add Graded Picture to Timeline</span>
              </button>
            )}
          </div>
        )}

        {onSyncToAllMatchingClips && (
          <button
            type="button"
            onClick={onSyncToAllMatchingClips}
            className="w-full py-1 px-2 rounded bg-[#10151f] hover:bg-[#1a2232] border border-[#273142] text-[11px] text-blue-300 hover:text-blue-200 transition-colors"
          >
            Apply this grade to all clips using this picture
          </button>
        )}

        {/* Preset Grid */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-300">Film Look Presets</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleBypass}
                title="Compare Before / After"
                className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 border transition-colors ${
                  bypass
                    ? 'border-amber-500/60 text-amber-300 bg-amber-500/10'
                    : 'border-[#2a303d] text-slate-300 hover:text-white bg-[#101318]'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>{bypass ? 'Original' : 'Compare'}</span>
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...DEFAULT_COLOR_GRADE, enabled: config.enabled })}
                title="Reset sliders"
                className="p-1 rounded border border-[#2a303d] text-slate-400 hover:text-white bg-[#101318]"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => update('preset', p.id)}
                className={`px-2.5 py-1.5 rounded text-xs font-medium text-left border transition-colors truncate ${
                  config.preset === p.id && config.enabled
                    ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                    : 'bg-[#101318] border-[#242934] text-slate-300 hover:border-slate-500'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        <div className="space-y-3 pt-2 border-t border-[#232832]">
          <SliderRow
            label="Exposure"
            value={config.exposure}
            display={`${config.exposure >= 0 ? '+' : ''}${config.exposure.toFixed(2)}`}
            min={-0.45}
            max={0.45}
            step={0.01}
            onChange={(v) => update('exposure', v)}
          />
          <SliderRow
            label="Contrast"
            value={config.contrast}
            display={`${Math.round(config.contrast * 100)}%`}
            min={0.5}
            max={1.7}
            step={0.02}
            onChange={(v) => update('contrast', v)}
          />
          <SliderRow
            label="Saturation"
            value={config.saturation}
            display={`${Math.round(config.saturation * 100)}%`}
            min={0}
            max={2.0}
            step={0.02}
            onChange={(v) => update('saturation', v)}
          />
          <SliderRow
            label="Gamma"
            value={config.gamma}
            display={config.gamma.toFixed(2)}
            min={0.6}
            max={1.6}
            step={0.02}
            onChange={(v) => update('gamma', v)}
          />
          <SliderRow
            label="Temperature"
            value={config.temperature}
            display={`${config.temperature >= 0 ? '+' : ''}${Math.round(config.temperature * 100)}`}
            min={-0.5}
            max={0.5}
            step={0.02}
            onChange={(v) => update('temperature', v)}
          />
          <SliderRow
            label="Tint"
            value={config.tint}
            display={`${config.tint >= 0 ? '+' : ''}${Math.round(config.tint * 100)}`}
            min={-0.5}
            max={0.5}
            step={0.02}
            onChange={(v) => update('tint', v)}
          />
          <SliderRow
            label="Vignette"
            value={config.vignette}
            display={`${Math.round(config.vignette * 100)}%`}
            min={0}
            max={1}
            step={0.02}
            onChange={(v) => update('vignette', v)}
          />
        </div>
      </div>
    </aside>
  );
};

interface SliderRowProps {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}) => (
  <div>
    <div className="flex items-center justify-between text-xs mb-1">
      <span className="text-slate-300">{label}</span>
      <span className="text-slate-400 font-mono-tabular">{display}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="studio-slider w-full"
    />
  </div>
);
