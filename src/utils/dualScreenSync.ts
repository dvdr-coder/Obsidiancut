import {
  ColorGradeConfig,
  ExportConfig,
  MediaAsset,
  PreviewClarityMode,
  ScreenMonitorInfo,
  TimelineClip,
  TimelineTrack,
} from '../types/editor';

export const DUAL_DISPLAY_CHANNEL_NAME = 'obsidiancut_dual_display_v1';
export const DUAL_DISPLAY_STORAGE_KEY = 'obsidiancut_dual_display_snapshot_v1';

export interface DualDisplaySnapshot {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  assets: MediaAsset[];
  colorGrade: ColorGradeConfig;
  bypassGrade: boolean;
  resolution: ExportConfig['resolution'];
  fps: ExportConfig['fps'];
  playhead: number;
  isPlaying: boolean;
  masterMuted: boolean;
  normalizeAudio: boolean;
  normalizeTargetLufs: number;
  clarityMode: PreviewClarityMode;
  theme: 'dark' | 'light';
  timestamp: number;
}

export type DualDisplayCommand =
  | { type: 'REQUEST_STATE' }
  | { type: 'TOGGLE_PLAY' }
  | { type: 'SEEK'; playhead: number }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'SET_CLARITY'; clarityMode: PreviewClarityMode }
  | { type: 'REDOCK' }
  | { type: 'WINDOW_CLOSED' };

type ChannelEnvelope =
  | { kind: 'snapshot'; payload: DualDisplaySnapshot }
  | { kind: 'command'; payload: DualDisplayCommand };

interface NativeScreenDetailed {
  label?: string;
  isPrimary?: boolean;
  isInternal?: boolean;
  availLeft?: number;
  availTop?: number;
  availWidth?: number;
  availHeight?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  devicePixelRatio?: number;
}

interface NativeScreenDetails {
  screens: NativeScreenDetailed[];
  currentScreen?: NativeScreenDetailed;
}

export function isWindowManagementSupported(): boolean {
  return typeof window !== 'undefined' && 'getScreenDetails' in window;
}

export function isBrowserMultiScreenExtended(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window.screen as Screen & { isExtended?: boolean }).isExtended);
}

export function getFallbackMonitors(): ScreenMonitorInfo[] {
  if (typeof window === 'undefined') return [];
  const s = window.screen as Screen & { availLeft?: number; availTop?: number; isExtended?: boolean };
  const primary: ScreenMonitorInfo = {
    id: 'screen-0',
    label: s.isExtended ? 'Display 1 (Primary)' : 'Display 1',
    isPrimary: true,
    isInternal: true,
    left: s.availLeft ?? 0,
    top: s.availTop ?? 0,
    width: s.width || 1920,
    height: s.height || 1080,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
  return [primary];
}

export async function detectExtendedScreens(): Promise<{
  screens: ScreenMonitorInfo[];
  permissionGranted: boolean;
  multiScreenApiSupported: boolean;
}> {
  const apiSupported = isWindowManagementSupported();
  if (apiSupported) {
    try {
      const fn = (window as unknown as { getScreenDetails: () => Promise<NativeScreenDetails> }).getScreenDetails;
      const details = await fn();
      if (details && Array.isArray(details.screens) && details.screens.length > 0) {
        const mapped: ScreenMonitorInfo[] = details.screens.map((scr, idx) => ({
          id: `screen-${idx}`,
          label: scr.label?.trim() || (scr.isPrimary ? `Display ${idx + 1} (Primary)` : `Extended Display ${idx + 1}`),
          isPrimary: Boolean(scr.isPrimary),
          isInternal: Boolean(scr.isInternal),
          left: scr.availLeft ?? scr.left ?? 0,
          top: scr.availTop ?? scr.top ?? 0,
          width: scr.availWidth ?? scr.width ?? 1920,
          height: scr.availHeight ?? scr.height ?? 1080,
          devicePixelRatio: scr.devicePixelRatio || window.devicePixelRatio || 1,
        }));
        return { screens: mapped, permissionGranted: true, multiScreenApiSupported: true };
      }
    } catch {
      return { screens: getFallbackMonitors(), permissionGranted: false, multiScreenApiSupported: true };
    }
  }
  return { screens: getFallbackMonitors(), permissionGranted: false, multiScreenApiSupported: false };
}

export function buildPreviewPopupUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.set('window', 'preview');
  return url.toString();
}

