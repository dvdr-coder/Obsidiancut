import {
  TITLE_FONT_OPTIONS,
  TitleMorphAnimation,
  TitleMotionEasing,
  TitleSpec,
  TitleTextAnimation,
  TitleTransformCase,
} from '../types/editor';

function resolveCanvasFontStack(fontFamily?: string): string {
  const face = (fontFamily || 'Outfit').trim() || 'Outfit';
  const found = TITLE_FONT_OPTIONS.find((opt) => opt.value === face);
  if (found?.fallback === 'serif') {
    return `"${face}", Georgia, serif`;
  }
  if (found?.fallback === 'cursive') {
    return `"${face}", cursive, serif`;
  }
  if (found?.fallback === 'monospace') {
    return `"${face}", "JetBrains Mono", monospace`;
  }
  return `"${face}", "Outfit", sans-serif`;
}

function safeColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return trimmed;
  }
  if (/^rgba?\(/i.test(trimmed)) return trimmed;
  return fallback;
}

function applyTextTransform(raw: string, transform?: TitleTransformCase): string {
  if (!raw) return '';
  if (transform === 'uppercase') return raw.toUpperCase();
  if (transform === 'lowercase') return raw.toLowerCase();
  if (transform === 'capitalize') {
    return raw.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return raw;
}

function easeOutCubic(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function applyMotionEasing(x: number, easing?: TitleMotionEasing): number {
  const t = Math.max(0, Math.min(1, x));
  if (easing === 'linear') return t;
  if (easing === 'easeIn') return t * t * t;
  if (easing === 'easeInOut') return easeInOutCubic(t);
  if (easing === 'spring') return easeOutBack(t);
  return easeOutCubic(t);
}

export function hasAnimatedTitleEffects(spec?: TitleSpec): boolean {
  if (!spec) return false;
  if (spec.template === 'scrolling_credits') return false;
  const anim = spec.animation || 'none';
  const morph = spec.morphAnimation || 'none';
  return anim !== 'none' || morph !== 'none';
}

function buildFontString(
  weight: number,
  italic: boolean,
  pxSize: number,
  fontStack: string,
): string {
  const w = Math.max(400, Math.min(900, Math.round(weight / 100) * 100 || 700));
  return `${italic ? 'italic ' : ''}${w} ${Math.max(8, Math.round(pxSize))}px ${fontStack}`;
}

function measureTrackedTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  letterSpacingPx: number,
): number {
  if (!text) return 0;
  if (Math.abs(letterSpacingPx) < 0.25) {
    return ctx.measureText(text).width;
  }
  const chars = Array.from(text);
  let total = 0;
  for (let i = 0; i < chars.length; i++) {
    total += ctx.measureText(chars[i]).width;
    if (i < chars.length - 1) total += letterSpacingPx;
  }
  return total;
}

interface StyledDrawOpts {
  text: string;
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  letterSpacingPx: number;
  fillStyle: string | CanvasGradient;
  strokeColor?: string;
  strokeWidthPx?: number;
  shadowColor?: string;
  shadowBlurPx?: number;
  wavePhase?: number; // >0 enables per-char sine wave offset
  waveAmpPx?: number;
  splitFactor?: number; // >0 expands chars outward smoothly for split_converge morph
}

function drawStyledTextLine(ctx: CanvasRenderingContext2D, opts: StyledDrawOpts): void {
  const {
    text,
    x,
    y,
    align,
    letterSpacingPx,
    fillStyle,
    strokeColor,
    strokeWidthPx = 0,
    shadowColor,
    shadowBlurPx = 0,
    wavePhase = 0,
    waveAmpPx = 0,
    splitFactor = 0,
  } = opts;
  if (!text) return;

  ctx.save();
  if (shadowBlurPx > 0.4) {
    ctx.shadowColor = shadowColor || 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = shadowBlurPx;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  const useCharLoop =
    Math.abs(letterSpacingPx) >= 0.25 || waveAmpPx > 0.2 || Math.abs(splitFactor) > 0.01;

  if (!useCharLoop) {
    ctx.textAlign = align;
    if (strokeWidthPx > 0.2 && strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidthPx;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = fillStyle;
    ctx.fillText(text, x, y);
    ctx.restore();
    return;
  }

  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const totalW = widths.reduce((a, b) => a + b, 0) + Math.max(0, chars.length - 1) * letterSpacingPx;

  let startX = x;
  if (align === 'center') startX = x - totalW / 2;
  else if (align === 'right') startX = x - totalW;

  ctx.textAlign = 'left';
  let cursorX = startX;
  const midIdx = (chars.length - 1) / 2;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cw = widths[i];
    const waveY = waveAmpPx > 0.2 ? Math.sin(wavePhase - i * 0.48) * waveAmpPx : 0;
    const splitDx =
      Math.abs(splitFactor) > 0.01 ? (i - midIdx) * splitFactor * Math.max(10, cw * 1.15) : 0;
    const charX = cursorX + splitDx;
    const charY = y + waveY;

    if (strokeWidthPx > 0.2 && strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidthPx;
      ctx.lineJoin = 'round';
      ctx.strokeText(ch, charX, charY);
    }
    ctx.fillStyle = fillStyle;
    ctx.fillText(ch, charX, charY);
    cursorX += cw + letterSpacingPx;
  }
  ctx.restore();
}

function createTextFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  widthSpan: number,
  spec: TitleSpec,
  baseColor: string,
): string | CanvasGradient {
  if (!spec.gradientEnabled) return baseColor;
  const gCol = safeColor(spec.gradientColor || spec.accentColor, '#3b82f6');
  const half = Math.max(120, widthSpan * 0.55);
  const grad = ctx.createLinearGradient(x - half, y - 40, x + half, y + 40);
  grad.addColorStop(0, baseColor);
  grad.addColorStop(1, gCol);
  return grad;
}

function computeTextWindowProgress(
  spec: TitleSpec,
  progress: number,
  durationSec: number,
): { rawIn: number; inEased: number; outFactor: number; envelope: number } {
  const dur = Math.max(0.4, durationSec || 4);
  const animDur = Math.max(0.2, Math.min(dur * 0.65, spec.animDurationSec ?? 0.9));
  const animFrac = animDur / dur;
  const rawIn = Math.max(0, Math.min(1, progress / animFrac));
  const inEased = applyMotionEasing(rawIn, spec.animEasing);

  let outFactor = 1;
  if (spec.animOut) {
    const rawOut = Math.max(0, Math.min(1, (1 - progress) / animFrac));
    outFactor = applyMotionEasing(rawOut, spec.animEasing);
  }
  return { rawIn, inEased, outFactor, envelope: Math.max(0, Math.min(1, Math.min(inEased, outFactor))) };
}

/**
 * Draws crisp vector titles, lower thirds, subtitles, vector badges,
 * animated typography, morphing headlines, and scrolling motion picture credits onto any Canvas 2D context.
 */
export function drawVectorTitle(
  ctx: CanvasRenderingContext2D,
  spec: TitleSpec,
  width: number,
  height: number,
  progress = 0.5,
  durationSec = 4.0,
): void {
  const p = Math.max(0, Math.min(1, progress));
  const scale = (width / 1280) * (spec.fontSize || 1);
  const fontStack = resolveCanvasFontStack(spec.fontFamily);
  const textColor = safeColor(spec.textColor, '#ffffff');
  const accentColor = safeColor(spec.accentColor, '#3b82f6');
  const fontWeight = spec.fontWeight ?? 700;
  const italic = Boolean(spec.italic);
  const baseSpacing = (spec.letterSpacing ?? 0) * scale;
  const lineHMult = Math.max(0.9, Math.min(2.0, spec.lineHeight ?? 1.18));
  const strokeWidth = (spec.strokeWidth ?? 0) * scale;
  const strokeColor = safeColor(spec.strokeColor, '#05070a');
  const shadowBlur = (spec.shadowBlur ?? 16) * scale;
  const shadowColor = safeColor(spec.shadowColor, 'rgba(0,0,0,0.6)');
  const offsetY = ((spec.offsetY ?? 0) / 100) * height;

  const anim: TitleTextAnimation = spec.animation || 'none';
  const morph: TitleMorphAnimation = spec.morphAnimation || 'none';
  const morphPeak = Math.max(0.2, Math.min(0.85, spec.morphPeakPct ?? 0.52));

  const headingRaw = applyTextTransform(spec.heading || 'MAIN TITLE', spec.textTransform);
  const subheadingRaw = applyTextTransform(spec.subheading || '', spec.textTransform);
  const morphTargetRaw = applyTextTransform(
    spec.morphTargetText?.trim() || spec.subheading?.trim() || headingRaw,
    spec.textTransform,
  );

  ctx.save();

  // Optional solid/tinted card background (skip if transparent)
  if (spec.bgColor && spec.bgColor !== 'transparent') {
    ctx.fillStyle = safeColor(spec.bgColor, '#0d1117');
    ctx.fillRect(0, 0, width, height);
  }

  if (spec.template === 'scrolling_credits') {
    const lines = buildCreditLines(spec);
    const lineH = 44 * scale * (lineHMult / 1.18);
    const totalContentH = Math.max(height, lines.length * lineH + 140 * scale);
    const startY = height - p * (height + totalContentH);
    drawCreditsLines(ctx, spec, lines, width, startY, scale, fontStack, textColor, accentColor);
    ctx.restore();
    return;
  }

  // Compute kinetic text & morph animation transforms
  const { rawIn, inEased, outFactor, envelope } = computeTextWindowProgress(spec, p, durationSec);
  const exitShiftFactor = spec.animOut ? 1 - outFactor : 0;

  let animAlpha = 1;
  let animDx = 0;
  let animDy = 0;
  let animScaleX = 1;
  let animScaleY = 1;
  let animBlurPx = 0;
  let extraSpacingPx = 0;
  let waveAmpPx = 0;
  let wavePhase = 0;
  let clipWipePct: number | null = null;
  let glitchOffsetPx = 0;
  let morphSplitFactor = 0;
  let activeDisplayHeading = headingRaw;
  let morphCrossfadeOutA: { text: string; alpha: number; blurPx: number } | null = null;
  let capsuleReveal = 1;
  let ribbonFold = 1;

  if (anim === 'fade-in') {
    animAlpha = Math.max(0, Math.min(1, envelope));
  } else if (anim === 'slide-up') {
    animAlpha = Math.max(0, Math.min(1, Math.min(rawIn * 2.2, inEased * 1.15) * outFactor));
    animDy = (1 - inEased) * 72 * scale - exitShiftFactor * 36 * scale;
  } else if (anim === 'pop-in') {
    const popCurve = applyMotionEasing(rawIn, spec.animEasing ?? 'spring');
    const s = rawIn < 1 ? 0.38 + 0.62 * popCurve : 1;
    animAlpha = Math.max(0, Math.min(1, rawIn * 3.0) * outFactor);
    animScaleX = s;
    animScaleY = s;
  } else if (anim === 'fade_rise') {
    animAlpha = envelope;
    animDy = (1 - inEased) * 44 * scale - exitShiftFactor * 28 * scale;
  } else if (anim === 'slide_left') {
    animAlpha = envelope;
    animDx = -(1 - inEased) * width * 0.22 + exitShiftFactor * width * 0.14;
  } else if (anim === 'slide_right') {
    animAlpha = envelope;
    animDx = (1 - inEased) * width * 0.22 - exitShiftFactor * width * 0.14;
  } else if (anim === 'zoom_punch') {
    const dur = Math.max(0.4, durationSec);
    const rawIn = Math.max(0, Math.min(1, p / (Math.min(dur * 0.45, spec.animDurationSec ?? 0.8) / dur)));
    const s = rawIn < 1 ? 1.48 - 0.48 * easeOutBack(rawIn) : 1;
    animAlpha = Math.min(1, rawIn * 2.5) * outFactor;
    animScaleX = s;
    animScaleY = s;
  } else if (anim === 'tracking_expand') {
    animAlpha = envelope;
    extraSpacingPx = (1 - inEased) * 28 * scale + exitShiftFactor * 18 * scale;
  } else if (anim === 'typewriter') {
    const dur = Math.max(0.4, durationSec);
    const typeSpan = Math.min(0.75, Math.max(0.22, (spec.animDurationSec ?? 1.4) / dur));
    const typeFrac = Math.max(0, Math.min(1, p / typeSpan));
    const count = Math.max(1, Math.round(headingRaw.length * typeFrac));
    const showCursor = typeFrac < 0.99 && Math.floor(p * durationSec * 6) % 2 === 0;
    activeDisplayHeading = headingRaw.slice(0, count) + (showCursor ? '|' : '');
    animAlpha = outFactor;
  } else if (anim === 'word_stagger') {
    animAlpha = outFactor;
    // Handled inside main_title / fallback cleanly or smoothly scales words below
    const words = headingRaw.split(/\s+/).filter(Boolean);
    const dur = Math.max(0.4, durationSec);
    const span = Math.min(0.65, (spec.animDurationSec ?? 1.1) / dur);
    const revealed = Math.max(1, Math.ceil((p / Math.max(0.08, span)) * words.length));
    activeDisplayHeading = words.slice(0, revealed).join(' ');
    const lastWordProg = Math.min(1, ((p / Math.max(0.08, span)) * words.length) % 1 || 1);
    animDy = (1 - easeOutCubic(lastWordProg)) * 10 * scale;
  } else if (anim === 'blur_focus') {
    animAlpha = envelope;
    animBlurPx = ((1 - inEased) + exitShiftFactor) * 16 * scale;
    const s = 1.12 - 0.12 * inEased;
    animScaleX = s;
    animScaleY = s;
  } else if (anim === 'wave_bounce') {
    animAlpha = envelope;
    waveAmpPx = (6 + 8 * Math.sin(p * Math.PI)) * scale;
    wavePhase = p * durationSec * 5.2;
  } else if (anim === 'wipe_reveal') {
    animAlpha = outFactor;
    clipWipePct = inEased;
  } else if (anim === 'glitch_flicker') {
    const activeEdge = p < 0.25 ? 1 - p / 0.25 : spec.animOut && p > 0.78 ? (p - 0.78) / 0.22 : 0;
    if (activeEdge > 0.02) {
      const tick = Math.sin(p * 140) * Math.cos(p * 77);
      glitchOffsetPx = tick * 18 * activeEdge * scale;
      animAlpha = Math.abs(Math.sin(p * 95)) < 0.18 ? 0.35 : 1;
    }
  }

  // Apply Kinetic Morph Animations cleanly on top of / combined with base text animations
  if (morph === 'text_morph' || morph === 'liquid_dissolve') {
    const windowW = 0.22;
    const mStart = Math.max(0.05, morphPeak - windowW / 2);
    const mEnd = Math.min(0.95, morphPeak + windowW / 2);
    const mRaw = Math.max(0, Math.min(1, (p - mStart) / Math.max(0.05, mEnd - mStart)));
    const mEase = easeInOutCubic(mRaw);

    if (mRaw <= 0) {
      activeDisplayHeading = headingRaw;
    } else if (mRaw >= 1) {
      activeDisplayHeading = morphTargetRaw;
    } else {
      // Mid-morph phase: smooth dual-word morph + liquid blur/stretch coalesce
      const bridge = Math.sin(mRaw * Math.PI);
      const blurAmt = (morph === 'liquid_dissolve' ? 18 : 9) * bridge * scale;
      morphCrossfadeOutA = {
        text: headingRaw,
        alpha: (1 - mEase) * animAlpha,
        blurPx: blurAmt,
      };
      activeDisplayHeading = morphTargetRaw;
      animAlpha = mEase * animAlpha;
      animBlurPx = Math.max(animBlurPx, blurAmt);
      animScaleX *= morph === 'liquid_dissolve' ? 1 + bridge * 0.16 : 1 + bridge * 0.08;
      animScaleY *= morph === 'liquid_dissolve' ? 1 - bridge * 0.1 : 1;
      extraSpacingPx += bridge * 12 * scale;
    }
  } else if (morph === 'weight_scale_morph') {
    const pulse = Math.sin(p * Math.PI);
    animScaleX *= 0.88 + 0.26 * easeInOutCubic(pulse);
    animScaleY *= 0.96 + 0.08 * easeInOutCubic(pulse);
    extraSpacingPx += pulse * 14 * scale;
  } else if (morph === 'capsule_expand') {
    const dur = Math.max(0.4, durationSec);
    const openSpan = Math.min(0.5, (spec.animDurationSec ?? 1.0) / dur);
    capsuleReveal = easeOutCubic(Math.min(1, p / Math.max(0.1, openSpan)));
    if (spec.animOut && p > 1 - openSpan) {
      capsuleReveal = easeOutCubic(Math.max(0, (1 - p) / openSpan));
    }
    animAlpha *= Math.min(1, capsuleReveal * 1.4);
  } else if (morph === 'split_converge') {
    const splitAmt = Math.max(0, 1 - easeOutCubic(Math.min(1, p / 0.38)));
    const exitSplit = spec.animOut && p > 0.72 ? easeInOutCubic((p - 0.72) / 0.28) : 0;
    morphSplitFactor = (splitAmt + exitSplit) * 1.65;
    animAlpha *= 1 - Math.min(0.85, (splitAmt + exitSplit) * 0.7);
    if (morphTargetRaw !== headingRaw && p > morphPeak) {
      activeDisplayHeading = morphTargetRaw;
    }
  } else if (morph === 'ribbon_unfold') {
    ribbonFold = easeOutCubic(Math.min(1, p / 0.35));
    if (spec.animOut && p > 0.72) {
      ribbonFold = easeOutCubic(Math.max(0, (1 - p) / 0.28));
    }
    animScaleY *= 0.2 + 0.8 * ribbonFold;
    animAlpha *= Math.min(1, ribbonFold * 1.3);
  }

  // Apply frame transform & optional wipe clip / blur filter
  ctx.globalAlpha = Math.max(0, Math.min(1, animAlpha));
  if (animBlurPx > 0.4) {
    ctx.filter = `blur(${animBlurPx.toFixed(1)}px)`;
  }

  if (clipWipePct !== null && clipWipePct < 0.995) {
    const wipeW = width * clipWipePct;
    ctx.beginPath();
    ctx.rect(0, 0, wipeW, height);
    ctx.clip();
  }

  const anchorX = width / 2;
  const anchorY = height / 2 + offsetY;
  ctx.translate(anchorX + animDx, anchorY + animDy);
  ctx.scale(animScaleX, animScaleY);
  ctx.translate(-anchorX, -(height / 2));

  const effSpacing = baseSpacing + extraSpacingPx;

  const drawMainTemplate = (headText: string, overrideBlur = 0, overrideAlpha = 1) => {
    ctx.save();
    if (overrideAlpha < 0.999) {
      ctx.globalAlpha *= Math.max(0, Math.min(1, overrideAlpha));
    }
    if (overrideBlur > 0.4) {
      ctx.filter = `blur(${overrideBlur.toFixed(1)}px)`;
    }

    if (spec.template === 'main_title') {
      const cx = width / 2;
      const cy = height / 2;
      const align = spec.align || 'center';
      const textX = align === 'left' ? width * 0.12 : align === 'right' ? width * 0.88 : cx;

      const headFontSize = Math.round(62 * scale);
      ctx.font = buildFontString(fontWeight, italic, headFontSize, fontStack);
      const textW = measureTrackedTextWidth(ctx, headText, effSpacing);

      // Optional Backdrop Pill / Box behind text
      if (spec.pillBgColor && spec.pillBgColor !== 'transparent') {
        const padX = (26 + (spec.pillPadding ?? 16)) * scale;
        const padY = (16 + (spec.pillPadding ?? 16) * 0.6) * scale;
        const boxW = Math.max(120 * scale, textW + padX * 2) * capsuleReveal;
        const boxH = (subheadingRaw ? 128 : 88) * scale + padY;
        const boxX = align === 'left' ? textX - padX : align === 'right' ? textX - boxW + padX : cx - boxW / 2;
        ctx.fillStyle = safeColor(spec.pillBgColor, 'rgba(12,15,20,0.82)');
        ctx.beginPath();
        ctx.roundRect(boxX, cy - boxH / 2 + 8 * scale, boxW, boxH, 12 * scale);
        ctx.fill();
      }

      // Geometric framing bars (expand smoothly with ribbonFold / capsuleReveal)
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = Math.max(2, 3 * scale);
      const barW = Math.min(width * 0.42, Math.max(180 * scale, textW * 0.68)) * ribbonFold * capsuleReveal;
      ctx.beginPath();
      ctx.moveTo(cx - barW / 2, cy - 54 * scale);
      ctx.lineTo(cx + barW / 2, cy - 54 * scale);
      ctx.moveTo(cx - barW / 2, cy + (subheadingRaw ? 64 : 46) * scale);
      ctx.lineTo(cx + barW / 2, cy + (subheadingRaw ? 64 : 46) * scale);
      ctx.stroke();

      // Glitch chromatic shadow passes if active
      if (Math.abs(glitchOffsetPx) > 0.5) {
        ctx.save();
        ctx.globalAlpha *= 0.65;
        drawStyledTextLine(ctx, {
          text: headText,
          x: textX - glitchOffsetPx,
          y: cy + 6 * scale,
          align,
          letterSpacingPx: effSpacing,
          fillStyle: '#06b6d4',
        });
        drawStyledTextLine(ctx, {
          text: headText,
          x: textX + glitchOffsetPx,
          y: cy + 6 * scale,
          align,
          letterSpacingPx: effSpacing,
          fillStyle: '#ef4444',
        });
        ctx.restore();
      }

      const mainFill = createTextFill(ctx, textX, cy, textW, spec, textColor);
      drawStyledTextLine(ctx, {
        text: headText,
        x: textX,
        y: cy + 6 * scale,
        align,
        letterSpacingPx: effSpacing,
        fillStyle: mainFill,
        strokeColor,
        strokeWidthPx: strokeWidth,
        shadowColor,
        shadowBlurPx: shadowBlur,
        wavePhase,
        waveAmpPx,
        splitFactor: morphSplitFactor,
      });

      if (subheadingRaw) {
        const subFontSize = Math.round(24 * scale);
        ctx.font = buildFontString(Math.min(700, fontWeight), italic, subFontSize, fontStack);
        drawStyledTextLine(ctx, {
          text: subheadingRaw,
          x: textX,
          y: cy + (6 + 34 * (lineHMult / 1.18)) * scale,
          align,
          letterSpacingPx: effSpacing * 0.55,
          fillStyle: accentColor,
          strokeColor,
          strokeWidthPx: strokeWidth * 0.45,
          shadowColor,
          shadowBlurPx: shadowBlur * 0.5,
        });
      }
    } else if (spec.template === 'lower_third') {
      const marginX = 64 * (width / 1280);
      const baseY = height - 96 * (height / 720);
      const accentW = 6 * scale;
      const boxH = 86 * scale * (lineHMult / 1.18);

      ctx.font = buildFontString(fontWeight, italic, Math.round(32 * scale), fontStack);
      const headW = measureTrackedTextWidth(ctx, headText, effSpacing);
      ctx.font = buildFontString(500, italic, Math.round(20 * scale), fontStack);
      const subW = measureTrackedTextWidth(ctx, subheadingRaw || 'Role / Location', effSpacing * 0.4);
      const fullBoxW = Math.max(headW, subW) + (56 + (spec.pillPadding ?? 8)) * scale;
      const boxW = Math.max(16 * scale, fullBoxW * capsuleReveal * ribbonFold);

      ctx.fillStyle = safeColor(spec.pillBgColor && spec.pillBgColor !== 'transparent' ? spec.pillBgColor : 'rgba(12, 15, 20, 0.86)', 'rgba(12, 15, 20, 0.86)');
      ctx.fillRect(marginX, baseY - boxH / 2, boxW, boxH);
      ctx.fillStyle = accentColor;
      ctx.fillRect(marginX, baseY - boxH / 2, accentW, boxH);

      if (boxW > 48 * scale) {
        ctx.font = buildFontString(fontWeight, italic, Math.round(32 * scale), fontStack);
        const fill = createTextFill(ctx, marginX + 24 * scale + headW / 2, baseY, headW, spec, textColor);
        drawStyledTextLine(ctx, {
          text: headText,
          x: marginX + 22 * scale,
          y: baseY - 4 * scale,
          align: 'left',
          letterSpacingPx: effSpacing,
          fillStyle: fill,
          strokeColor,
          strokeWidthPx: strokeWidth * 0.65,
          shadowColor,
          shadowBlurPx: shadowBlur * 0.5,
          wavePhase,
          waveAmpPx: waveAmpPx * 0.65,
          splitFactor: morphSplitFactor * 0.65,
        });

        if (subheadingRaw) {
          ctx.font = buildFontString(500, italic, Math.round(20 * scale), fontStack);
          drawStyledTextLine(ctx, {
            text: subheadingRaw,
            x: marginX + 22 * scale,
            y: baseY + 26 * scale * (lineHMult / 1.18),
            align: 'left',
            letterSpacingPx: effSpacing * 0.4,
            fillStyle: '#cbd5e1',
          });
        }
      }
    } else if (spec.template === 'subtitle') {
      const text = headText || spec.bodyText || 'Subtitle caption text';
      ctx.font = buildFontString(fontWeight, italic, Math.round(30 * scale), fontStack);
      const textW = measureTrackedTextWidth(ctx, text, effSpacing);
      const padX = (24 + (spec.pillPadding ?? 10)) * scale;
      const boxW = Math.max(40 * scale, (textW + padX * 2) * capsuleReveal);
      const boxH = 54 * scale;
      const align = spec.align || 'center';
      const cx = align === 'left' ? width * 0.08 + boxW / 2 : align === 'right' ? width * 0.92 - boxW / 2 : width / 2;
      const cy = height - 68 * (height / 720);

      ctx.fillStyle = safeColor(spec.pillBgColor && spec.pillBgColor !== 'transparent' ? spec.pillBgColor : 'rgba(8, 10, 14, 0.80)', 'rgba(8, 10, 14, 0.80)');
      ctx.beginPath();
      ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 10 * scale);
      ctx.fill();

      ctx.textBaseline = 'middle';
      const fill = createTextFill(ctx, cx, cy, textW, spec, textColor);
      drawStyledTextLine(ctx, {
        text,
        x: cx,
        y: cy,
        align: 'center',
        letterSpacingPx: effSpacing,
        fillStyle: fill,
        strokeColor,
        strokeWidthPx: strokeWidth * 0.7,
        shadowColor,
        shadowBlurPx: shadowBlur * 0.45,
        wavePhase,
        waveAmpPx: waveAmpPx * 0.6,
        splitFactor: morphSplitFactor * 0.6,
      });
    } else if (spec.template === 'vector_badge') {
      const cx = width / 2;
      const cy = height / 2;
      const r = 132 * scale * Math.max(0.35, capsuleReveal);

      ctx.strokeStyle = accentColor;
      ctx.lineWidth = Math.max(2, 3 * scale);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2 * ribbonFold);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.15);
      ctx.lineTo(cx + r * 1.15, cy);
      ctx.lineTo(cx, cy + r * 1.15);
      ctx.lineTo(cx - r * 1.15, cy);
      ctx.closePath();
      ctx.stroke();

      ctx.textBaseline = 'middle';
      ctx.font = buildFontString(fontWeight, italic, Math.round(44 * scale), fontStack);
      const textW = measureTrackedTextWidth(ctx, headText, effSpacing);
      const fill = createTextFill(ctx, cx, cy, textW, spec, textColor);
      drawStyledTextLine(ctx, {
        text: headText,
        x: cx,
        y: cy - 10 * scale,
        align: 'center',
        letterSpacingPx: effSpacing,
        fillStyle: fill,
        strokeColor,
        strokeWidthPx: strokeWidth * 0.75,
        shadowColor,
        shadowBlurPx: shadowBlur * 0.65,
        wavePhase,
        waveAmpPx: waveAmpPx * 0.7,
        splitFactor: morphSplitFactor * 0.8,
      });

      if (subheadingRaw) {
        ctx.font = buildFontString(600, italic, Math.round(20 * scale), '"JetBrains Mono", monospace');
        drawStyledTextLine(ctx, {
          text: subheadingRaw,
          x: cx,
          y: cy + 30 * scale,
          align: 'center',
          letterSpacingPx: Math.max(1 * scale, effSpacing * 0.5),
          fillStyle: accentColor,
        });
      }
    }

    ctx.restore();
  };

  // Render outgoing word A during active text_morph / liquid_dissolve cross-phase
  if (morphCrossfadeOutA && morphCrossfadeOutA.alpha > 0.02) {
    drawMainTemplate(morphCrossfadeOutA.text, morphCrossfadeOutA.blurPx, morphCrossfadeOutA.alpha / Math.max(0.01, animAlpha));
  }
  drawMainTemplate(activeDisplayHeading);

  // Leading accent cursor line on wipe_reveal
  if (clipWipePct !== null && clipWipePct > 0.01 && clipWipePct < 0.99) {
    const lineX = width * clipWipePct;
    ctx.save();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.beginPath();
    ctx.moveTo(lineX, height * 0.25);
    ctx.lineTo(lineX, height * 0.75);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function buildCreditLines(spec: TitleSpec): { role: string; name: string; isHeader: boolean }[] {
  const out: { role: string; name: string; isHeader: boolean }[] = [];
  if (spec.heading) {
    out.push({ role: '', name: spec.heading, isHeader: true });
    out.push({ role: '', name: '', isHeader: false });
  }
  const rawLines = (
    spec.bodyText ||
    'Directed By :: Jordan Vance\nCinematography :: Elena Rostova\nEdited By :: Obsidian Cut\nSound Design :: Pulse Audio'
  ).split('\n');
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push({ role: '', name: '', isHeader: false });
    } else if (trimmed.includes('::')) {
      const [r, n] = trimmed.split('::');
      out.push({ role: r.trim(), name: (n || '').trim(), isHeader: false });
    } else {
      out.push({ role: '', name: trimmed, isHeader: false });
    }
  }
  return out;
}

