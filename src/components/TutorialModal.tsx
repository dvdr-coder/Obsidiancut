import React, { useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Keyboard, X } from 'lucide-react';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadSamplePack: () => void;
  onSwitchMode: (mode: 'auto' | 'manual') => void;
}

const STEPS = [
  {
    title: '01. Import Media, Search & Smart Proxies',
    goal: 'Bring photos, videos, transparent PNG logos, and songs into your project without slowing down low-end hardware.',
    actions: [
      'Drag files into the Media Bin on the left (MP4, MOV, MKV, WebM, AVI, PNG, JPG, WebP, GIF, BMP, TIFF, MP3, WAV, AAC, M4A, FLAC, OGG, Opus), or click "Load Sample Photos + 120 BPM" to test immediately.',
      'Heavy 4K/VFR videos and oversized photos automatically receive lightweight editing proxies for smooth scrubbing while keeping full-resolution masters for final export.',
      'Uploaded music tracks are analyzed in Python for BPM, waveform peaks, and beat timestamps (shown as gold ticks on the timeline ruler).',
    ],
  },
  {
    title: '02. Auto Sync vs. Endless Workspace & Boundless Tracks',
    goal: 'Generate a beat-synced cut in one click or explore rough cuts freely across unlimited vertical audio, video, and overlay layers.',
    actions: [
      'In Auto Mode (Beat Sync), pick your music track, choose Beat Sync Pace (Every Beat, Every 2 Beats, Every 4 Beats, or Fit Song), select a transition mix, and click Auto-Assemble.',
      'Open Endless Workspace for zero-restriction rough cuts: stack unlimited Overlay Layers, Video Tracks, and Audio Tracks vertically, reorder z-order priority with Up/Down arrows, lock/rename tracks, and drag the bottom resize handle to expand stack height.',
      'Enable Rough Cut to unlock rigid snapping across an auto-expanding horizontal canvas, drop assets onto the top/bottom drop strips to auto-stack new layers, and Save / Load project JSON anytime.',
    ],
  },
  {
    title: '03. Music Layers: Waveforms, Draggers, Cuts, Ducking & Transitions',
    goal: 'Sculpt background music incrementally on the timeline waveform, crossfade between songs, and auto-duck under dialogue.',
    actions: [
      'Direct Waveform Draggers: drag the yellow horizontal volume line up/down for base level (0%–200%), drag top-left/top-right emerald corner dots horizontally for Fade In/Fade Out ramps, or drag the Audio Track header fader.',
      'Incremental Volume Increase/Decrease: double-click anywhere along a music clip rubber-band (or inside the Clip Inspector Waveform Volume Curve) to drop diamond envelope points and drag them up/down & left/right—or apply 1-click Ramp Up, Ramp Down, or Mid Dialogue Dip presets.',
      'Music Cuts & Transitions: press S (or Cut @ Playhead) to split music cleanly, click Loop / Repeat to extend a bed, enable Auto-Duck BGM so music automatically dips when voice/dialogue plays, and click the emerald seam badge between adjacent music clips to add Equal-Power Crossfade, Linear Crossfade, or Dip & Swell.',
    ],
  },
  {
    title: '04. Video Transitions, Resize/Crop, Overlays & Chroma Key',
    goal: 'Add smooth scene transitions, picture-in-picture watermarks, green-screen keys, and speed ramps.',
    actions: [
      'Select any timeline clip and pick from 30 transitions in the Clip Inspector or seam badge (`Fade`, `Dissolve`, `Wipe`, `Dip to Black/White`, slides, `Iris`, `Pixelize`) and adjust duration (`0.1s`–`2.5s`).',
      'Drag corner handles directly on the Preview Canvas to resize/scale overlays interactively, or toggle Crop mode to trim edges and apply 16:9 / 9:16 / 1:1 / 4:5 presets.',
      'Click Layers on any photo/video in the Media Bin to place it on the top overlay track, then apply `TL/TR/BL/BR` presets, Rotation, Speed (`0.25x–4.0x`), Reverse playback, and Chroma Key.',
    ],
  },
  {
    title: '05. Advanced Studio: Fusion Keyframes, Fairlight & MultiMaster',
    goal: 'Animate properties with spline graphs, mix audio buses with EQ/DSP plugins, and synchronize multi-camera timelines.',
    actions: [
      'Switch to Advanced Studio -> Fusion VFX & Keyframes to add keyframes for Opacity, Scale, Position X/Y, and Rotation, and sculpt smooth Ease-In / Ease-Out / Ease-In-Out curves inside the Visual Graph Editor—alongside 3D particles, rotoscoping, camera tracking, and Krokodove nodes.',
      'Open Fairlight Audio Post-Production for folder-track submix buses, parametric 3-band EQ, Compressor/Limiter, De-Esser, ADR cue sheet recording, and VST plugin routing.',
      'Use MultiMaster & Transitions to pack/unpack Nested Timelines, sync multi-cam angles by audio/timecode, and organize team Power Bins & Smart Bins.',
    ],
  },
  {
    title: '06. Vector Titles, Hex Colors & Per-Picture Color Grading',
    goal: 'Design cinema titles with exact fonts/hex colors and grade individual photos or the entire timeline safely.',
    actions: [
      'Open Titles & Credits in the Media Bin to add Main Cinema Title, Lower Third, Subtitle Caption, Vector Crest, or Scrolling Credits with Sans/Display/Serif/Mono fonts and full `#RRGGBB` / `#RGB` spectrum + swatches.',
      'Click the Palette icon on any photo in the Media Bin (or Color Grade This Picture in Clip Inspector) to grade individual pictures with presets, Exposure, Contrast, Temperature, Vignette, and Sync to Timeline Clips.',
      'Switch scope to Master Timeline in Color Plug-in for global film looks with instant Before/After (Compare) toggle.',
    ],
  },
  {
    title: '07. Background HD/4K Export & HJSON Batch CLI',
    goal: 'Render final video in the background with locked 48kHz AV sync, auto-download locally, or automate batches from CLI.',
    actions: [
      'Click Export HD in the top right to pick 720p, 1080p, 4K UHD, Vertical Reels, or Square Social at 23.976–60 fps in MP4, MOV, or WebM.',
      'Start HD Render runs in Python + FFmpeg in the background—preserving every Fusion keyframe, volume envelope, auto-duck curve, and crossfade—and auto-downloads when finished.',
      'Need to batch-render multiple videos automatically? Check autoengine/ in the project root to run declarative .hjson manifests via Python CLI.',
    ],
  },
];

