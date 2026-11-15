import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const PY_HOST = '127.0.0.1';
const PY_PORT = 3001;

const DATA_DIR = path.resolve(process.cwd(), '.obsidiancut_data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const THUMB_DIR = path.join(DATA_DIR, 'thumbs');
const PROXY_DIR = path.join(DATA_DIR, 'proxies');
const ASSETS_INDEX = path.join(DATA_DIR, 'assets.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(PROXY_DIR, { recursive: true });

interface StoredAsset {
  id: string;
  name: string;
  mediaType: 'image' | 'video' | 'audio';
  size: number;
  width: number;
  height: number;
  duration: number;
  hasAudio?: boolean;
  isVfr?: boolean;
  codec?: string;
  pixFmt?: string;
  sourceFps?: number;
  bpm?: number;
  beats?: number[];
  waveform?: number[];
  filePath: string;
  mimeType: string;
  hasThumb: boolean;
  hasProxy?: boolean;
  colorGrade?: Record<string, unknown>;
}

const assetRegistry = new Map<string, StoredAsset>();

function loadAssetsIndex() {
  try {
    if (fs.existsSync(ASSETS_INDEX)) {
      const raw = JSON.parse(fs.readFileSync(ASSETS_INDEX, 'utf-8')) as StoredAsset[];
      for (const item of raw) {
        if (fs.existsSync(item.filePath)) {
          assetRegistry.set(item.id, item);
        }
      }
    }
  } catch {
    // Ignore corrupted index on startup
  }
}

function saveAssetsIndex() {
  try {
    const list = Array.from(assetRegistry.values());
    fs.writeFileSync(ASSETS_INDEX, JSON.stringify(list, null, 2));
  } catch {
    // Non-fatal
  }
}

loadAssetsIndex();

let pyProc: ChildProcess | null = null;

function resolvePythonCommand(): { cmd: string; prefixArgs: string[] } {
  const custom = process.env.PYTHON_BIN?.trim();
  const candidates: Array<{ cmd: string; prefixArgs: string[] }> = [];
  if (custom) candidates.push({ cmd: custom, prefixArgs: [] });
  if (process.platform === 'win32') {
    candidates.push(
      { cmd: 'python', prefixArgs: [] },
      { cmd: 'py', prefixArgs: ['-3'] },
      { cmd: 'python3', prefixArgs: [] },
    );
  } else {
    candidates.push(
      { cmd: 'python3', prefixArgs: [] },
      { cmd: 'python', prefixArgs: [] },
    );
  }

  for (const cand of candidates) {
    try {
      const probe = spawnSync(cand.cmd, [...cand.prefixArgs, '--version'], {
        stdio: 'pipe',
        timeout: 2500,
        windowsHide: true,
      });
      if (probe.status === 0) {
        const out = `${probe.stdout?.toString() || ''}${probe.stderr?.toString() || ''}`;
        if (/Python 3\./i.test(out)) {
          return cand;
        }
      }
    } catch {
      // Try next candidate
    }
  }
  return process.platform === 'win32'
    ? { cmd: 'python', prefixArgs: [] }
    : { cmd: 'python3', prefixArgs: [] };
}

function startPythonEngine() {
  if (pyProc && !pyProc.killed) return;
  const scriptPath = path.resolve(process.cwd(), 'backend/engine.py');
  const { cmd, prefixArgs } = resolvePythonCommand();
  pyProc = spawn(cmd, [...prefixArgs, scriptPath], {
    env: {
      ...process.env,
      OBSIDIANCUT_DATA_DIR: DATA_DIR,
      PY_ENGINE_HOST: PY_HOST,
      PY_ENGINE_PORT: String(PY_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  pyProc.stdout?.on('data', (chunk) => {
    process.stdout.write(String(chunk));
  });
  pyProc.stderr?.on('data', (chunk) => {
    process.stderr.write(`[py-engine] ${String(chunk)}`);
  });
  pyProc.on('exit', (code) => {
    console.log(`[server] Python engine exited with code ${code}`);
    pyProc = null;
  });
}

async function waitForPythonEngine(maxWaitMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://${PY_HOST}:${PY_PORT}/health`, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(500, () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isValidSafeId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID_RE.test(id);
}

class PythonEngineError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

function callPythonJson<T = Record<string, unknown>>(
  method: string,
  pyPath: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: PY_HOST,
        port: PY_PORT,
        path: pyPath,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          try {
            const parsed = JSON.parse(text || '{}');
            if ((res.statusCode || 500) >= 400) {
              reject(new PythonEngineError(parsed.error || `Python engine error (${res.statusCode})`, res.statusCode || 500));
            } else {
              resolve(parsed as T);
            }
          } catch {
            reject(new PythonEngineError(`Invalid JSON from Python engine: ${text.slice(0, 200)}`, res.statusCode || 502));
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function toPublicAsset(a: StoredAsset) {
  return {
    id: a.id,
    name: a.name,
    mediaType: a.mediaType,
    size: a.size,
    width: a.width,
    height: a.height,
    duration: a.duration,
    hasAudio: a.hasAudio,
    isVfr: a.isVfr,
    codec: a.codec,
    pixFmt: a.pixFmt,
    sourceFps: a.sourceFps,
    bpm: a.bpm,
    beats: a.beats,
    waveform: a.waveform,
    hasProxy: a.hasProxy,
    proxyUrl: a.hasProxy ? `/api/media/proxy/${a.id}` : undefined,
    fileUrl: `/api/media/file/${a.id}`,
    thumbUrl: a.hasThumb ? `/api/media/thumb/${a.id}` : undefined,
    colorGrade: a.colorGrade,
  };
}

function streamFileWithRange(req: Request, res: Response, filePath: string, mime: string) {
  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = Math.max(0, parseInt(parts[0], 10) || 0);
    const rawEnd = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const end = Math.min(stat.size - 1, Number.isFinite(rawEnd) ? rawEnd : stat.size - 1);
    if (start >= stat.size || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mime,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

function guessMime(filePath: string, fallback = 'application/octet-stream'): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    // Images & graphics
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.jpe': 'image/jpeg',
    '.png': 'image/png',
    '.apng': 'image/apng',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.bmp': 'image/bmp',
    '.dib': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.tga': 'image/x-tga',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.jxl': 'image/jxl',
    '.jp2': 'image/jp2',
    '.j2k': 'image/jp2',
    '.psd': 'image/vnd.adobe.photoshop',
    '.exr': 'image/x-exr',
    '.hdr': 'image/vnd.radiance',
    '.dds': 'image/vnd.ms-dds',
    // Video containers
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.flv': 'video/x-flv',
    '.f4v': 'video/x-f4v',
    '.wmv': 'video/x-ms-wmv',
    '.asf': 'video/x-ms-asf',
    '.3gp': 'video/3gpp',
    '.3g2': 'video/3gpp2',
    '.ts': 'video/mp2t',
    '.mts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.vob': 'video/dvd',
    '.ogv': 'video/ogg',
    '.mxf': 'application/mxf',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
    '.m2v': 'video/mpeg',
    '.mpv': 'video/mpeg',
    '.rm': 'application/vnd.rn-realmedia',
    '.rmvb': 'application/vnd.rn-realmedia-vbr',
    '.divx': 'video/divx',
    '.dv': 'video/x-dv',
    // Audio formats
    '.mp3': 'audio/mpeg',
    '.mp2': 'audio/mpeg',
    '.mpa': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.wave': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.m4b': 'audio/mp4',
    '.m4p': 'audio/mp4',
    '.m4r': 'audio/mp4',
    '.aac': 'audio/aac',
    '.adts': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/opus',
    '.spx': 'audio/ogg',
    '.flac': 'audio/flac',
    '.alac': 'audio/alac',
    '.wma': 'audio/x-ms-wma',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
    '.aifc': 'audio/aiff',
    '.caf': 'audio/x-caf',
    '.amr': 'audio/amr',
    '.awb': 'audio/amr-wb',
    '.ac3': 'audio/ac3',
    '.eac3': 'audio/eac3',
    '.dts': 'audio/vnd.dts',
    '.ape': 'audio/x-ape',
    '.wv': 'audio/x-wavpack',
    '.mka': 'audio/x-matroska',
    '.au': 'audio/basic',
    '.snd': 'audio/basic',
  };
  return map[ext] || fallback;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const id = crypto.randomBytes(6).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024, files: 100 },
});

async function bootstrap() {
  startPythonEngine();
  await waitForPythonEngine();

  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      const pyHealth = await callPythonJson('GET', '/health');
      res.json({ ok: true, node: true, python: pyHealth });
    } catch (err) {
      res.status(503).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/api/media', (_req, res) => {
    const list = Array.from(assetRegistry.values()).map(toPublicAsset);
    res.json({ assets: list });
  });

  app.post('/api/media/upload', upload.array('files', 100), async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const created: ReturnType<typeof toPublicAsset>[] = [];
    const rejected: { name: string; reason: string }[] = [];
    for (const file of files) {
      const id = path.basename(file.filename, path.extname(file.filename));
      try {
        const meta = await callPythonJson<Omit<StoredAsset, 'id' | 'name' | 'size' | 'filePath' | 'mimeType'>>(
          'POST',
          '/probe',
          { filePath: file.path, assetId: id },
        );
        const stored: StoredAsset = {
          id,
          name: file.originalname,
          size: file.size,
          filePath: file.path,
          mimeType:
            file.mimetype && file.mimetype !== 'application/octet-stream'
              ? file.mimetype
              : guessMime(file.path),
          mediaType: meta.mediaType,
          width: meta.width || 0,
          height: meta.height || 0,
          duration: meta.duration || 0,
          hasAudio: meta.hasAudio,
          isVfr: meta.isVfr,
          codec: meta.codec,
          pixFmt: meta.pixFmt,
          sourceFps: meta.sourceFps,
          bpm: meta.bpm,
          beats: meta.beats,
          waveform: meta.waveform,
          hasThumb: Boolean(meta.hasThumb),
          hasProxy: Boolean(meta.hasProxy),
        };
        assetRegistry.set(id, stored);
        created.push(toPublicAsset(stored));
      } catch (err) {
        console.error(`Failed probing ${file.originalname}:`, err);
        try {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch {
          // ignore cleanup failure
        }
        rejected.push({
          name: file.originalname,
          reason: (err as Error).message || 'Unsupported or unreadable media stream',
        });
      }
    }
    saveAssetsIndex();
    if (created.length === 0 && rejected.length > 0) {
      res.status(422).json({
        error: `Could not import ${rejected.map((r) => r.name).join(', ')}: ${rejected[0].reason}`,
        assets: [],
        rejected,
      });
      return;
    }
    res.json({ assets: created, rejected });
  });

  app.patch('/api/media/:id/color-grade', (req, res) => {
    if (!isValidSafeId(req.params.id)) {
      res.status(400).json({ error: 'Invalid asset ID' });
      return;
    }
    const asset = assetRegistry.get(req.params.id);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    const grade = req.body?.colorGrade;
    if (grade && typeof grade === 'object') {
      asset.colorGrade = grade as Record<string, unknown>;
    } else {
      delete asset.colorGrade;
    }
    saveAssetsIndex();
    res.json({ asset: toPublicAsset(asset) });
  });

  app.delete('/api/media/:id', (req, res) => {
    if (!isValidSafeId(req.params.id)) {
      res.status(400).json({ error: 'Invalid asset ID' });
      return;
    }
    const asset = assetRegistry.get(req.params.id);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    try {
      if (fs.existsSync(asset.filePath)) fs.unlinkSync(asset.filePath);
      const thumbPath = path.join(THUMB_DIR, `${asset.id}.jpg`);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      for (const suffix of ['_proxy.jpg', '_proxy.png', '_proxy.mp4', '_proxy.m4a']) {
        const p = path.join(PROXY_DIR, `${asset.id}${suffix}`);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch {
      // ignore cleanup error
    }
    assetRegistry.delete(req.params.id);
    saveAssetsIndex();
    res.json({ deleted: req.params.id });
  });

  app.post('/api/sample-pack', async (_req, res) => {
    try {
      const imgDir = path.resolve(process.cwd(), 'src/assets/images');
      const sampleDefs = [
        { prefix: 'sample_alpine_dawn_', label: '01_Alpine_Dawn.jpg' },
        { prefix: 'sample_coastal_highway_', label: '02_Coastal_Highway.jpg' },
        { prefix: 'sample_tokyo_rain_', label: '03_Tokyo_Twilight.jpg' },
        { prefix: 'sample_desert_dunes_', label: '04_Desert_Dunes.jpg' },
      ];

      const existingFiles = fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : [];
      const created: ReturnType<typeof toPublicAsset>[] = [];

      for (const def of sampleDefs) {
        const match = existingFiles.find((f) => f.startsWith(def.prefix) && f.endsWith('.jpg'));
        if (!match) continue;
        const srcFile = path.join(imgDir, match);
        const id = `smp_${crypto.randomBytes(4).toString('hex')}`;
        const destFile = path.join(UPLOAD_DIR, `${id}.jpg`);
        fs.copyFileSync(srcFile, destFile);
        const stat = fs.statSync(destFile);
        const meta = await callPythonJson<Omit<StoredAsset, 'id' | 'name' | 'size' | 'filePath' | 'mimeType'>>(
          'POST',
          '/probe',
          { filePath: destFile, assetId: id },
        );
        const stored: StoredAsset = {
          id,
          name: def.label,
          size: stat.size,
          filePath: destFile,
          mimeType: 'image/jpeg',
          mediaType: 'image',
          width: meta.width || 1280,
          height: meta.height || 720,
          duration: 0,
          codec: meta.codec,
          hasThumb: Boolean(meta.hasThumb),
          hasProxy: Boolean(meta.hasProxy),
        };
        assetRegistry.set(id, stored);
        created.push(toPublicAsset(stored));
      }

      // Generate real 120 BPM WAV audio track via Python engine
      const audioId = `smp_aud_${crypto.randomBytes(4).toString('hex')}`;
      const audioMeta = await callPythonJson<{
        assetId: string;
        filePath: string;
        duration: number;
        bpm: number;
        beats: number[];
        waveform: number[];
      }>('POST', '/generate-sample-audio', { assetId: audioId });

      const audioStat = fs.statSync(audioMeta.filePath);
      const audioStored: StoredAsset = {
        id: audioId,
        name: 'Pulse_120BPM_Synth.wav',
        size: audioStat.size,
        filePath: audioMeta.filePath,
        mimeType: 'audio/wav',
        mediaType: 'audio',
        width: 0,
        height: 0,
        duration: audioMeta.duration,
        hasAudio: true,
        bpm: audioMeta.bpm,
        beats: audioMeta.beats,
        waveform: audioMeta.waveform,
        hasThumb: false,
      };
      assetRegistry.set(audioId, audioStored);
      created.push(toPublicAsset(audioStored));

      saveAssetsIndex();
      res.json({ assets: created });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/media/thumb/:id', (req, res) => {
    if (!isValidSafeId(req.params.id)) {
      res.status(400).json({ error: 'Invalid asset ID' });
      return;
    }
    const thumbPath = path.join(THUMB_DIR, `${req.params.id}.jpg`);
    if (!fs.existsSync(thumbPath)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(thumbPath).pipe(res);
  });

  app.get('/api/media/proxy/:id', (req, res) => {
    if (!isValidSafeId(req.params.id)) {
      res.status(400).json({ error: 'Invalid asset ID' });
      return;
    }
    const proxyMp4 = path.join(PROXY_DIR, `${req.params.id}_proxy.mp4`);
    const proxyPng = path.join(PROXY_DIR, `${req.params.id}_proxy.png`);
    const proxyJpg = path.join(PROXY_DIR, `${req.params.id}_proxy.jpg`);
    const proxyM4a = path.join(PROXY_DIR, `${req.params.id}_proxy.m4a`);
    if (fs.existsSync(proxyMp4)) {
      streamFileWithRange(req, res, proxyMp4, 'video/mp4');
      return;
    }
    if (fs.existsSync(proxyPng)) {
      streamFileWithRange(req, res, proxyPng, 'image/png');
      return;
    }
    if (fs.existsSync(proxyJpg)) {
      streamFileWithRange(req, res, proxyJpg, 'image/jpeg');
      return;
    }
    if (fs.existsSync(proxyM4a)) {
      streamFileWithRange(req, res, proxyM4a, 'audio/mp4');
      return;
    }
    const asset = assetRegistry.get(req.params.id);
    if (!asset || !fs.existsSync(asset.filePath)) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }
    streamFileWithRange(req, res, asset.filePath, asset.mimeType || guessMime(asset.filePath));
  });

  app.get('/api/media/file/:id', (req, res) => {
    if (!isValidSafeId(req.params.id)) {
      res.status(400).json({ error: 'Invalid asset ID' });
      return;
    }
    const asset = assetRegistry.get(req.params.id);
    if (!asset || !fs.existsSync(asset.filePath)) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }
    streamFileWithRange(req, res, asset.filePath, asset.mimeType || guessMime(asset.filePath));
  });

  app.post('/api/audio/analyze', async (req, res) => {
    const assetId = req.body?.assetId;
    if (!isValidSafeId(assetId)) {
      res.status(400).json({ error: 'Missing or invalid assetId' });
      return;
    }
    try {
      const result = await callPythonJson('POST', '/analyze-audio', { assetId });
      const asset = assetRegistry.get(assetId);
      if (asset) {
        Object.assign(asset, result);
        saveAssetsIndex();
      }
      res.json(result);
    } catch (err) {
      const code = err instanceof PythonEngineError ? err.statusCode : 500;
      res.status(code).json({ error: (err as Error).message });
    }
  });

  app.post('/api/render', async (req, res) => {
    const hasClips = Array.isArray(req.body?.clips) && req.body.clips.length > 0;
    const hasSlides = Array.isArray(req.body?.slides) && req.body.slides.length > 0;
    if (!hasClips && !hasSlides) {
      res.status(400).json({ error: 'Render payload must include a non-empty clips array' });
      return;
    }
    try {
      const result = await callPythonJson('POST', '/render', req.body);
      res.status(202).json(result);
    } catch (err) {
      const code = err instanceof PythonEngineError ? err.statusCode : 500;
      res.status(code).json({ error: (err as Error).message });
    }
  });

  app.get('/api/render/:jobId', async (req, res) => {
    if (!isValidSafeId(req.params.jobId)) {
      res.status(400).json({ error: 'Invalid render job ID' });
      return;
    }
    try {
      const result = await callPythonJson('GET', `/render/${encodeURIComponent(req.params.jobId)}`);
      res.json(result);
    } catch (err) {
      const code = err instanceof PythonEngineError ? err.statusCode : 404;
      res.status(code).json({ error: (err as Error).message });
    }
  });

  app.get('/api/render/:jobId/download', (req, res) => {
    if (!isValidSafeId(req.params.jobId)) {
      res.status(400).json({ error: 'Invalid render job ID' });
      return;
    }
    const inline = req.query.inline === '1' ? '?inline=1' : '';
    const pyReq = http.request(
      {
        hostname: PY_HOST,
        port: PY_PORT,
        path: `/render/${encodeURIComponent(req.params.jobId)}/download${inline}`,
        method: 'GET',
        headers: req.headers.range ? { Range: req.headers.range } : undefined,
      },
      (pyRes) => {
        res.writeHead(pyRes.statusCode || 200, pyRes.headers);
        pyRes.pipe(res);
      },
    );
    pyReq.on('error', (err) => {
      if (!res.headersSent) res.status(502).json({ error: err.message });
    });
    pyReq.end();
  });

  const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Obsidian Cut] Studio server ready at http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    if (pyProc && !pyProc.killed) pyProc.kill('SIGTERM');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (process.platform === 'win32') {
    process.on('SIGBREAK', shutdown);
  }
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