function drawCreditsLines(
  ctx: CanvasRenderingContext2D,
  spec: TitleSpec,
  lines: { role: string; name: string; isHeader: boolean }[],
  width: number,
  startY: number,
  scale: number,
  fontStack: string,
  textColor: string,
  accentColor: string,
) {
  const lineH = 44 * scale * ((spec.lineHeight ?? 1.18) / 1.18);
  const cx = width / 2;
  const weight = spec.fontWeight ?? 700;
  const italic = Boolean(spec.italic);
  let y = startY;

  for (const item of lines) {
    if (item.isHeader) {
      ctx.textAlign = 'center';
      ctx.fillStyle = accentColor;
      ctx.font = buildFontString(weight, italic, Math.round(46 * scale), fontStack);
      ctx.fillText(applyTextTransform(item.name, spec.textTransform), cx, y);
      y += lineH * 1.4;
    } else if (item.role) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#94a3b8';
      ctx.font = `500 ${Math.round(22 * scale)}px "Public Sans", sans-serif`;
      ctx.fillText(item.role, cx - 18 * scale, y);

      ctx.textAlign = 'left';
      ctx.fillStyle = textColor;
      ctx.font = buildFontString(Math.min(700, weight), italic, Math.round(24 * scale), fontStack);
      ctx.fillText(item.name, cx + 18 * scale, y);
      y += lineH;
    } else if (item.name) {
      ctx.textAlign = 'center';
      ctx.fillStyle = textColor;
      ctx.font = buildFontString(Math.min(700, weight), italic, Math.round(26 * scale), fontStack);
      ctx.fillText(item.name, cx, y);
      y += lineH;
    } else {
      y += lineH * 0.7;
    }
  }
}

