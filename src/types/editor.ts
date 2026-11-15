export type MediaType = 'image' | 'video' | 'audio';

export interface MediaAsset {
  id: string;
  name: string;
  mediaType: MediaType;
  size: number;
  width: number;
  height: number;
  duration: number;
  hasAudio?: boolean;
  isVfr?: boolean;
  codec?: string;
  pixFmt?: string;
  sourceFps?: number;
  hasProxy?: boolean;
  proxyUrl?: string;
  bpm?: number;
  beats?: number[];
  waveform?: number[];
  fileUrl: string;
  thumbUrl?: string;
  colorGrade?: ColorGradeConfig;
}

export type TransitionType =
  | 'cut'
  | 'fade'
  | 'dissolve'
  | 'wipe'
  | 'wipeleft'
  | 'wiperight'
  | 'wipeup'
  | 'wipedown'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown'
  | 'circleopen'
  | 'circleclose'
  | 'pixelize'
  | 'radial'
  | 'smoothleft'
  | 'smoothright'
  | 'smoothup'
  | 'smoothdown'
  | 'fadeblack'
  | 'fadewhite'
  | 'fadegrays'
  | 'diagtl'
  | 'diagtr'
  | 'squeezeh'
  | 'squeezev'
  | 'vertopen'
  | 'horzopen'
  | 'hblur';

export interface ClipTransitionMetadata {
  type: TransitionType;
  duration: number;
  targetClipId: string | null;
  overlapSec: number;
  ffmpegFilter: string;
}

export type MotionType = 'none' | 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight';

export type TitleTemplateId =
  | 'main_title'
  | 'lower_third'
  | 'subtitle'
  | 'vector_badge'
  | 'scrolling_credits';

export type TitleFontFamily =
  | 'Outfit'
  | 'Public Sans'
  | 'Montserrat'
  | 'Bebas Neue'
  | 'Oswald'
  | 'Playfair Display'
  | 'Lora'
  | 'Georgia'
  | 'Arial'
  | 'JetBrains Mono'
  | 'Courier New';

