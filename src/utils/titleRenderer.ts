import { TITLE_FONT_OPTIONS, TitleSpec } from '../types/editor';

function resolveCanvasFontStack(fontFamily?: string): string {
  const face = (fontFamily || 'Outfit').trim() || 'Outfit';
  const found = TITLE_FONT_OPTIONS.find((opt) => opt.value === face);
  if (found?.fallback === 'serif') {
    return `"${face}", Georgia, serif`;
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
  return fallback;
}

/**
 * Draws crisp vector titles, lower thirds, subtitles, vector badges,
 * and scrolling motion picture credits onto any Canvas 2D context.
 * Used identically for real-time preview AND high-resolution export PNG generation.
 */
export function drawVectorTitle(
  ctx: CanvasRenderingContext2D,
  spec: TitleSpec,
  width: number,
  height: number,
  progress = 0.5,
): void {
  const scale = (width / 1280) * (spec.fontSize || 1);
  const fontStack = resolveCanvasFontStack(spec.fontFamily);
  const textColor = safeColor(spec.textColor, '#ffffff');
  const accentColor = safeColor(spec.accentColor, '#3b82f6');

  ctx.save();

  // Optional solid/tinted card background (skip if transparent)
  if (spec.bgColor && spec.bgColor !== 'transparent') {
    ctx.fillStyle = safeColor(spec.bgColor, '#0d1117');
    ctx.fillRect(0, 0, width, height);
  }

  if (spec.template === 'main_title') {
    const cx = width / 2;
    const cy = height / 2;

    // Subtle vector geometric framing lines
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = Math.max(2, 3 * scale);
    const barW = Math.min(width * 0.35, 220 * scale);
    ctx.beginPath();
    ctx.moveTo(cx - barW / 2, cy - 52 * scale);
    ctx.lineTo(cx + barW / 2, cy - 52 * scale);
    ctx.moveTo(cx - barW / 2, cy + 58 * scale);
    ctx.lineTo(cx + barW / 2, cy + 58 * scale);
    ctx.stroke();

    ctx.textAlign = spec.align || 'center';
    const textX = spec.align === 'left' ? width * 0.12 : spec.align === 'right' ? width * 0.88 : cx;

    ctx.fillStyle = textColor;
    ctx.font = `700 ${Math.round(62 * scale)}px ${fontStack}`;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 16 * scale;
    ctx.fillText(spec.heading || 'MAIN TITLE', textX, cy + 6 * scale);

    if (spec.subheading) {
      ctx.font = `500 ${Math.round(24 * scale)}px ${fontStack}`;
      ctx.fillStyle = accentColor;
      ctx.fillText(spec.subheading, textX, cy + 42 * scale);
    }
  } else if (spec.template === 'lower_third') {
    const marginX = 64 * (width / 1280);
    const baseY = height - 96 * (height / 720);
    const accentW = 6 * scale;
    const boxH = 82 * scale;

    ctx.font = `700 ${Math.round(32 * scale)}px ${fontStack}`;
    const headW = ctx.measureText(spec.heading || 'Speaker Name').width;
    ctx.font = `500 ${Math.round(20 * scale)}px ${fontStack}`;
    const subW = ctx.measureText(spec.subheading || 'Role / Location').width;
    const boxW = Math.max(headW, subW) + 56 * scale;

    // Clean vector backing card + sharp accent stripe
    ctx.fillStyle = 'rgba(12, 15, 20, 0.84)';
    ctx.fillRect(marginX, baseY - boxH / 2, boxW, boxH);
    ctx.fillStyle = accentColor;
    ctx.fillRect(marginX, baseY - boxH / 2, accentW, boxH);

    ctx.textAlign = 'left';
    ctx.fillStyle = textColor;
    ctx.font = `700 ${Math.round(32 * scale)}px ${fontStack}`;
    ctx.fillText(spec.heading || 'Speaker Name', marginX + 22 * scale, baseY - 4 * scale);

    if (spec.subheading) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = `500 ${Math.round(20 * scale)}px ${fontStack}`;
      ctx.fillText(spec.subheading, marginX + 22 * scale, baseY + 26 * scale);
    }
  } else if (spec.template === 'subtitle') {
    const text = spec.heading || spec.bodyText || 'Subtitle caption text';
    ctx.font = `600 ${Math.round(30 * scale)}px ${fontStack}`;
    const metrics = ctx.measureText(text);
    const padX = 24 * scale;
    const boxW = metrics.width + padX * 2;
    const boxH = 52 * scale;
    const align = spec.align || 'center';
    const cx = align === 'left' ? width * 0.08 + boxW / 2 : align === 'right' ? width * 0.92 - boxW / 2 : width / 2;
    const cy = height - 68 * (height / 720);

    ctx.fillStyle = 'rgba(8, 10, 14, 0.78)';
    ctx.beginPath();
    ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 8 * scale);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    ctx.fillText(text, cx, cy);
  } else if (spec.template === 'vector_badge') {
    const cx = width / 2;
    const cy = height / 2;
    const r = 130 * scale;

    // Vector crest geometry (diamond + outer ring + crosshair ticks)
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 1.15);
    ctx.lineTo(cx + r * 1.15, cy);
    ctx.lineTo(cx, cy + r * 1.15);
    ctx.lineTo(cx - r * 1.15, cy);
    ctx.closePath();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    ctx.font = `700 ${Math.round(44 * scale)}px ${fontStack}`;
    ctx.fillText(spec.heading || 'STUDIO EDITION', cx, cy - 10 * scale);

    if (spec.subheading) {
      ctx.fillStyle = accentColor;
      ctx.font = `600 ${Math.round(20 * scale)}px "JetBrains Mono", monospace`;
      ctx.fillText(spec.subheading, cx, cy + 28 * scale);
    }
  } else if (spec.template === 'scrolling_credits') {
    const lines = buildCreditLines(spec);
    const lineH = 44 * scale;
    const totalContentH = Math.max(height, lines.length * lineH + 140 * scale);
    const startY = height - progress * (height + totalContentH);

    drawCreditsLines(ctx, spec, lines, width, startY, scale, fontStack, textColor, accentColor);
  }

  ctx.restore();
}