/**
 * Generates an alpha-transparent PNG data URL at exact export resolution
 * for cross-platform FFmpeg compositing (Linux, WSL, and Windows).
 */
export function renderTitleToExportPng(
  spec: TitleSpec,
  width: number,
  height: number,
): { dataUrl: string; outHeight: number } {
  const scale = (width / 1280) * (spec.fontSize || 1);
  const fontStack = resolveCanvasFontStack(spec.fontFamily);
  const textColor = safeColor(spec.textColor, '#ffffff');
  const accentColor = safeColor(spec.accentColor, '#3b82f6');

  if (spec.template === 'scrolling_credits') {
    const lines = buildCreditLines(spec);
    const lineH = 44 * scale * ((spec.lineHeight ?? 1.18) / 1.18);
    const stripH = Math.max(height, Math.ceil(lines.length * lineH + 160 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = stripH;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, width, stripH);
      drawCreditsLines(ctx, spec, lines, width, 64 * scale, scale, fontStack, textColor, accentColor);
    }
    return { dataUrl: canvas.toDataURL('image/png'), outHeight: stripH };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, width, height);
    drawVectorTitle(ctx, spec, width, height, 0.5, 4);
  }
  return { dataUrl: canvas.toDataURL('image/png'), outHeight: height };
}

/**
 * Generates either a single PNG (for static titles / scrolling credits) OR an adaptive-duration
 * frame sequence (ffconcat compatible) for animated & morphed titles so FFmpeg exports match
 * live canvas animations 1:1 while collapsing static hold spans into single frames.
 */
