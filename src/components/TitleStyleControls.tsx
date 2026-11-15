import React, { useEffect, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Pipette } from 'lucide-react';
import { TITLE_FONT_OPTIONS, TitleSpec } from '../types/editor';

export const COLOR_SWATCHES: { hex: string; name: string }[] = [
  { hex: '#ffffff', name: 'Pure White' },
  { hex: '#f8fafc', name: 'Soft Ivory' },
  { hex: '#cbd5e1', name: 'Silver' },
  { hex: '#94a3b8', name: 'Slate' },
  { hex: '#0d1117', name: 'Obsidian' },
  { hex: '#000000', name: 'Pitch Black' },
  { hex: '#ef4444', name: 'Cinema Red' },
  { hex: '#f97316', name: 'Sunset Orange' },
  { hex: '#f59e0b', name: 'Amber Gold' },
  { hex: '#fde047', name: 'Warm Yellow' },
  { hex: '#10b981', name: 'Emerald' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#3b82f6', name: 'Electric Blue' },
  { hex: '#6366f1', name: 'Indigo' },
  { hex: '#8b5cf6', name: 'Violet' },
  { hex: '#ec4899', name: 'Rose' },
];

export function normalizeHex6(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toLowerCase()}`;
  }
  return null;
}

export function normalizeHexOnCommit(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    const [r, g, b] = cleaned.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function toPickerHex(value: string, fallback = '#ffffff'): string {
  return normalizeHexOnCommit(value) || fallback;
}

interface HexColorFieldProps {
  label: string;
  value: string;
  fallbackHex?: string;
  allowTransparent?: boolean;
  onChange: (nextColor: string) => void;
  onCommit?: () => void;
}

export const HexColorField: React.FC<HexColorFieldProps> = ({
  label,
  value,
  fallbackHex = '#ffffff',
  allowTransparent = false,
  onChange,
  onCommit,
}) => {
  const isTransparent = allowTransparent && value === 'transparent';
  const pickerHex = toPickerHex(value, fallbackHex);
  const [hexDraft, setHexDraft] = useState<string>(isTransparent ? 'transparent' : pickerHex);
  const [showSwatches, setShowSwatches] = useState(false);

  useEffect(() => {
    setHexDraft(allowTransparent && value === 'transparent' ? 'transparent' : toPickerHex(value, fallbackHex));
  }, [value, allowTransparent, fallbackHex]);

  const handleHexInputChange = (nextRaw: string) => {
    setHexDraft(nextRaw);
    if (allowTransparent && nextRaw.trim().toLowerCase() === 'transparent') {
      onChange('transparent');
      return;
    }
    const valid6 = normalizeHex6(nextRaw);
    if (valid6) {
      onChange(valid6);
    }
  };

  const commitHexDraft = () => {
    if (allowTransparent && hexDraft.trim().toLowerCase() === 'transparent') {
      setHexDraft('transparent');
      onChange('transparent');
      onCommit?.();
      return;
    }
    const normalized = normalizeHexOnCommit(hexDraft);
    if (normalized) {
      setHexDraft(normalized);
      onChange(normalized);
      onCommit?.();
    } else {
      setHexDraft(isTransparent ? 'transparent' : pickerHex);
    }
  };

  return (
    <div className="space-y-1.5 rounded border border-[#232832] bg-[#101318] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-300">{label}</span>
        <div className="flex items-center gap-1.5">
          {allowTransparent && (
            <button
              type="button"
              onClick={() => {
                if (isTransparent) {
                  onChange(fallbackHex);
                } else {
                  onChange('transparent');
                }
                onCommit?.();
              }}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                isTransparent
                  ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                  : 'bg-[#0e1116] border-[#2a303d] text-slate-400 hover:text-slate-200'
              }`}
            >
              {isTransparent ? 'Transparent' : 'Clear BG'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSwatches((prev) => !prev)}
            title="Toggle quick color palette"
            className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
              showSwatches
                ? 'bg-[#1f2633] border-slate-500 text-white'
                : 'bg-[#0e1116] border-[#2a303d] text-slate-400 hover:text-slate-200'
            }`}
          >
            Swatches
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Full-spectrum native OS RGB/HSL/Eyedropper picker */}
        <label
          title={`Open full color spectrum picker for ${label}`}
          className="relative w-8 h-7 rounded border border-[#2a303d] overflow-hidden shrink-0 cursor-pointer focus-within:ring-2 focus-within:ring-blue-500"
          style={{
            background: isTransparent
              ? 'repeating-conic-gradient(#1f2430 0% 25%, #0e1116 0% 50%) 50% / 8px 8px'
              : pickerHex,
          }}
        >
          <input
            type="color"
            aria-label={`${label} spectrum picker`}
            value={pickerHex}
            onChange={(e) => {
              const next = e.target.value.toLowerCase();
              setHexDraft(next);
              onChange(next);
            }}
            onBlur={() => onCommit?.()}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <Pipette className="w-3 h-3 text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] absolute bottom-0.5 right-0.5 pointer-events-none" />
        </label>

        {/* Direct Hex Value Input */}
        <input
          type="text"
          aria-label={`${label} hex value`}
          value={hexDraft}
          maxLength={allowTransparent ? 11 : 7}
          spellCheck={false}
          placeholder="#ffffff"
          onChange={(e) => handleHexInputChange(e.target.value)}
          onBlur={commitHexDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitHexDraft();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="flex-1 min-w-0 h-7 px-2 rounded bg-[#0e1116] border border-[#2a303d] text-slate-100 font-mono-tabular text-[11px] uppercase tracking-wide focus:outline-none focus:border-blue-500"
        />
      </div>

      {showSwatches && (
        <div className="grid grid-cols-8 gap-1 pt-1">
          {COLOR_SWATCHES.map((swatch) => {
            const active = !isTransparent && pickerHex === swatch.hex;
            return (
              <button
                key={swatch.hex}
                type="button"
                title={`${swatch.name} (${swatch.hex.toUpperCase()})`}
                aria-label={`${label}: ${swatch.name} ${swatch.hex}`}
                onClick={() => {
                  setHexDraft(swatch.hex);
                  onChange(swatch.hex);
                  onCommit?.();
                }}
                className={`h-4 w-full rounded-sm border transition-transform hover:scale-105 cursor-pointer ${
                  active ? 'border-blue-400 ring-1 ring-blue-400' : 'border-[#2f3644]'
                }`}
                style={{ backgroundColor: swatch.hex }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

interface TitleStyleControlsProps {
  spec: TitleSpec;
  onChange: (next: TitleSpec) => void;
  onCommit?: () => void;
  showFontSize?: boolean;
}

export const TitleStyleControls: React.FC<TitleStyleControlsProps> = ({
  spec,
  onChange,
  onCommit,
  showFontSize = true,
}) => {
  const fontGroups = ['Sans', 'Display', 'Serif', 'Mono'] as const;

  return (
    <div className="space-y-2">
      {/* Font Family Selection */}
      <label className="block space-y-1">
        <span className="text-[11px] text-slate-400">Text Font Family</span>
        <select
          aria-label="Text Font Family"
          value={spec.fontFamily || 'Outfit'}
          onChange={(e) => {
            onChange({ ...spec, fontFamily: e.target.value });
            onCommit?.();
          }}
          style={{ fontFamily: `"${spec.fontFamily || 'Outfit'}", sans-serif` }}
          className="w-full h-8 px-2 rounded bg-[#0e1116] border border-[#2a303d] text-slate-100 text-xs focus:outline-none focus:border-blue-500"
        >
          {fontGroups.map((group) => (
            <optgroup key={group} label={group}>
              {TITLE_FONT_OPTIONS.filter((f) => f.category === group).map((font) => (
                <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                  {font.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {/* Size & Alignment Row */}
      <div className="grid grid-cols-2 gap-2">
        {showFontSize && (
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            <span>Font Scale</span>
            <input
              type="number"
              min={0.6}
              max={2.0}
              step={0.1}
              value={spec.fontSize}
              onChange={(e) =>
                onChange({
                  ...spec,
                  fontSize: Math.max(0.6, Math.min(2.0, Number(e.target.value) || 1)),
                })
              }
              onBlur={() => onCommit?.()}
              className="h-7 px-2 rounded bg-[#0e1116] border border-[#2a303d] text-slate-100 font-mono-tabular focus:outline-none focus:border-blue-500"
            />
          </label>
        )}

        <div className={`flex flex-col gap-1 text-[11px] text-slate-400 ${showFontSize ? '' : 'col-span-2'}`}>
          <span>Alignment</span>
          <div className="grid grid-cols-3 h-7 rounded overflow-hidden border border-[#2a303d] bg-[#0e1116]">
            {(
              [
                { value: 'left', icon: AlignLeft, label: 'Align Left' },
                { value: 'center', icon: AlignCenter, label: 'Align Center' },
                { value: 'right', icon: AlignRight, label: 'Align Right' },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = (spec.align || 'center') === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => {
                    onChange({ ...spec, align: item.value });
                    onCommit?.();
                  }}
                  className={`flex items-center justify-center transition-colors cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#171b22]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Full-Spectrum Color + Hex Value Controls */}
      <HexColorField
        label="Text Color"
        value={spec.textColor}
        fallbackHex="#ffffff"
        onChange={(textColor) => onChange({ ...spec, textColor })}
        onCommit={onCommit}
      />
      <HexColorField
        label="Accent Color"
        value={spec.accentColor}
        fallbackHex="#3b82f6"
        onChange={(accentColor) => onChange({ ...spec, accentColor })}
        onCommit={onCommit}
      />
      <HexColorField
        label="Backdrop Fill"
        value={spec.bgColor || 'transparent'}
        fallbackHex="#0d1117"
        allowTransparent
        onChange={(bgColor) => onChange({ ...spec, bgColor })}
        onCommit={onCommit}
      />
    </div>
  );
};