function buildCreditLines(spec: TitleSpec): { role: string; name: string; isHeader: boolean }[] {
  const out: { role: string; name: string; isHeader: boolean }[] = [];
  if (spec.heading) {
    out.push({ role: '', name: spec.heading, isHeader: true });
    out.push({ role: '', name: '', isHeader: false });
  }
  const rawLines = (spec.bodyText || 'Directed By :: Jordan Vance\nCinematography :: Elena Rostova\nEdited By :: Obsidian Cut\nSound Design :: Pulse Audio').split('\n');
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
  const lineH = 44 * scale;
  const cx = width / 2;
  let y = startY;

  for (const item of lines) {
    if (item.isHeader) {
      ctx.textAlign = 'center';
      ctx.fillStyle = accentColor;
      ctx.font = `700 ${Math.round(46 * scale)}px ${fontStack}`;
      ctx.fillText(item.name, cx, y);
      y += lineH * 1.4;
    } else if (item.role) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#94a3b8';
      ctx.font = `500 ${Math.round(22 * scale)}px "Public Sans", sans-serif`;
      ctx.fillText(item.role, cx - 18 * scale, y);

      ctx.textAlign = 'left';
      ctx.fillStyle = textColor;
      ctx.font = `600 ${Math.round(24 * scale)}px ${fontStack}`;
      ctx.fillText(item.name, cx + 18 * scale, y);
      y += lineH;
    } else if (item.name) {
      ctx.textAlign = 'center';
      ctx.fillStyle = textColor;
      ctx.font = `600 ${Math.round(26 * scale)}px ${fontStack}`;
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
 * For scrolling credits, generates the tall credit roll strip once so FFmpeg scrolls it at native fps.
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
    const lineH = 44 * scale;
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
    drawVectorTitle(ctx, spec, width, height, 0.5);
  }
  return { dataUrl: canvas.toDataURL('image/png'), outHeight: height };
}
