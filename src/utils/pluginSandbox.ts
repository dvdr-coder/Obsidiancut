import { ClipEffects, ColorGradeConfig } from '../types/editor';

export interface PluginExecutionResult {
  ok: boolean;
  error?: string;
}

const faultedPlugins = new Map<string, string>();

export function clampFinite(val: number, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

export function sanitizeClipEffects(fx: Partial<ClipEffects> | undefined): ClipEffects {
  const hex = typeof fx?.chromaKeyColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(fx.chromaKeyColor)
    ? fx.chromaKeyColor
    : '#00ff00';

  return {
    brightness: clampFinite(fx?.brightness ?? 0, -0.5, 0.5, 0),
    contrast: clampFinite(fx?.contrast ?? 1, 0.2, 2.5, 1),
    gamma: clampFinite(fx?.gamma ?? 1, 0.3, 2.5, 1),
    hue: clampFinite(fx?.hue ?? 0, -180, 180, 0),
    saturation: clampFinite(fx?.saturation ?? 1, 0, 2.5, 1),
    greyscale: Boolean(fx?.greyscale),
    chromaKeyEnabled: Boolean(fx?.chromaKeyEnabled),
    chromaKeyColor: hex,
    chromaKeySimilarity: clampFinite(fx?.chromaKeySimilarity ?? 0.18, 0.01, 0.85, 0.18),
    chromaKeyBlend: clampFinite(fx?.chromaKeyBlend ?? 0.08, 0, 0.6, 0.08),
  };
}

export function sanitizeColorGrade(cg: Partial<ColorGradeConfig> | undefined): ColorGradeConfig {
  const validPresets = new Set([
    'none',
    'cinematic_teal',
    'kodak_warm',
    'mono_noir',
    'matte_fade',
    'vivid_hdr',
  ]);
  const preset = cg?.preset && validPresets.has(cg.preset) ? cg.preset : 'none';
  return {
    enabled: Boolean(cg?.enabled),
    preset,
    exposure: clampFinite(cg?.exposure ?? 0, -0.5, 0.5, 0),
    contrast: clampFinite(cg?.contrast ?? 1, 0.2, 2.5, 1),
    saturation: clampFinite(cg?.saturation ?? 1, 0, 2.5, 1),
    gamma: clampFinite(cg?.gamma ?? 1, 0.3, 2.5, 1),
    temperature: clampFinite(cg?.temperature ?? 0, -0.6, 0.6, 0),
    tint: clampFinite(cg?.tint ?? 0, -0.6, 0.6, 0),
    vignette: clampFinite(cg?.vignette ?? 0, 0, 1.0, 0),
  };
}

/**
 * Executes a Canvas plugin stage inside an isolated boundary.
 * Restores canvas state if the plugin throws and quarantines the faulted plugin ID
 * so a single buggy filter never crashes timeline playback or the host UI.
 */
export function runSandboxedCanvasStage(
  pluginId: string,
  ctx: CanvasRenderingContext2D,
  fn: () => void,
): PluginExecutionResult {
  if (faultedPlugins.has(pluginId)) {
    return { ok: false, error: faultedPlugins.get(pluginId) };
  }
  ctx.save();
  try {
    fn();
    ctx.restore();
    return { ok: true };
  } catch (err) {
    try {
      ctx.restore();
    } catch {
      // ignore restore failure
    }
    const msg = err instanceof Error ? err.message : 'Plugin execution error';
    faultedPlugins.set(pluginId, msg);
    return { ok: false, error: msg };
  }
}

export function getPluginFault(pluginId: string): string | null {
  return faultedPlugins.get(pluginId) ?? null;
}

export function resetPluginFault(pluginId: string): void {
  faultedPlugins.delete(pluginId);
}
