import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enumerateWallpaperSources } from './wallpaper-engine.mjs';
import { makeManagerInjectionScript, makeManagerRemovalScript } from './manager-renderer.mjs';

const DEFAULT_CDP_PORT = Number(process.env.CODEX_SKIN_CDP_PORT || 9222);
const LAYER_ID = 'codex-wallpaper-engine-skin';
const execFileAsync = promisify(execFile);
const DEFAULT_STATE_FILE = process.env.CODEX_WALLPAPER_STATE_FILE || join(process.env.LOCALAPPDATA || tmpdir(), 'CodexWallpaperManager', 'state.json');

export function readSavedSkinState(file = DEFAULT_STATE_FILE) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 500) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeSavedSkinState(value, file = DEFAULT_STATE_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(partial, file);
}

export function clearSavedSkinState(file = DEFAULT_STATE_FILE) {
  rmSync(file, { force: true });
}

const MIME = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

function mimeFor(file) {
  return MIME[extname(file).toLowerCase()] || 'application/octet-stream';
}

export function isPathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function inlineMedia(file, maxBytes) {
  if (!file || !existsSync(file)) throw new Error('The selected project media is missing.');
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Media is too large to embed safely (${stat.size} bytes).`);
  return `data:${mimeFor(file)};base64,${readFileSync(file).toString('base64')}`;
}

async function transcodeVideoForCodex(file) {
  const source = statSync(file);
  const minimumBytes = Math.max(1, Number(process.env.CODEX_SKIN_COMPRESS_MIN_MB || 48)) * 1024 * 1024;
  if (process.env.CODEX_SKIN_DISABLE_COMPRESSION === '1' || source.size < minimumBytes) return null;
  const cacheRoot = join(process.env.LOCALAPPDATA || tmpdir(), 'CodexWallpaperManager', 'transcoded');
  mkdirSync(cacheRoot, { recursive: true });
  const settings = { maxWidth: 2560, maxHeight: 1440, bitrateKbps: 10000, frameRate: 30, preserveAudio: true, cacheVersion: 2 };
  const key = createHash('sha256')
    .update(`${resolve(file)}\n${source.size}\n${source.mtimeMs}\n${JSON.stringify(settings)}`)
    .digest('hex').slice(0, 24);
  const output = join(cacheRoot, `${key}.mp4`);
  const metadataFile = join(cacheRoot, `${key}.json`);
  if (existsSync(output) && statSync(output).size > 0 && existsSync(metadataFile)) {
    return { filePath: output, ...JSON.parse(readFileSync(metadataFile, 'utf8')), cached: true };
  }
  const partial = join(cacheRoot, `${key}.${process.pid}.partial.mp4`);
  const script = fileURLToPath(new URL('../scripts/transcode-video.ps1', import.meta.url));
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-InputPath', file, '-OutputPath', partial,
      '-MaxWidth', String(settings.maxWidth), '-MaxHeight', String(settings.maxHeight),
      '-VideoBitrateKbps', String(settings.bitrateKbps), '-MaxFrameRate', String(settings.frameRate),
    ], { encoding: 'utf8', windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
    const metadata = JSON.parse(stdout.trim());
    if (!existsSync(partial) || statSync(partial).size < 1024) throw new Error('The compressed video output is empty.');
    renameSync(partial, output);
    const result = {
      originalBytes: source.size,
      outputBytes: statSync(output).size,
      sourceResolution: `${metadata.sourceWidth}x${metadata.sourceHeight}`,
      renderResolution: `${metadata.outputWidth}x${metadata.outputHeight}`,
      frameRate: metadata.frameRate,
      bitrateKbps: metadata.bitrateKbps,
    };
    writeFileSync(metadataFile, JSON.stringify(result));
    return { filePath: output, ...result, cached: false };
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
}

export async function selectEmbeddableMedia(project) {
  if (project.type === 'image' && project.skinMode === 'image' && project.filePath && existsSync(project.filePath)) {
    return { mediaUrl: inlineMedia(project.filePath, 24 * 1024 * 1024), mode: 'image', fallback: false, fallbackKind: null };
  }
  const maxVideoBytes = Math.max(1, Number(process.env.CODEX_SKIN_INLINE_VIDEO_MAX_MB || 24)) * 1024 * 1024;
  const maxBlobVideoBytes = Math.max(32, Number(process.env.CODEX_SKIN_BLOB_VIDEO_MAX_MB || 512)) * 1024 * 1024;
  const isVideo = project.type === 'video' && project.skinMode === 'video' && /\.(mp4|webm|mkv|avi|mov)$/i.test(project.filePath);
  if (isVideo && existsSync(project.filePath) && statSync(project.filePath).size <= maxVideoBytes) {
    return { mediaUrl: inlineMedia(project.filePath, maxVideoBytes), mode: 'video', fallback: false, fallbackKind: null };
  }
  let compressed = null;
  if (isVideo && existsSync(project.filePath)) {
    try { compressed = await transcodeVideoForCodex(project.filePath); } catch { /* use the original video */ }
  }
  const blobVideoPath = compressed?.filePath || project.filePath;
  if (isVideo && process.env.CODEX_SKIN_DISABLE_BLOB_VIDEO !== '1'
      && existsSync(blobVideoPath) && statSync(blobVideoPath).size <= maxBlobVideoBytes) {
    const poster = project.previewPath ? inlineMedia(project.previewPath, 24 * 1024 * 1024) : null;
    return {
      mediaUrl: poster, mode: 'video-blob', fallback: false, fallbackKind: null,
      videoPath: blobVideoPath, videoBytes: statSync(blobVideoPath).size,
      compressed: Boolean(compressed), originalBytes: compressed?.originalBytes || null,
      compressionRatio: compressed ? compressed.outputBytes / compressed.originalBytes : null,
      sourceResolution: compressed?.sourceResolution || null,
      renderResolution: compressed?.renderResolution || null,
      frameRate: compressed?.frameRate || null,
      bitrateKbps: compressed?.bitrateKbps || null,
      compressionCached: compressed?.cached || false,
    };
  }
  if (project.previewPath) {
    return { mediaUrl: inlineMedia(project.previewPath, 24 * 1024 * 1024), mode: 'preview', fallback: true, fallbackKind: 'project-preview' };
  }
  throw new Error('Codex blocks local media URLs and this project has no embeddable preview image.');
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.scriptId = null;
    this.onEvent = null;
  }

  async connect() {
    if (typeof WebSocket !== 'function') throw new Error('Node.js 22 or newer is required for the skin bridge.');
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to the Codex debug target.')), 5000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolvePromise(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to the Codex debug target.')); }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.method) {
        try { this.onEvent?.(message); } catch { /* isolate event handlers from CDP calls */ }
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve: done, reject, timeout } = this.pending.get(message.id);
      clearTimeout(timeout);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else done(message.result || {});
    });
    this.socket.addEventListener('close', () => {
      for (const { reject, timeout } of this.pending.values()) { clearTimeout(timeout);reject(new Error('Codex debug target disconnected.')); }
      this.pending.clear();
    });
  }

  call(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Codex debug target is not connected.');
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);reject(new Error('Codex renderer did not respond to ' + method + ' within 30 seconds.'));
      }, 30000);
      timeout.unref?.();
      this.pending.set(id, { resolve: resolvePromise, reject, timeout });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timeout);this.pending.delete(id);reject(error); }
    });
  }

  close() {
    try { this.socket?.close(); } catch { /* ignore */ }
  }
}

export function makeInjectionScript(config) {
  return makeManagerInjectionScript(config);
}

const REMOVE_SCRIPT = makeManagerRemovalScript();

async function discoverTargets(port = DEFAULT_CDP_PORT) {
  const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`Codex debug endpoint returned HTTP ${response.status}.`);
  const targets = await response.json();
  return targets.filter(isCodexTarget);
}

export function isCodexTarget(target) {
  return target?.type === 'page'
    && Boolean(target.webSocketDebuggerUrl)
    && target.url === 'app://-/index.html';
}

export function buildNativeThemeString({ variant = 'dark', accent = '#339CFF', surface = '#181818', ink = '#FFFFFF', contrast = 60, codeThemeId = 'codex', uiFont = null, codeFont = null, translucent = true }) {
  const hex = /^#[0-9A-Fa-f]{6}$/;
  for (const [name, value] of Object.entries({ accent, surface, ink })) {
    if (!hex.test(value)) throw new Error(`${name} must be a six-digit hex color.`);
  }
  if (!['light', 'dark'].includes(variant)) throw new Error('variant must be light or dark.');
  const payload = {
    codeThemeId,
    theme: {
      accent,
      contrast: Math.max(0, Math.min(100, Math.round(contrast))),
      fonts: { code: codeFont || null, ui: uiFont || null },
      ink,
      opaqueWindows: !translucent,
      semanticColors: { diffAdded: '#40C977', diffRemoved: '#FA423E', skill: '#AD7BF9' },
      surface,
    },
    variant,
  };
  return `codex-theme-v1:${JSON.stringify(payload)}`;
}


const clamp = (value, minimum, maximum, fallback) => Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
const DEFAULT_SETTINGS = Object.freeze({
  panelOpacity: 0, scrimOpacity: 0, blurPx: 0, muted: true, volume: 0.5,
  bubbleBlurPx: 18, bubbleOpacity: 0.34,
  fitMode: 'cover', zoom: 100, positionX: 50, positionY: 50, showControls: true, enabled: true,
});
const PROFILE_KEYS = ['panelOpacity', 'scrimOpacity', 'blurPx', 'bubbleBlurPx', 'bubbleOpacity', 'muted', 'volume', 'fitMode', 'zoom', 'positionX', 'positionY', 'showControls'];
const COMMON_KEYS = ['panelOpacity', 'scrimOpacity', 'blurPx', 'bubbleBlurPx', 'bubbleOpacity', 'muted', 'volume', 'showControls', 'enabled'];
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object && object[key] !== undefined).map(key => [key, object[key]]));

export function normalizeSkinSettings(value = {}, base = DEFAULT_SETTINGS) {
  const source = { ...DEFAULT_SETTINGS, ...base, ...Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) };
  return {
    panelOpacity: clamp(source.panelOpacity, 0, 1, DEFAULT_SETTINGS.panelOpacity),
    scrimOpacity: clamp(source.scrimOpacity, 0, 0.8, DEFAULT_SETTINGS.scrimOpacity),
    blurPx: Math.round(clamp(source.blurPx, 0, 40, DEFAULT_SETTINGS.blurPx)),
    bubbleBlurPx: Math.round(clamp(source.bubbleBlurPx, 0, 40, DEFAULT_SETTINGS.bubbleBlurPx)),
    bubbleOpacity: clamp(source.bubbleOpacity, 0, 0.8, DEFAULT_SETTINGS.bubbleOpacity),
    muted: source.muted !== false,
    volume: clamp(source.volume, 0, 1, DEFAULT_SETTINGS.volume),
    fitMode: ['cover', 'contain', 'fill'].includes(source.fitMode) ? source.fitMode : 'cover',
    zoom: clamp(source.zoom, 50, 300, DEFAULT_SETTINGS.zoom),
    positionX: clamp(source.positionX, 0, 100, DEFAULT_SETTINGS.positionX),
    positionY: clamp(source.positionY, 0, 100, DEFAULT_SETTINGS.positionY),
    showControls: source.showControls !== false,
    enabled: source.enabled !== false,
  };
}

export async function prepareSourceThumbnails(projects, cacheRoot = join(process.env.LOCALAPPDATA || tmpdir(), 'CodexWallpaperManager', 'thumbnails')) {
  const thumbnails = new Map();
  const jobs = [];
  mkdirSync(cacheRoot, { recursive: true });
  for (const project of projects) {
    const source = project.previewPath || (project.type === 'image' ? project.filePath : null);
    if (!source || !/\.(png|jpe?g|gif|bmp|webp)$/i.test(source)) continue;
    try {
      const info = statSync(source);
      if (!info.isFile() || info.size > 24 * 1024 * 1024) continue;
      const key = createHash('sha256').update(`${resolve(source)}\n${info.size}\n${info.mtimeMs}\nthumbnail-v1-320x180`).digest('hex').slice(0, 32);
      const name = key + '.jpg';
      const output = join(cacheRoot, name);
      thumbnails.set(project.id, output);
      if (!existsSync(output) || statSync(output).size === 0) jobs.push({ source, name });
    } catch { /* A missing preview does not prevent using the wallpaper. */ }
  }
  if (jobs.length) {
    const manifest = join(cacheRoot, `jobs-${process.pid}-${Date.now()}.json`);
    try {
      writeFileSync(manifest, JSON.stringify(jobs), 'utf8');
      const report = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        fileURLToPath(new URL('../scripts/make-wallpaper-thumbnails.ps1', import.meta.url)),
        '-BatchFile', manifest, '-OutputDirectory', cacheRoot],
      { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
      if (process.env.CODEX_WALLPAPER_THUMBNAIL_DEBUG === '1') process.stderr.write(report.stdout + '\n');
    } catch (error) {
      if (process.env.CODEX_WALLPAPER_THUMBNAIL_DEBUG === '1') process.stderr.write(String(error.stderr || error.message) + '\n');
      /* Existing cache entries and small original previews remain available. */
    }
    finally { rmSync(manifest, { force: true }); }
  }
  return thumbnails;
}

export function buildSourceOptions(projects, thumbnails = new Map()) {
  let thumbnailBudget = 8 * 1024 * 1024;
  return projects.filter(project =>
    project.skinMode !== 'unsupported' && (project.type === 'video' || project.type === 'image' || project.previewPath)
  ).map(project => {
    let thumbnail;
    try {
      const cached = thumbnails.get(project.id);
      const preview = cached && existsSync(cached) ? cached : project.previewPath;
      if (preview && /\.(png|jpe?g|gif|webp|bmp)$/i.test(preview)) {
        const bytes = statSync(preview).size;
        if (bytes <= 128 * 1024 && bytes <= thumbnailBudget) {
          thumbnail = inlineMedia(preview, 128 * 1024);
          thumbnailBudget -= bytes;
        }
      }
    } catch { /* A thumbnail is optional; never use an arbitrary remote URL. */ }
    return {
      id: project.id, title: project.title, type: project.type, skinMode: project.skinMode,
      ageRating: ['G', 'PG-13', 'R-18'].includes(project.ageRating) ? project.ageRating : 'UNRATED',
      labelType: project.skinMode === 'video' ? 'video' : 'image',
      ...(thumbnail ? { thumbnail } : {}),
    };
  });
}

export class CodexSkinBridge {
  constructor({
    cdpPort = DEFAULT_CDP_PORT, stateFile = DEFAULT_STATE_FILE, restoreIntervalMs = 3000,
    autoRestore = true, manageRenderer = true, role = 'bridge',
    serviceLeaseFile = process.env.CODEX_WALLPAPER_SERVICE_FILE || join(dirname(DEFAULT_STATE_FILE), 'service.json'),
    enumerateSources = enumerateWallpaperSources, selectMedia = selectEmbeddableMedia,
  } = {}) {
    this.cdpPort = cdpPort;
    this.stateFile = stateFile;
    this.enumerateSources = enumerateSources;
    this.selectMedia = selectMedia;
    this.manageRenderer = manageRenderer;
    this.role = role;
    this.serviceLeaseFile = serviceLeaseFile;
    this.clients = new Map();
    this.active = null;
    this.watchdog = null;
    this.streamGeneration = 0;
    this.videoTransfer = null;
    this.selectionTask = Promise.resolve();
    this.applyQueue = Promise.resolve();
    this.applyInFlight = false;
    this.refreshTask = null;
    this.saved = readSavedSkinState(this.stateFile);
    this.profiles = Object.assign(Object.create(null), this.saved?.profiles && typeof this.saved.profiles === 'object' && !Array.isArray(this.saved.profiles) ? this.saved.profiles : {});
    if (this.saved?.id && !Object.hasOwn(this.profiles, this.saved.id)) this.profiles[this.saved.id] = pick(normalizeSkinSettings(this.saved), PROFILE_KEYS);
    this.restoreInFlight = false;
    this.lastRestoreError = null;
    this.restoreWatchdog = null;
    if (autoRestore && manageRenderer && restoreIntervalMs > 0) {
      this.restoreWatchdog = setInterval(() => this.restoreSaved().catch(() => {}), restoreIntervalMs);
      this.restoreWatchdog.unref();
      setTimeout(() => this.restoreSaved().catch(() => {}), 0).unref();
    }
  }

  externallyManaged() {
    if (this.role !== 'mcp' || process.env.CODEX_WALLPAPER_SERVICE === '1' || !this.serviceLeaseFile) return false;
    try {
      const lease = JSON.parse(readFileSync(this.serviceLeaseFile, 'utf8'));
      const age = Date.now() - Date.parse(lease.updatedAt);
      if (!Number.isInteger(lease.pid) || lease.pid <= 0 || !Number.isFinite(age) || age < -10000) return false;
      process.kill(lease.pid, 0);
      return true;
    } catch { return false; }
  }

  assertRendererOwner() {
    if (!this.manageRenderer) throw new Error('This bridge is configured for read-only status.');
    if (this.externallyManaged()) throw new Error('The wallpaper manager is already running. Use its floating control panel to change the wallpaper.');
  }

  savedSettings() {
    return this.active ? { id: this.active.currentId, ...pick(this.active, PROFILE_KEYS), enabled: this.active.enabled } : null;
  }

  persistActive() {
    const settings = this.savedSettings();
    if (!settings) return;
    this.profiles[this.active.currentId] = pick(this.active, PROFILE_KEYS);
    this.saved = { schema: 2, ...settings, profiles: this.profiles, updatedAt: new Date().toISOString() };
    writeSavedSkinState(this.saved, this.stateFile);
  }

  async restoreSaved() {
    if (this.active || !this.saved || this.restoreInFlight || !this.manageRenderer || this.externallyManaged()) return false;
    this.restoreInFlight = true;
    try {
      const debug = await this.debugStatus();
      if (!debug.available) return false;
      await this.apply(this.saved);
      this.lastRestoreError = null;
      return true;
    } catch (error) {
      this.lastRestoreError = error instanceof Error ? error.message : String(error);
      return false;
    } finally { this.restoreInFlight = false; }
  }

  async debugStatus() {
    try {
      const targets = await discoverTargets(this.cdpPort);
      return { available: targets.length > 0, port: this.cdpPort, targetCount: targets.length };
    } catch (error) {
      return { available: false, port: this.cdpPort, targetCount: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async ensureClients() {
    this.assertRendererOwner();
    const targets = await discoverTargets(this.cdpPort);
    const ids = new Set(targets.map(target => target.id));
    for (const [id, client] of this.clients) {
      if (!ids.has(id) || client.socket?.readyState !== WebSocket.OPEN) {
        client.close();this.clients.delete(id);
      }
    }
    const added = [];
    for (const target of targets) {
      if (this.clients.has(target.id)) continue;
      const client = new CdpClient(target.webSocketDebuggerUrl);
      client.targetId = target.id;
      client.needsInjection = true;
      await client.connect();
      await client.call('Page.enable');
      await client.call('Runtime.enable');
      await client.call('Runtime.addBinding', { name: 'codexSkinCommand' });
      await client.call('Page.setBypassCSP', { enabled: true });
      client.onEvent = message => this.handleClientEvent(message, client);
      this.clients.set(target.id, client);
      added.push(client);
    }
    return { targetCount: targets.length, added };
  }

  handleClientEvent(message, client) {
    if (message.method === 'Page.frameNavigated' && !message.params?.frame?.parentId && client) {
      if (message.params.frame.url !== 'app://-/index.html') {
        client.close();this.clients.delete(client.targetId);return;
      }
      client.needsInjection = true;
      return;
    }
    if (message.method !== 'Runtime.bindingCalled' || message.params?.name !== 'codexSkinCommand') return;
    let command;
    try { command = JSON.parse(message.params.payload); } catch { return; }
    if (typeof command?.id === 'string' && command.action === 'settings' && command.id !== this.active?.currentId) return;
    if (command?.action === 'settings' && this.active && command.settings && typeof command.settings === 'object') {
      Object.assign(this.active, normalizeSkinSettings(command.settings, this.active));
      this.persistActive();
      return;
    }
    if (command?.action === 'toggle-enabled' && this.active && typeof command.enabled === 'boolean') {
      this.active.enabled = command.enabled;this.persistActive();
      for (const targetClient of this.clients.values()) {
        targetClient.call('Runtime.evaluate', { expression: 'window.__codexWallpaperSetEnabled?.(' + JSON.stringify(command.enabled) + ')' }).catch(() => {});
      }
      return;
    }
    if (command?.action === 'refresh-library') {
      this.selectionTask = this.selectionTask.catch(() => {}).then(() => this.apply({ id: this.active?.currentId || '@library' })).catch(error => this.reportVideoError(error));
      return;
    }
    if (command?.action !== 'select' || typeof command.id !== 'string') return;
    this.selectionTask = this.selectionTask.catch(() => {}).then(() => this.apply({ id: command.id })).catch(error => this.reportVideoError(error));
  }

  async reportVideoError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const expression = 'window.__codexWallpaperVideoError?.(' + JSON.stringify(message) + ')';
    for (const client of this.clients.values()) {
      try { await client.call('Runtime.evaluate', { expression }); } catch { /* closed target */ }
    }
  }

  async streamVideoToClients(file, totalBytes, generation, recipients = [...this.clients.values()]) {
    const token = generation + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const begin = 'window.__codexWallpaperBeginVideo?.(' + JSON.stringify(token) + ',' + totalBytes + ')';
    let clients = recipients.filter(client => this.clients.get(client.targetId) === client);
    for (const client of clients) {
      try { await client.call('Runtime.evaluate', { expression: begin }); } catch { clients = clients.filter(item => item !== client); }
    }
    if (!clients.length) return;
    const descriptor = openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(2 * 1024 * 1024);
    try {
      let offset = 0;
      while (offset < totalBytes) {
        if (generation !== this.streamGeneration) return;
        const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, totalBytes - offset), offset);
        if (!count) throw new Error('Unexpected end of video file.');
        const push = 'window.__codexWallpaperPushVideoChunk?.(' + JSON.stringify(token) + ',' + JSON.stringify(buffer.subarray(0, count).toString('base64')) + ')';
        for (const client of [...clients]) {
          try { await client.call('Runtime.evaluate', { expression: push }); } catch { clients = clients.filter(item => item !== client); }
        }
        if (!clients.length) return;
        offset += count;
      }
    } finally { closeSync(descriptor); }
    if (generation !== this.streamGeneration) return;
    const finish = 'window.__codexWallpaperFinishVideo?.(' + JSON.stringify(token) + ',' + JSON.stringify(mimeFor(file)) + ')';
    for (const client of clients) {
      try { await client.call('Runtime.evaluate', { expression: finish }); } catch { /* closed target */ }
    }
  }

  async injectCurrent({ onlyNew = false } = {}) {
    const { targetCount, added } = await this.ensureClients();
    if (!targetCount) throw new Error('No Codex renderer targets were found on the debug port.');
    const results = [];
    const clients = onlyNew ? [...this.clients.values()].filter(client => added.includes(client) || client.needsInjection) : [...this.clients.values()];
    if (!clients.length) return results;
    const source = makeInjectionScript(this.active);
    const generation = this.streamGeneration;
    for (const client of clients) {
      if (client.scriptId) {
        try { await client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId }); } catch { /* ignore */ }
      }
      const registered = await client.call('Page.addScriptToEvaluateOnNewDocument', { source });
      client.scriptId = registered.identifier;
      const evaluated = await client.call('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true });
      if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text || 'Wallpaper renderer installation failed.');
      client.needsInjection = false;
      results.push(evaluated.result?.value || { installed: true });
    }
    if (clients.length && this.videoTransfer && this.videoTransfer.generation === generation) {
      const transfer = this.videoTransfer;
      await this.streamVideoToClients(transfer.path, transfer.bytes, generation, clients);
    }
    return results;
  }

  apply(args = {}) {
    const operation = this.applyQueue.catch(() => {}).then(() => this.applyInternal(args));
    this.applyQueue = operation;
    return operation;
  }

  async applyInternal(args = {}) {
    this.applyInFlight = true;
    try {
      if (this.refreshTask) await this.refreshTask.catch(() => {});
      return await this.applyMedia(args);
    } finally { this.applyInFlight = false; }
  }

  async applyMedia(args = {}) {
    this.assertRendererOwner();
    const { id } = args;
    const projects = this.enumerateSources();
    const managerOnly = id === '@library';
    const project = managerOnly ? { id: '@library', type: 'image', skinMode: 'image', title: 'Choose a wallpaper' } : projects.find(item => item.id === id);
    if (!project) throw new Error('Unknown Wallpaper Engine source id: ' + id);
    if (project.skinMode === 'unsupported' || (project.type !== 'video' && project.type !== 'image' && !project.previewPath)) {
      throw new Error('This project has no supported video, image, or project preview.');
    }
    const options = buildSourceOptions(projects, await prepareSourceThumbnails(projects));
    if (!managerOnly && !options.some(item => item.id === id)) throw new Error('This project is not in the local media library.');
    const selected = managerOnly ? { mode: 'library', mediaUrl: null, fallback: false, fallbackKind: null } : await this.selectMedia(project);
    const previous = this.active;
    const settings = normalizeSkinSettings({ ...pick(this.active || this.saved, COMMON_KEYS), ...this.profiles[id], ...args });
    this.active = {
      ...settings, mediaUrl: selected.mediaUrl, mediaFrames: selected.mediaFrames || [],
      frameDelayMs: selected.frameDelayMs || 250, frameRate: selected.frameRate || null,
      mode: selected.mode, sourceOptions: options, currentId: project.id,
    };
    const generation = ++this.streamGeneration;
    this.videoTransfer = selected.mode === 'video-blob' ? { path: selected.videoPath, bytes: selected.videoBytes, generation } : null;
    let targets;
    try { targets = await this.injectCurrent(); }
    catch (error) { this.active = previous;this.videoTransfer = null;throw error; }
    this.persistActive();
    if (!this.watchdog) {
      this.watchdog = setInterval(() => {
        if (this.active && !this.refreshInFlight && !this.applyInFlight) {
          this.refreshInFlight = true;
          this.refreshTask = this.injectCurrent({ onlyNew: true }).catch(error => { this.lastRestoreError = String(error.message || error); }).finally(() => { this.refreshInFlight = false;this.refreshTask = null; });
        }
      }, 3000);
      this.watchdog.unref();
    }
    return {
      applied: true,
      project: { id: project.id, title: project.title, type: project.type, skinMode: project.skinMode },
      renderMode: selected.mode, usedPreviewFallback: selected.fallback, fallbackKind: selected.fallbackKind,
      sourceResolution: selected.sourceResolution || null, renderResolution: selected.renderResolution || null,
      frameRate: selected.frameRate || null, videoLoading: false, videoBytes: selected.videoBytes || null,
      compressed: selected.compressed || false, originalBytes: selected.originalBytes || null,
      compressionRatio: selected.compressionRatio || null, bitrateKbps: selected.bitrateKbps || null,
      compressionCached: selected.compressionCached || false, targetCount: targets.length,
      settings: this.savedSettings(),
    };
  }

  async remove() {
    this.assertRendererOwner();
    this.streamGeneration++;
    const removed = [];
    try { await this.ensureClients(); } catch { /* debug endpoint may already be gone */ }
    for (const client of this.clients.values()) {
      try {
        if (client.scriptId) await client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId });
        const evaluated = await client.call('Runtime.evaluate', { expression: REMOVE_SCRIPT, returnByValue: true });
        removed.push(evaluated.result?.value || { removed: true });
      } catch { /* closed target */ }
      client.close();
    }
    this.clients.clear();this.active = null;this.saved = null;this.profiles = Object.create(null);this.videoTransfer = null;
    this.lastRestoreError = null;clearSavedSkinState(this.stateFile);
    if (this.watchdog) clearInterval(this.watchdog);this.watchdog = null;
    return { removed: true, targetCount: removed.length };
  }

  disconnect() {
    this.streamGeneration++;
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
    if (this.watchdog) clearInterval(this.watchdog);this.watchdog = null;
    if (this.restoreWatchdog) clearInterval(this.restoreWatchdog);this.restoreWatchdog = null;
  }

  async status() {
    return {
      debug: await this.debugStatus(),
      active: this.active ? { ...this.savedSettings(), mode: this.active.mode } : null,
      connectedTargets: this.clients.size, externallyManaged: this.externallyManaged(),
      persistence: {
        configured: Boolean(this.saved), enabled: Boolean(this.saved && this.saved.enabled !== false),
        selectedId: this.saved?.id || null, profileCount: Object.keys(this.profiles).length,
        autoRestorePending: Boolean(this.saved && !this.active), lastRestoreError: this.lastRestoreError,
      },
    };
  }
}