export const TITLE_FONT_OPTIONS: {
  value: TitleFontFamily;
  label: string;
  category: 'Sans' | 'Display' | 'Serif' | 'Mono';
  fallback: 'sans-serif' | 'serif' | 'monospace';
}[] = [
  { value: 'Outfit', label: 'Outfit (Modern Sans)', category: 'Sans', fallback: 'sans-serif' },
  { value: 'Public Sans', label: 'Public Sans (Clean UI)', category: 'Sans', fallback: 'sans-serif' },
  { value: 'Montserrat', label: 'Montserrat (Geometric)', category: 'Sans', fallback: 'sans-serif' },
  { value: 'Arial', label: 'Arial (Classic Sans)', category: 'Sans', fallback: 'sans-serif' },
  { value: 'Bebas Neue', label: 'Bebas Neue (Cinema Poster)', category: 'Display', fallback: 'sans-serif' },
  { value: 'Oswald', label: 'Oswald (Condensed)', category: 'Display', fallback: 'sans-serif' },
  { value: 'Playfair Display', label: 'Playfair Display (Editorial Serif)', category: 'Serif', fallback: 'serif' },
  { value: 'Lora', label: 'Lora (Warm Serif)', category: 'Serif', fallback: 'serif' },
  { value: 'Georgia', label: 'Georgia (Classic Serif)', category: 'Serif', fallback: 'serif' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono (Technical)', category: 'Mono', fallback: 'monospace' },
  { value: 'Courier New', label: 'Courier New (Typewriter)', category: 'Mono', fallback: 'monospace' },
];

export interface TitleSpec {
  template: TitleTemplateId;
  heading: string;
  subheading: string;
  bodyText: string;
  textColor: string;
  accentColor: string;
  bgColor: string; // 'transparent' or hex
  fontFamily: TitleFontFamily | string;
  fontSize: number; // 0.6 to 2.0
  align: 'left' | 'center' | 'right';
}

export interface ClipEffects {
  brightness: number;          // -0.5 to 0.5
  contrast: number;            // 0.5 to 2.0
  gamma: number;               // 0.5 to 2.0
  hue: number;                 // -180 to 180
  saturation: number;          // 0.0 to 2.0
  greyscale: boolean;
  chromaKeyEnabled: boolean;
  chromaKeyColor: string;      // '#00ff00'
  chromaKeySimilarity: number; // 0.05 to 0.5
  chromaKeyBlend: number;      // 0.0 to 0.3
}

export interface VstPluginSlot {
  id: string;
  name: string;
  category: 'Dynamics' | 'EQ' | 'Spatial' | 'Voice' | 'External VST3';
  bypassed: boolean;
  mix: number;       // 0..1
  drive?: number;    // 0..1
  thresholdDb?: number;
}

export interface TrackAudioDsp {
  eqLowDb: number;          // -12..12
  eqMidDb: number;          // -12..12
  eqHighDb: number;         // -12..12
  compressorEnabled: boolean;
  limiterEnabled: boolean;
  reverbMix: number;        // 0..0.8
  normalizeEnabled?: boolean;
  normalizeTargetLufs?: number; // -23 | -16 | -14
  vstSlots: VstPluginSlot[];
}

export type TrackLayerRole = 'video' | 'overlay' | 'audio';

export interface TimelineTrack {
  id: string;
  name: string;
  kind: 'video' | 'audio';
  layerRole?: TrackLayerRole;
  muted: boolean;
  solo: boolean;
  hidden: boolean;
  locked?: boolean;
  volume: number;
  isFolder?: boolean;
  parentFolderId?: string;
  collapsed?: boolean;
  audioDsp?: TrackAudioDsp;
}

export interface ClipCrop {
  top: number;    // 0..0.9
  right: number;  // 0..0.9
  bottom: number; // 0..0.9
  left: number;   // 0..0.9
}

export type AudioFadeCurve = 'linear' | 'scurve' | 'exp' | 'log';
export type AudioTransitionType = 'cut' | 'crossfade_eq' | 'crossfade_lin' | 'crossfade_exp' | 'dip_swell';

export interface AudioVolumePoint {
  id: string;
  time: number;  // normalized 0..1 of clip duration
  gain: number;  // multiplier 0..2.0 (1 = 100%)
}

export type KeyframeProperty = 'opacity' | 'scale' | 'x' | 'y' | 'rotation';
export type KeyframeEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface KeyframePoint {
  id: string;
  time: number; // normalized clip progress 0..1
  value: number;
  easing: KeyframeEasing;
}

export type ClipKeyframesMap = Partial<Record<KeyframeProperty, KeyframePoint[]>>;

export interface TimelineClip {
  id: string;
  trackId: string;
  kind: 'image' | 'video' | 'title' | 'audio';
  mediaId?: string;
  name: string;
  startTime: number;
  duration: number;
  trimStart: number;
  maxSourceDuration?: number;
  hasAudio?: boolean;
  muted: boolean;

  // Transform, resize, crop & compositing
  fit: 'cover' | 'contain';
  scale: number;
  scaleX?: number;  // independent width multiplier (default 1)
  scaleY?: number;  // independent height multiplier (default 1)
  crop?: ClipCrop;  // normalized edge crop fractions (0..0.9)
  x: number;        // % offset (-100..100)
  y: number;        // % offset (-100..100)
  rotation: number; // degrees (-180..180)
  opacity: number;  // 0..1
  motion: MotionType;
  keyframes?: ClipKeyframesMap;

  // Transitions & fades
  transitionOut: TransitionType;
  transitionDuration: number;
  transition?: ClipTransitionMetadata;
  fadeIn: number;
  fadeOut: number;

  // Time-mapping
  speed: number;    // 0.25..4.0
  reverse: boolean;

  // Audio mixing & music layer controls
  volume: number;   // 0..2.0
  pan: number;      // -1..1
  audioFadeCurve?: AudioFadeCurve;
  audioTransitionOut?: AudioTransitionType;
  audioTransitionDuration?: number;
  audioCrossfadeCurve?: AudioFadeCurve;
  volumeEnvelope?: AudioVolumePoint[];
  backgroundDucking?: boolean;
  duckLevel?: number; // 0.1..0.8 (default 0.28)
  bpm?: number;
  beats?: number[];
  waveform?: number[];

  // Per-clip digital video effects & individual picture color grading
  effects: ClipEffects;
  colorGrade?: ColorGradeConfig;

  // Fusion VFX & Rotoscoping metadata
  fusion?: FusionVfxSpec;

  // Vector title / credits data
  title?: TitleSpec;
  renderedOverlayPng?: string;
  renderedOverlayHeight?: number;
}

export type ParticlePresetId = 'none' | 'embers' | 'snow' | 'stardust' | 'sparks';
export type KrokodoveEffectId = 'none' | 'kaleido_array' | 'hud_rings' | 'glitch_slice' | 'extrude_grid';

export interface RotoscopePoint {
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
}

export interface FusionVfxSpec {
  enabled: boolean;
  particlePreset: ParticlePresetId;
  particleDensity: number; // 10..120
  particleColor: string;
  krokodoveEffect: KrokodoveEffectId;
  krokodoveIntensity: number; // 0..1
  rotoscopeEnabled: boolean;
  rotoscopeInvert: boolean;
  rotoscopeFeather: number; // 0..40 px
  rotoscopePoints: RotoscopePoint[];
  glowAmount: number; // 0..1
  trackOffsetX: number; // % offset from planar tracker
  trackOffsetY: number;
}

export type TrimMode = 'pointer' | 'ripple' | 'roll' | 'slip' | 'slide';

export interface NestedSequence {
  id: string;
  name: string;
  createdAt: string;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
}

export interface PowerBin {
  id: string;
  name: string;
  assetIds: string[];
}

export interface SmartBinRule {
  id: string;
  name: string;
  mediaType?: MediaType | 'all';
  minBpm?: number;
  onlyVfr?: boolean;
  onlyGraded?: boolean;
  minWidth?: number;
}

export type ColorPreset =
  | 'none'
  | 'cinematic_teal'
  | 'kodak_warm'
  | 'mono_noir'
  | 'matte_fade'
  | 'vivid_hdr';

export interface ColorGradeConfig {
  enabled: boolean;
  preset: ColorPreset;
  exposure: number;
  contrast: number;
  saturation: number;
  gamma: number;
  temperature: number;
  tint: number;
  vignette: number;
}

export type ExportFps = 23.976 | 24 | 29.97 | 30 | 59.94 | 60;

export interface ExportConfig {
  resolution: '1280x720' | '1920x1080' | '3840x2160' | '1080x1920' | '1080x1080';
  fps: ExportFps;
  format: 'mp4' | 'webm' | 'mov';
  speedProfile: 'ultrafast' | 'veryfast' | 'medium';
  autoDownload: boolean;
  normalizeAudio?: boolean;
  normalizeTargetLufs?: number;
}

export interface RenderJobStatus {
  jobId: string;
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  progress: number;
  speed?: string;
  elapsedMs?: number;
  outputName?: string;
  outputSize?: number;
  format?: string;
  error?: string;
}

export interface SandboxedPluginStatus {
  id: string;
  name: string;
  faulted: boolean;
  lastError?: string;
}

export const TRANSITION_GROUPS = [
  'Core',
  'Fade Variants',
  'Wipe & Slide',
  'Geometric & Stylized',
  'Lens & Blur',
] as const;

export const TRANSITION_OPTIONS: {
  value: TransitionType;
  label: string;
  group: (typeof TRANSITION_GROUPS)[number];
  description: string;
}[] = [
  { value: 'fade', label: 'Fade', group: 'Core', description: 'Balanced cross-luminance blend' },
  { value: 'dissolve', label: 'Dissolve', group: 'Core', description: 'Smooth optical film dissolve' },
  { value: 'wipe', label: 'Wipe', group: 'Core', description: 'Clean directional edge reveal' },
  { value: 'cut', label: 'None (Hard Cut)', group: 'Core', description: 'Instant frame-accurate cut' },
  { value: 'fadeblack', label: 'Dip to Black', group: 'Fade Variants', description: 'Dramatic dip through black' },
  { value: 'fadewhite', label: 'Dip to White', group: 'Fade Variants', description: 'Flash exposure dip to white' },
  { value: 'fadegrays', label: 'Fade Through Grayscale', group: 'Fade Variants', description: 'Desaturated tonal crossfade' },
  { value: 'wipeleft', label: 'Wipe Left', group: 'Wipe & Slide', description: 'Reveal incoming clip from right' },
  { value: 'wiperight', label: 'Wipe Right', group: 'Wipe & Slide', description: 'Reveal incoming clip from left' },
  { value: 'wipeup', label: 'Wipe Up', group: 'Wipe & Slide', description: 'Vertical upward edge reveal' },
  { value: 'wipedown', label: 'Wipe Down', group: 'Wipe & Slide', description: 'Vertical downward edge reveal' },
  { value: 'diagtl', label: 'Diagonal Wipe TL', group: 'Wipe & Slide', description: 'Angled top-left corner sweep' },
  { value: 'diagtr', label: 'Diagonal Wipe TR', group: 'Wipe & Slide', description: 'Angled top-right corner sweep' },
  { value: 'slideleft', label: 'Slide Left', group: 'Wipe & Slide', description: 'Linear leftward frame slide' },
  { value: 'slideright', label: 'Slide Right', group: 'Wipe & Slide', description: 'Linear rightward frame slide' },
  { value: 'slideup', label: 'Slide Up', group: 'Wipe & Slide', description: 'Vertical upward frame slide' },
  { value: 'slidedown', label: 'Slide Down', group: 'Wipe & Slide', description: 'Vertical downward frame slide' },
  { value: 'smoothleft', label: 'Smooth Push Left', group: 'Wipe & Slide', description: 'Eased camera whip push left' },
  { value: 'smoothright', label: 'Smooth Push Right', group: 'Wipe & Slide', description: 'Eased camera whip push right' },
  { value: 'smoothup', label: 'Smooth Push Up', group: 'Wipe & Slide', description: 'Eased vertical push upward' },
  { value: 'smoothdown', label: 'Smooth Push Down', group: 'Wipe & Slide', description: 'Eased vertical push downward' },
  { value: 'circleopen', label: 'Iris Open', group: 'Geometric & Stylized', description: 'Expanding circular iris aperture' },
  { value: 'circleclose', label: 'Iris Close', group: 'Geometric & Stylized', description: 'Closing circular iris aperture' },
  { value: 'vertopen', label: 'Barn Door Vertical', group: 'Geometric & Stylized', description: 'Center vertical curtain split' },
  { value: 'horzopen', label: 'Barn Door Horizontal', group: 'Geometric & Stylized', description: 'Center horizontal shutter split' },
  { value: 'radial', label: 'Radial Clock Sweep', group: 'Geometric & Stylized', description: '360° clockwise radial reveal' },
  { value: 'squeezeh', label: 'Squeeze Horizontal', group: 'Lens & Blur', description: 'Anamorphic horizontal squeeze' },
  { value: 'squeezev', label: 'Squeeze Vertical', group: 'Lens & Blur', description: 'Vertical frame compression' },
  { value: 'pixelize', label: 'Pixelize Mosaic', group: 'Lens & Blur', description: 'Digital mosaic block dissolve' },
  { value: 'hblur', label: 'Horizontal Blur Dissolve', group: 'Lens & Blur', description: 'Motion-streaked optical blur cross' },
];

export const DEFAULT_TRACK_AUDIO_DSP: TrackAudioDsp = {
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
  compressorEnabled: false,
  limiterEnabled: true,
  reverbMix: 0,
  normalizeEnabled: false,
  normalizeTargetLufs: -16,
  vstSlots: [],
};

export const DEFAULT_FUSION_VFX: FusionVfxSpec = {
  enabled: false,
  particlePreset: 'none',
  particleDensity: 45,
  particleColor: '#60a5fa',
  krokodoveEffect: 'none',
  krokodoveIntensity: 0.6,
  rotoscopeEnabled: false,
  rotoscopeInvert: false,
  rotoscopeFeather: 8,
  rotoscopePoints: [],
  glowAmount: 0,
  trackOffsetX: 0,
  trackOffsetY: 0,
};

export const DEFAULT_CLIP_EFFECTS: ClipEffects = {
  brightness: 0,
  contrast: 1,
  gamma: 1,
  hue: 0,
  saturation: 1,
  greyscale: false,
  chromaKeyEnabled: false,
  chromaKeyColor: '#00ff00',
  chromaKeySimilarity: 0.18,
  chromaKeyBlend: 0.08,
};

export const DEFAULT_COLOR_GRADE: ColorGradeConfig = {
  enabled: false,
  preset: 'none',
  exposure: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  temperature: 0,
  tint: 0,
  vignette: 0,
};

export const SUPPORTED_FORMAT_GROUPS = {
  images: [
    '.jpg', '.jpeg', '.jpe', '.png', '.apng', '.webp', '.gif', '.avif',
    '.heic', '.heif', '.bmp', '.dib', '.tiff', '.tif', '.tga', '.svg',
    '.ico', '.jxl', '.jp2', '.j2k', '.psd', '.exr', '.hdr', '.dds',
    '.ppm', '.pgm', '.pbm', '.pnm', '.pam', '.pcx', '.qoi',
  ],
  videos: [
    '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.flv', '.f4v',
    '.wmv', '.asf', '.3gp', '.3g2', '.ts', '.mts', '.m2ts', '.vob',
    '.ogv', '.mxf', '.mpg', '.mpeg', '.m2v', '.mpv', '.rm', '.rmvb',
    '.divx', '.dv', '.nut', '.wtv',
  ],
  audio: [
    '.mp3', '.mp2', '.mpa', '.wav', '.wave', '.flac', '.aac', '.adts',
    '.m4a', '.m4b', '.m4p', '.m4r', '.ogg', '.oga', '.opus', '.spx',
    '.wma', '.aiff', '.aif', '.aifc', '.alac', '.ape', '.wv', '.tta',
    '.ac3', '.eac3', '.dts', '.amr', '.awb', '.caf', '.mka', '.mpc',
    '.au', '.snd', '.3ga', '.ra',
  ],
} as const;

export const ACCEPTED_MEDIA_ACCEPT = [
  'image/*',
  'video/*',
  'audio/*',
  ...SUPPORTED_FORMAT_GROUPS.images,
  ...SUPPORTED_FORMAT_GROUPS.videos,
  ...SUPPORTED_FORMAT_GROUPS.audio,
].join(',');