export function renderTitleExportAssets(
  spec: TitleSpec,
  width: number,
  height: number,
  durationSec: number,
  fps: number,
):
  | { mode: 'single'; dataUrl: string; outHeight: number }
  | { mode: 'frames'; frames: { png: string; duration: number }[] } {
  if (!hasAnimatedTitleEffects(spec)) {
    const single = renderTitleToExportPng(spec, width, height);
    return { mode: 'single', ...single };
  }

  const dur = Math.max(0.4, durationSec || 3);
  const sampleFps = Math.min(20, Math.max(12, Math.round(fps)));
  const dt = 1 / sampleFps;
  const anim = spec.animation || 'none';
  const morph = spec.morphAnimation || 'none';
  const continuousMotion = anim === 'wave_bounce' || morph === 'weight_scale_morph';

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const single = renderTitleToExportPng(spec, width, height);
    return { mode: 'single', ...single };
  }

  // Render sampled frames and collapse identical consecutive hold frames into one frame with summed duration
  const frames: { png: string; duration: number }[] = [];
  const animDur = Math.max(0.25, Math.min(dur * 0.48, spec.animDurationSec ?? 0.9));
  const morphPeak = Math.max(0.2, Math.min(0.85, spec.morphPeakPct ?? 0.52));

  let t = 0;
  let lastKey = '';
  const maxSteps = 220;
  let step = 0;

  while (t < dur - 0.005 && step < maxSteps) {
    const stepDur = Math.min(dt, dur - t);
    const prog = Math.max(0, Math.min(1, (t + stepDur * 0.5) / dur));

    // Determine if we are inside a static hold window where visual state does not change frame-to-frame
    const inEntrance = anim !== 'none' && t <= animDur + dt;
    const inExit = Boolean(spec.animOut && anim !== 'none' && t >= dur - animDur - dt);
    const inGlitch = anim === 'glitch_flicker' && (prog < 0.27 || (spec.animOut && prog > 0.76));
    const inMorphWindow =
      morph !== 'none' &&
      ((morph === 'text_morph' || morph === 'liquid_dissolve')
        ? Math.abs(prog - morphPeak) <= 0.14
        : morph === 'capsule_expand' || morph === 'ribbon_unfold' || morph === 'split_converge'
          ? prog <= 0.42 || prog >= 0.7 || Math.abs(prog - morphPeak) <= 0.06
          : true);

    const isStaticHold = !continuousMotion && !inEntrance && !inExit && !inGlitch && !inMorphWindow;
    const stateKey = isStaticHold
      ? `hold:${prog > morphPeak ? 'post' : 'pre'}`
      : `f:${step}`;

    if (isStaticHold && lastKey === stateKey && frames.length > 0) {
      frames[frames.length - 1].duration = Number((frames[frames.length - 1].duration + stepDur).toFixed(4));
    } else {
      ctx.clearRect(0, 0, width, height);
      drawVectorTitle(ctx, spec, width, height, prog, dur);
      frames.push({
        png: canvas.toDataURL('image/png'),
        duration: Number(stepDur.toFixed(4)),
      });
      lastKey = stateKey;
    }

    t += stepDur;
    step += 1;
  }

  if (frames.length === 0) {
    const single = renderTitleToExportPng(spec, width, height);
    return { mode: 'single', ...single };
  }

  return { mode: 'frames', frames };
}