export function openDetachedPreviewPopup(targetScreen?: ScreenMonitorInfo): {
  win: Window | null;
  blocked: boolean;
} {
  const url = buildPreviewPopupUrl();
  const w = targetScreen ? Math.min(targetScreen.width, Math.max(960, Math.round(targetScreen.width * 0.92))) : 1280;
  const h = targetScreen ? Math.min(targetScreen.height, Math.max(600, Math.round(targetScreen.height * 0.9))) : 780;
  const left = targetScreen
    ? Math.round(targetScreen.left + Math.max(0, (targetScreen.width - w) / 2))
    : Math.max(40, Math.round((window.screen.width - w) / 2));
  const top = targetScreen
    ? Math.round(targetScreen.top + Math.max(0, (targetScreen.height - h) / 2))
    : Math.max(40, Math.round((window.screen.height - h) / 2));

  const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no`;
  const win = window.open(url, 'obsidiancut_preview_monitor', features);
  if (!win) {
    return { win: null, blocked: true };
  }
  try {
    win.focus();
  } catch {
    // ignore focus restriction
  }
  return { win, blocked: false };
}

let sharedChannel: BroadcastChannel | null = null;
function getSharedChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!sharedChannel) {
    sharedChannel = new BroadcastChannel(DUAL_DISPLAY_CHANNEL_NAME);
  }
  return sharedChannel;
}

export function broadcastDualSnapshot(snapshot: DualDisplaySnapshot): void {
  try {
    const ch = getSharedChannel();
    if (ch) {
      const env: ChannelEnvelope = { kind: 'snapshot', payload: snapshot };
      ch.postMessage(env);
    }
  } catch {
    // ignore channel errors
  }
  try {
    // Strip heavy waveform arrays when persisting fallback snapshot to localStorage
    const compact: DualDisplaySnapshot = {
      ...snapshot,
      assets: snapshot.assets.map((a) => ({ ...a, waveform: undefined, beats: undefined })),
      clips: snapshot.clips.map((c) => ({ ...c, waveform: undefined, beats: undefined })),
    };
    localStorage.setItem(DUAL_DISPLAY_STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // ignore quota errors
  }
}

export function readStoredDualSnapshot(): DualDisplaySnapshot | null {
  try {
    const raw = localStorage.getItem(DUAL_DISPLAY_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DualDisplaySnapshot;
  } catch {
    return null;
  }
}

export function sendDualCommand(cmd: DualDisplayCommand): void {
  try {
    const ch = getSharedChannel();
    if (ch) {
      const env: ChannelEnvelope = { kind: 'command', payload: cmd };
      ch.postMessage(env);
    }
  } catch {
    // ignore
  }
}

export function subscribeDualChannel(handlers: {
  onSnapshot?: (snap: DualDisplaySnapshot) => void;
  onCommand?: (cmd: DualDisplayCommand) => void;
}): () => void {
  let ch: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    ch = new BroadcastChannel(DUAL_DISPLAY_CHANNEL_NAME);
    ch.onmessage = (ev: MessageEvent<ChannelEnvelope>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.kind === 'snapshot') handlers.onSnapshot?.(msg.payload);
      else if (msg.kind === 'command') handlers.onCommand?.(msg.payload);
    };
  }

  const onStorage = (ev: StorageEvent) => {
    if (ev.key === DUAL_DISPLAY_STORAGE_KEY && ev.newValue) {
      try {
        handlers.onSnapshot?.(JSON.parse(ev.newValue) as DualDisplaySnapshot);
      } catch {
        // ignore parse error
      }
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener('storage', onStorage);
    if (ch) {
      ch.close();
    }
  };
}
