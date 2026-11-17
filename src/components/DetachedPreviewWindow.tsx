import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Monitor, MonitorCheck, PanelLeftClose, Sparkles } from 'lucide-react';
import { MediaAsset, PreviewClarityMode, ScreenMonitorInfo } from '../types/editor';
import {
  DualDisplaySnapshot,
  detectExtendedScreens,
  isBrowserMultiScreenExtended,
  readStoredDualSnapshot,
  sendDualCommand,
  subscribeDualChannel,
} from '../utils/dualScreenSync';
import { PreviewCanvas } from './PreviewCanvas';

export const DetachedPreviewWindow: React.FC = () => {
  const [snapshot, setSnapshot] = useState<DualDisplaySnapshot | null>(() => readStoredDualSnapshot());
  const [localPlayhead, setLocalPlayhead] = useState<number>(snapshot?.playhead ?? 0);
  const [clarityOverride, setClarityOverride] = useState<PreviewClarityMode>('ultra');
  const [screens, setScreens] = useState<ScreenMonitorInfo[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const monitorContainerRef = useRef<HTMLDivElement | null>(null);
  const lastSyncRef = useRef<number>(performance.now());

  useEffect(() => {
    if (snapshot?.theme) {
      document.documentElement.classList.toggle('dark', snapshot.theme === 'dark');
    }
  }, [snapshot?.theme]);

  useEffect(() => {
    document.title = 'Obsidian Cut — Extended Preview Monitor';
    const unsub = subscribeDualChannel({
      onSnapshot: (snap) => {
        setSnapshot(snap);
        lastSyncRef.current = performance.now();
        setLocalPlayhead((prev) => (Math.abs(prev - snap.playhead) > 0.18 || !snap.isPlaying ? snap.playhead : prev));
        setClarityOverride(snap.clarityMode || 'ultra');
      },
    });
    sendDualCommand({ type: 'REQUEST_STATE' });

    const onBeforeUnload = () => {
      sendDualCommand({ type: 'WINDOW_CLOSED' });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const assetsMap = useMemo(() => {
    const map = new Map<string, MediaAsset>();
    if (snapshot?.assets) {
      for (const a of snapshot.assets) map.set(a.id, a);
    }
    return map;
  }, [snapshot?.assets]);

  const handleToggleFullscreen = async (targetScreen?: ScreenMonitorInfo) => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      const el = monitorContainerRef.current || document.documentElement;
      const fsOpts: Record<string, unknown> = {};
      if (targetScreen && 'getScreenDetails' in window) {
        try {
          const fn = (window as unknown as { getScreenDetails: () => Promise<{ screens: unknown[] }> }).getScreenDetails;
          const details = await fn();
          const idx = Number(targetScreen.id.replace('screen-', ''));
          if (details?.screens?.[idx]) {
            fsOpts.screen = details.screens[idx];
          }
        } catch {
          // fallback to current display fullscreen
        }
      }
      await (el as HTMLElement & { requestFullscreen: (o?: Record<string, unknown>) => Promise<void> }).requestFullscreen(
        Object.keys(fsOpts).length > 0 ? fsOpts : undefined,
      );
    } catch {
      // ignore fullscreen rejection
    }
  };

  const handleScanDisplays = async () => {
    const res = await detectExtendedScreens();
    setScreens(res.screens);
  };

  const handleRedock = () => {
    sendDualCommand({ type: 'REDOCK' });
    window.close();
  };

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-[#0a0c10] text-slate-100 flex flex-col items-center justify-center p-6 text-center space-y-4">
        <Monitor className="w-10 h-10 text-blue-400" />
        <div>
          <h1 className="text-base font-semibold">Waiting for Obsidian Cut Workspace</h1>
          <p className="text-xs text-slate-400 mt-1">
            Open or play a timeline in the main Obsidian Cut window to mirror crisp live output here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => sendDualCommand({ type: 'REQUEST_STATE' })}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
          >
            Sync Now
          </button>
          <button
            type="button"
            onClick={handleRedock}
            className="px-3 py-1.5 rounded bg-[#181d26] hover:bg-[#232a36] border border-[#2a3140] text-slate-200 text-xs font-medium cursor-pointer"
          >
            Close Window
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={monitorContainerRef}
      className="h-screen w-screen flex flex-col bg-[#090b0f] text-slate-100 overflow-hidden"
    >
      {/* Clean Dedicated Extended Display Monitor Header */}
      <header className="h-10 px-3.5 bg-[#10141b] border-b border-[#222834] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <MonitorCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold tracking-tight text-white truncate">
            Extended Program Monitor
          </span>
          <span className="text-[11px] font-mono-tabular text-slate-400 hidden sm:inline">
            {snapshot.resolution.replace('x', '×')} · {snapshot.fps} fps
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Clarity Mode Switcher */}
          <div
            className="inline-flex items-center rounded border border-[#2a303d] bg-[#0b0e14] overflow-hidden"
            title="Monitor Output Clarity"
          >
            <span className="px-2 py-0.5 text-[10px] text-slate-400 flex items-center gap-1 border-r border-[#222834]">
              <Sparkles className="w-2.5 h-2.5 text-blue-400" />
              <span className="hidden md:inline">Clarity</span>
            </span>
            {(
              [
                { id: 'standard', label: 'Std' },
                { id: 'hd', label: 'HD' },
                { id: 'ultra', label: 'Ultra' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setClarityOverride(opt.id);
                  sendDualCommand({ type: 'SET_CLARITY', clarityMode: opt.id });
                }}
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                  clarityOverride === opt.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {isBrowserMultiScreenExtended() && screens.length <= 1 && (
            <button
              type="button"
              onClick={handleScanDisplays}
              className="px-2 py-1 rounded bg-[#181d26] hover:bg-[#232b38] border border-[#2c3444] text-[11px] text-slate-200 cursor-pointer hidden md:flex items-center gap-1"
            >
              <Monitor className="w-3 h-3 text-blue-400" />
              <span>Pick Display</span>
            </button>
          )}

          {screens.length > 1 && (
            <select
              aria-label="Send Fullscreen to Display"
              defaultValue=""
              onChange={(e) => {
                const chosen = screens.find((s) => s.id === e.target.value);
                if (chosen) handleToggleFullscreen(chosen);
              }}
              className="h-7 px-2 rounded bg-[#0b0e14] border border-[#2c3444] text-[11px] text-slate-200"
            >
              <option value="" disabled>
                Fullscreen on Screen...
              </option>
              {screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.width}×{s.height})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => handleToggleFullscreen()}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen Monitor'}
            className="px-2.5 py-1 rounded bg-[#181d26] hover:bg-[#232b38] border border-[#2c3444] text-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            <span className="hidden sm:inline">{isFullscreen ? 'Exit FS' : 'Fullscreen'}</span>
          </button>

          <button
            type="button"
            onClick={handleRedock}
            title="Return preview monitor back into main editor window"
            className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer"
          >
            <PanelLeftClose className="w-3 h-3" />
            <span>Re-dock</span>
          </button>
        </div>
      </header>

      {/* Full-Bleed High-Clarity Program Preview Stage */}
      <div className="flex-1 min-h-0 p-2">
        <PreviewCanvas
          tracks={snapshot.tracks}
          clips={snapshot.clips}
          assetsMap={assetsMap}
          colorGrade={snapshot.colorGrade}
          bypassGrade={snapshot.bypassGrade}
          resolution={snapshot.resolution}
          fps={snapshot.fps}
          playhead={localPlayhead}
          isPlaying={snapshot.isPlaying}
          masterMuted={snapshot.masterMuted}
          normalizeAudio={snapshot.normalizeAudio}
          normalizeTargetLufs={snapshot.normalizeTargetLufs}
          clarityMode={clarityOverride}
          isDetachedMode
          onPlayheadChange={(t) => {
            setLocalPlayhead(t);
            sendDualCommand({ type: 'SEEK', playhead: t });
          }}
          onTogglePlay={() => sendDualCommand({ type: 'TOGGLE_PLAY' })}
          onToggleMute={() => sendDualCommand({ type: 'TOGGLE_MUTE' })}
        />
      </div>
    </div>
  );
};