const SHORTCUTS = [
  { key: 'Space', desc: 'Play / Pause live preview' },
  { key: ', / Left Arrow', desc: 'Step back 1 exact frame' },
  { key: '. / Right Arrow', desc: 'Step forward 1 exact frame' },
  { key: 'S', desc: 'Split / razor-cut clip at playhead' },
  { key: 'Ctrl + Z', desc: 'Undo last timeline or grade edit' },
  { key: 'Ctrl + Shift + Z / Y', desc: 'Redo undone edit' },
  { key: 'Delete / Backspace', desc: 'Remove selected clip (ripples if Ripple on)' },
  { key: 'Alt + Drag', desc: 'Pan timeline horizontally & vertically' },
  { key: 'Ctrl + Wheel', desc: 'Zoom timeline ruler in / out' },
];

export const TutorialModal: React.FC<TutorialModalProps> = ({
  isOpen,
  onClose,
  onLoadSamplePack,
  onSwitchMode,
}) => {
  const [stepIdx, setStepIdx] = useState(0);
  if (!isOpen) return null;

  const step = STEPS[stepIdx];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#14171d] border border-[#282e3b] rounded-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-3.5 border-b border-[#232832] flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Obsidian Cut — Quick-Start Walkthrough</h3>
            <p className="text-xs text-slate-400">Step {stepIdx + 1} of {STEPS.length}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tutorial"
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-[#232832] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Navigation Strip */}
        <div className="px-5 py-2.5 bg-[#101318] border-b border-[#232832] flex items-center gap-1.5 overflow-x-auto">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setStepIdx(i)}
              className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                i === stepIdx
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#171b22] text-slate-400 hover:text-slate-100'
              }`}
            >
              Step {i + 1}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-sm">
          <div>
            <h4 className="text-base font-semibold text-white">{step.title}</h4>
            <p className="text-xs text-blue-300 mt-1">{step.goal}</p>
          </div>

          <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
            {step.actions.map((act) => (
              <li key={act} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <span>{act}</span>
              </li>
            ))}
          </ul>

          {stepIdx === 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  onLoadSamplePack();
                  onClose();
                }}
                className="px-3.5 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
              >
                Load Sample Photos + 120 BPM Track Now
              </button>
            </div>
          )}

          {stepIdx === 1 && (
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onSwitchMode('auto');
                  onClose();
                }}
                className="px-3 py-1.5 rounded bg-[#1d222b] hover:bg-[#262d39] border border-[#2c3340] text-xs text-slate-200 cursor-pointer"
              >
                Switch to Auto Sync
              </button>
              <button
                type="button"
                onClick={() => {
                  onSwitchMode('manual');
                  onClose();
                }}
                className="px-3 py-1.5 rounded bg-[#1d222b] hover:bg-[#262d39] border border-[#2c3340] text-xs text-slate-200 cursor-pointer"
              >
                Open Endless Workspace
              </button>
            </div>
          )}

          {/* Keyboard Shortcuts Cheat Sheet */}
          <div className="pt-4 border-t border-[#232832]">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 mb-2.5">
              <Keyboard className="w-3.5 h-3.5 text-blue-400" />
              <span>Keyboard & Mouse Shortcuts</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {SHORTCUTS.map((sc) => (
                <div key={sc.key} className="flex items-center justify-between gap-2 py-1 border-b border-[#1d222b]">
                  <span className="text-slate-400">{sc.desc}</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-[#0d0f12] border border-[#2a303d] text-[10px] text-slate-200 font-mono-tabular whitespace-nowrap shrink-0">
                    {sc.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#232832] bg-[#111419] flex items-center justify-between">
          <button
            type="button"
            disabled={stepIdx === 0}
            onClick={() => setStepIdx((s) => Math.max(0, s - 1))}
            className="px-3 py-1.5 rounded border border-[#2a303d] text-xs text-slate-300 hover:text-white disabled:opacity-40 flex items-center gap-1 cursor-pointer disabled:cursor-default"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Previous</span>
          </button>

          {stepIdx < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStepIdx((s) => Math.min(STEPS.length - 1, s + 1))}
              className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <span>Next Step</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
            >
              Start Editing
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
