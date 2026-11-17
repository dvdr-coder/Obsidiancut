import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Italic,
  Pipette,
  Play,
  Sparkles,
  Type,
  Wand2,
} from 'lucide-react';
import {
  TITLE_FONT_OPTIONS,
  TitleMorphAnimation,
  TitleMotionEasing,
  TitleSpec,
  TitleTextAnimation,
  TitleTransformCase,
} from '../types/editor';
import { drawVectorTitle } from '../utils/titleRenderer';

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

export const TEXT_ANIMATION_OPTIONS: { value: TitleTextAnimation; label: string; desc: string }[] = [
  { value: 'none', label: 'None (Static)', desc: 'Crisp static lockup' },
  { value: 'fade-in', label: 'Fade In', desc: 'Clean opacity fade entrance' },
  { value: 'slide-up', label: 'Slide Up', desc: 'Smooth upward glide entrance' },
  { value: 'pop-in', label: 'Pop In', desc: 'Crisp spring scale pop entrance' },
  { value: 'fade_rise', label: 'Fade & Rise', desc: 'Smooth vertical float in' },
  { value: 'slide_left', label: 'Slide From Left', desc: 'Directional kinetic slide' },
  { value: 'slide_right', label: 'Slide From Right', desc: 'Directional kinetic slide' },
  { value: 'zoom_punch', label: 'Zoom Punch', desc: 'Bold slam scale entrance' },
  { value: 'tracking_expand', label: 'Cinema Tracking Expand', desc: 'Letter spacing widens cleanly' },
  { value: 'typewriter', label: 'Typewriter Cursor', desc: 'Character-by-character typing' },
  { value: 'word_stagger', label: 'Word Stagger Pop', desc: 'Reveals word by word' },
  { value: 'blur_focus', label: 'Rack Focus Blur', desc: 'Out-of-focus cinematic pull' },
  { value: 'wave_bounce', label: 'Kinetic Wave', desc: 'Fluid per-letter wave bounce' },
  { value: 'wipe_reveal', label: 'Laser Mask Wipe', desc: 'Accent beam sweep reveal' },
  { value: 'glitch_flicker', label: 'Cyber Glitch Flicker', desc: 'RGB chromatic slice flicker' },
];

export const MOTION_EASING_OPTIONS: { value: TitleMotionEasing; label: string }[] = [
  { value: 'easeOut', label: 'Ease Out (Smooth Settle)' },
  { value: 'easeInOut', label: 'Ease In / Out' },
  { value: 'easeIn', label: 'Ease In (Accelerate)' },
  { value: 'linear', label: 'Linear (Constant)' },
  { value: 'spring', label: 'Spring (Overshoot Bounce)' },
];

export const MORPH_ANIMATION_OPTIONS: { value: TitleMorphAnimation; label: string; desc: string }[] = [
  { value: 'none', label: 'None', desc: 'No morph transformation' },
  { value: 'text_morph', label: 'Word-to-Word Text Morph', desc: 'Cross-dissolves & scales into target text' },
  { value: 'liquid_dissolve', label: 'Liquid Ink Blur Morph', desc: 'Organic fluid blur melt between words' },
  { value: 'weight_scale_morph', label: 'Elastic Scale & Tracking Morph', desc: 'Rhythmic typography stretch pulse' },
  { value: 'capsule_expand', label: 'Capsule Expand Morph', desc: 'Backdrop & bars expand into headline' },
  { value: 'split_converge', label: 'Split Character Converge', desc: 'Letters converge from edges cleanly' },
  { value: 'ribbon_unfold', label: 'Cinema Ribbon Unfold', desc: 'Horizontal unfurl with framing lines' },
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
    <div className="space-y-1.5 rounded border border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#101318] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{label}</span>
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
                  ? 'bg-blue-50 dark:bg-blue-600/20 border-blue-500 text-blue-700 dark:text-blue-200'
                  : 'bg-white dark:bg-[#0e1116] border-slate-300 dark:border-[#2a303d] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
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
                ? 'bg-slate-200 dark:bg-[#1f2633] border-slate-500 text-slate-900 dark:text-white'
                : 'bg-white dark:bg-[#0e1116] border-slate-300 dark:border-[#2a303d] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Swatches
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <label
          title={`Open full color spectrum picker for ${label}`}
          className="relative w-8 h-7 rounded border border-slate-300 dark:border-[#2a303d] overflow-hidden shrink-0 cursor-pointer focus-within:ring-2 focus-within:ring-blue-500"
          style={{
            background: isTransparent
              ? 'repeating-conic-gradient(#cbd5e1 0% 25%, #f8fafc 0% 50%) 50% / 8px 8px'
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
          className="flex-1 min-w-0 h-7 px-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 font-mono-tabular text-[11px] uppercase tracking-wide focus:outline-none focus:border-blue-500"
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
                  active ? 'border-blue-500 ring-1 ring-blue-400' : 'border-slate-300 dark:border-[#2f3644]'
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

type StyleSubTab = 'font' | 'style' | 'animate' | 'morph';

export const TitleStyleControls: React.FC<TitleStyleControlsProps> = ({
  spec,
  onChange,
  onCommit,
  showFontSize = true,
}) => {
  const [subTab, setSubTab] = useState<StyleSubTab>('font');
  const [previewProgress, setPreviewProgress] = useState(0.5);
  const [loopPreview, setLoopPreview] = useState(false);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fontGroups = ['Display', 'Sans', 'Serif', 'Script', 'Mono'] as const;

  // Live animated micro-preview whenever on Animate / Morph tab or loop toggled
  useEffect(() => {
    if (!loopPreview) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const elapsed = ((now - t0) / 1000) % 3.2;
      setPreviewProgress(elapsed / 3.2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loopPreview]);

  useEffect(() => {
    const canvas = miniCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Subtle dark cinema backdrop checkerboard/gradient
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, '#0b0e14');
    g.addColorStop(1, '#141a26');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawVectorTitle(ctx, spec, canvas.width, canvas.height, previewProgress, 3.2);
  }, [spec, previewProgress]);

  return (
    <div className="space-y-2.5">
      {/* Live Mini Title & Morph Preview Strip */}
      <div className="rounded border border-slate-200 dark:border-[#232832] bg-[#0b0e14] overflow-hidden">
        <div className="relative aspect-[16/7] w-full">
          <canvas
            ref={miniCanvasRef}
            width={480}
            height={210}
            className="w-full h-full block"
          />
          <button
            type="button"
            onClick={() => setLoopPreview((p) => !p)}
            title={loopPreview ? 'Pause motion preview' : 'Play title & morph motion preview'}
            className={`absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 border transition-colors cursor-pointer ${
              loopPreview
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-black/75 border-white/20 text-slate-200 hover:bg-black'
            }`}
          >
            <Play className="w-2.5 h-2.5" />
            <span>{loopPreview ? 'Playing' : 'Preview Motion'}</span>
          </button>
        </div>
      </div>

      {/* Compact 4-Section Editor Switcher */}
      <div className="grid grid-cols-4 p-0.5 rounded bg-slate-100 dark:bg-[#0e1116] border border-slate-200 dark:border-[#232832] text-[10px] font-medium">
        {(
          [
            { id: 'font', label: 'Font', icon: Type },
            { id: 'style', label: 'Style & FX', icon: Pipette },
            { id: 'animate', label: 'Animate', icon: Sparkles },
            { id: 'morph', label: 'Morph', icon: Wand2 },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setSubTab(t.id);
                if (t.id === 'animate' || t.id === 'morph') {
                  setLoopPreview(true);
                }
              }}
              className={`py-1 px-1 rounded flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      {subTab === 'font' && (
        <div className="space-y-2">
          {/* Font Family Selection */}
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Font Family ({TITLE_FONT_OPTIONS.length} Studio Fonts)
            </span>
            <select
              aria-label="Text Font Family"
              value={spec.fontFamily || 'Outfit'}
              onChange={(e) => {
                onChange({ ...spec, fontFamily: e.target.value });
                onCommit?.();
              }}
              style={{ fontFamily: `"${spec.fontFamily || 'Outfit'}", sans-serif` }}
              className="w-full h-8 px-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-blue-500"
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

          {/* Weight, Italic, Text Case */}
          <div className="grid grid-cols-3 gap-1.5">
            <label className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span>Weight</span>
              <select
                value={spec.fontWeight ?? 700}
                onChange={(e) => {
                  onChange({ ...spec, fontWeight: Number(e.target.value) });
                  onCommit?.();
                }}
                className="h-7 px-1.5 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 text-[11px]"
              >
                <option value={400}>Regular 400</option>
                <option value={500}>Medium 500</option>
                <option value={600}>Semi 600</option>
                <option value={700}>Bold 700</option>
                <option value={800}>Extra 800</option>
                <option value={900}>Black 900</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span>Case</span>
              <select
                value={spec.textTransform ?? 'none'}
                onChange={(e) => {
                  onChange({ ...spec, textTransform: e.target.value as TitleTransformCase });
                  onCommit?.();
                }}
                className="h-7 px-1.5 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 text-[11px]"
              >
                <option value="none">As Typed</option>
                <option value="uppercase">UPPERCASE</option>
                <option value="capitalize">Title Case</option>
                <option value="lowercase">lowercase</option>
              </select>
            </label>

            <div className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span>Style</span>
              <button
                type="button"
                onClick={() => {
                  onChange({ ...spec, italic: !spec.italic });
                  onCommit?.();
                }}
                className={`h-7 px-2 rounded border flex items-center justify-center gap-1 text-[11px] font-medium transition-colors cursor-pointer ${
                  spec.italic
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-white dark:bg-[#0e1116] border-slate-300 dark:border-[#2a303d] text-slate-700 dark:text-slate-300'
                }`}
              >
                <Italic className="w-3 h-3" />
                <span>Italic</span>
              </button>
            </div>
          </div>

          {/* Size & Alignment Row */}
          <div className="grid grid-cols-2 gap-2">
            {showFontSize && (
              <label className="flex flex-col gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Font Scale ({(spec.fontSize || 1).toFixed(1)}×)</span>
                <input
                  type="range"
                  min={0.5}
                  max={2.4}
                  step={0.05}
                  value={spec.fontSize}
                  onChange={(e) => onChange({ ...spec, fontSize: Number(e.target.value) })}
                  onPointerUp={() => onCommit?.()}
                  className="accent-blue-500 h-7"
                />
              </label>
            )}

            <div className={`flex flex-col gap-1 text-[11px] text-slate-500 dark:text-slate-400 ${showFontSize ? '' : 'col-span-2'}`}>
              <span>Alignment</span>
              <div className="grid grid-cols-3 h-7 rounded overflow-hidden border border-slate-300 dark:border-[#2a303d] bg-white dark:bg-[#0e1116]">
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
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#171b22]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Letter Spacing, Line Height, Vertical Position */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <label className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span>Tracking ({spec.letterSpacing ?? 0}px)</span>
              <input
                type="range"
                min={-4}
                max={24}
                step={0.5}
                value={spec.letterSpacing ?? 0}
                onChange={(e) => onChange({ ...spec, letterSpacing: Number(e.target.value) })}
                onPointerUp={() => onCommit?.()}
                className="accent-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span>Line H ({(spec.lineHeight ?? 1.18).toFixed(2)})</span>
              <input
                type="range"
                min={0.9}
                max={2.0}
                step={0.04}
                value={spec.lineHeight ?? 1.18}
                onChange={(e) => onChange({ ...spec, lineHeight: Number(e.target.value) })}
                onPointerUp={() => onCommit?.()}
                className="accent-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span>Vert Y ({spec.offsetY ?? 0}%)</span>
              <input
                type="range"
                min={-35}
                max={35}
                step={1}
                value={spec.offsetY ?? 0}
                onChange={(e) => onChange({ ...spec, offsetY: Number(e.target.value) })}
                onPointerUp={() => onCommit?.()}
                className="accent-blue-500"
              />
            </label>
          </div>
        </div>
      )}

      {subTab === 'style' && (
        <div className="space-y-2">
          <HexColorField
            label="Text Color"
            value={spec.textColor}
            fallbackHex="#ffffff"
            onChange={(textColor) => onChange({ ...spec, textColor })}
            onCommit={onCommit}
          />

          {/* Gradient Text Fill */}
          <div className="rounded border border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#101318] p-2 space-y-2">
            <label className="flex items-center justify-between text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <span>Two-Tone Gradient Text Fill</span>
              <input
                type="checkbox"
                checked={Boolean(spec.gradientEnabled)}
                onChange={(e) => {
                  onChange({
                    ...spec,
                    gradientEnabled: e.target.checked,
                    gradientColor: spec.gradientColor || spec.accentColor || '#38bdf8',
                  });
                  onCommit?.();
                }}
                className="accent-blue-600"
              />
            </label>
            {spec.gradientEnabled && (
              <HexColorField
                label="Gradient End Color"
                value={spec.gradientColor || spec.accentColor}
                fallbackHex="#38bdf8"
                onChange={(gradientColor) => onChange({ ...spec, gradientColor })}
                onCommit={onCommit}
              />
            )}
          </div>

          <HexColorField
            label="Accent Color"
            value={spec.accentColor}
            fallbackHex="#3b82f6"
            onChange={(accentColor) => onChange({ ...spec, accentColor })}
            onCommit={onCommit}
          />

          {/* Outline Stroke & Shadow Glow */}
          <div className="rounded border border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#101318] p-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                <span>Outline Width ({spec.strokeWidth ?? 0}px)</span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={spec.strokeWidth ?? 0}
                  onChange={(e) => onChange({ ...spec, strokeWidth: Number(e.target.value) })}
                  onPointerUp={() => onCommit?.()}
                  className="accent-blue-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                <span>Shadow / Glow ({spec.shadowBlur ?? 16}px)</span>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={spec.shadowBlur ?? 16}
                  onChange={(e) => onChange({ ...spec, shadowBlur: Number(e.target.value) })}
                  onPointerUp={() => onCommit?.()}
                  className="accent-blue-500"
                />
              </label>
            </div>
            {(spec.strokeWidth ?? 0) > 0 && (
              <HexColorField
                label="Outline Stroke Color"
                value={spec.strokeColor || '#05070a'}
                fallbackHex="#05070a"
                onChange={(strokeColor) => onChange({ ...spec, strokeColor })}
                onCommit={onCommit}
              />
            )}
            {(spec.shadowBlur ?? 16) > 0 && (
              <HexColorField
                label="Shadow / Glow Color"
                value={spec.shadowColor || '#000000'}
                fallbackHex="#000000"
                onChange={(shadowColor) => onChange({ ...spec, shadowColor })}
                onCommit={onCommit}
              />
            )}
          </div>

          <HexColorField
            label="Text Box / Pill Backdrop"
            value={spec.pillBgColor || 'transparent'}
            fallbackHex="#0f172a"
            allowTransparent
            onChange={(pillBgColor) => onChange({ ...spec, pillBgColor })}
            onCommit={onCommit}
          />
          <HexColorField
            label="Full Screen Card BG"
            value={spec.bgColor || 'transparent'}
            fallbackHex="#0d1117"
            allowTransparent
            onChange={(bgColor) => onChange({ ...spec, bgColor })}
            onCommit={onCommit}
          />
        </div>
      )}

      {subTab === 'animate' && (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Text Kinetic Animation</span>
            <select
              value={spec.animation || 'none'}
              onChange={(e) => {
                onChange({ ...spec, animation: e.target.value as TitleTextAnimation });
                onCommit?.();
                setLoopPreview(true);
              }}
              className="w-full h-8 px-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-blue-500"
            >
              {TEXT_ANIMATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {TEXT_ANIMATION_OPTIONS.find((o) => o.value === (spec.animation || 'none'))?.desc}
          </p>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span>Duration ({(spec.animDurationSec ?? 0.9).toFixed(2)}s)</span>
              <input
                type="range"
                min={0.2}
                max={3.0}
                step={0.05}
                value={spec.animDurationSec ?? 0.9}
                onChange={(e) => onChange({ ...spec, animDurationSec: Number(e.target.value) })}
                onPointerUp={() => onCommit?.()}
                className="accent-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span>Easing Curve</span>
              <select
                value={spec.animEasing || 'easeOut'}
                onChange={(e) => {
                  onChange({ ...spec, animEasing: e.target.value as TitleMotionEasing });
                  onCommit?.();
                  setLoopPreview(true);
                }}
                className="w-full h-7 px-1.5 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 text-[11px] focus:outline-none focus:border-blue-500"
              >
                {MOTION_EASING_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-slate-200 dark:border-[#232832] bg-slate-50 dark:bg-[#101318] text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
            <span>Animate Exit</span>
            <input
              type="checkbox"
              checked={Boolean(spec.animOut)}
              onChange={(e) => {
                onChange({ ...spec, animOut: e.target.checked });
                onCommit?.();
              }}
              className="accent-blue-600"
            />
          </label>
        </div>
      )}

      {subTab === 'morph' && (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Kinetic Morph Effect</span>
            <select
              value={spec.morphAnimation || 'none'}
              onChange={(e) => {
                onChange({ ...spec, morphAnimation: e.target.value as TitleMorphAnimation });
                onCommit?.();
                setLoopPreview(true);
              }}
              className="w-full h-8 px-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-blue-500"
            >
              {MORPH_ANIMATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {MORPH_ANIMATION_OPTIONS.find((o) => o.value === (spec.morphAnimation || 'none'))?.desc}
          </p>

          {(spec.morphAnimation === 'text_morph' ||
            spec.morphAnimation === 'liquid_dissolve' ||
            spec.morphAnimation === 'split_converge') && (
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Morph Target Headline (transforms mid-clip)
              </span>
              <input
                type="text"
                value={spec.morphTargetText || ''}
                placeholder={spec.subheading || 'e.g. NEXT CHAPTER'}
                onChange={(e) => onChange({ ...spec, morphTargetText: e.target.value })}
                onBlur={() => onCommit?.()}
                className="w-full h-8 px-2 rounded bg-white dark:bg-[#0e1116] border border-slate-300 dark:border-[#2a303d] text-slate-900 dark:text-slate-100 text-xs"
              />
            </label>
          )}

          {spec.morphAnimation && spec.morphAnimation !== 'none' && (
            <label className="flex flex-col gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span>Morph Transition Timing ({Math.round((spec.morphPeakPct ?? 0.52) * 100)}%)</span>
              <input
                type="range"
                min={0.25}
                max={0.8}
                step={0.02}
                value={spec.morphPeakPct ?? 0.52}
                onChange={(e) => onChange({ ...spec, morphPeakPct: Number(e.target.value) })}
                onPointerUp={() => onCommit?.()}
                className="accent-blue-500"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
};
