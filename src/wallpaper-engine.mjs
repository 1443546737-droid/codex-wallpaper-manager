import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

export const WE_APP_ID = '431960';

const COMMON_STEAM_DIRS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
  'E:\\SteamLibrary',
];

function uniqueExistingDirectories(paths) {
  const seen = new Set();
  return paths
    .filter(Boolean)
    .map((value) => normalize(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key) || !existsSync(value)) return false;
      seen.add(key);
      try { return statSync(value).isDirectory(); } catch { return false; }
    });
}

export function steamPathFromRegistry() {
  if (process.platform !== 'win32') return null;
  try {
    const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const output = execFileSync(
      reg,
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(output);
    return match ? normalize(match[1].trim()) : null;
  } catch {
    return null;
  }
}

export function librariesFromVdfText(text) {
  const libraries = [];
  let currentPath = null;
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);
    if (match) currentPath = match[1].replace(/\\\\/g, '\\');
    if (currentPath && new RegExp(`"${WE_APP_ID}"\\s+"1"`).test(line)) {
      libraries.push(normalize(currentPath));
      currentPath = null;
    }
  }
  return [...new Set(libraries)];
}

function steamRoots() {
  const override = process.env.WALLPAPER_ENGINE_STEAM_ROOT;
  return uniqueExistingDirectories([
    override,
    steamPathFromRegistry(),
    ...COMMON_STEAM_DIRS,
  ]);
}

export function wallpaperEngineSourceInfo() {
  const roots = steamRoots();
  const libraries = [];
  for (const root of roots) {
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf');
    if (existsSync(vdf)) {
      try { libraries.push(...librariesFromVdfText(readFileSync(vdf, 'utf8'))); } catch { /* malformed VDF */ }
    }
    if (existsSync(join(root, 'steamapps', 'common', 'wallpaper_engine'))) libraries.push(root);
  }

  const candidates = [
    process.env.WALLPAPER_ENGINE_HOME,
    ...[...roots, ...libraries].map((root) => join(root, 'steamapps', 'common', 'wallpaper_engine')),
    'C:\\Program Files (x86)\\Wallpaper Engine',
  ].filter(Boolean);

  let installDir = null;
  for (const candidate of candidates) {
    const dir = normalize(candidate);
    if (existsSync(join(dir, 'wallpaper64.exe')) || existsSync(join(dir, 'wallpaper32.exe'))) {
      installDir = dir;
      break;
    }
  }

  return {
    installed: Boolean(installDir),
    installDir,
    steamRoots: roots,
    libraryDirs: uniqueExistingDirectories([...roots, ...libraries]),
  };
}

function inferType(file) {
  if (/\.(mp4|webm|mkv|avi|mov)$/i.test(file)) return 'video';
  if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(file)) return 'image';
  if (/\.html?$/i.test(file)) return 'web';
  if (/\.exe$/i.test(file)) return 'application';
  return 'scene';
}

function safeProjectFile(projectDir, candidate, extensions) {
  if (typeof candidate !== 'string' || !candidate || isAbsolute(candidate)) return null;
  const file = resolve(projectDir, candidate);
  const inside = relative(resolve(projectDir), file);
  if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) return null;
  if (extensions && !extensions.includes(extname(file).toLowerCase())) return null;
  try {
    if (!statSync(file).isFile()) return null;
    const realFile = realpathSync(file), realRoot = realpathSync(projectDir);
    const realRelative = relative(realRoot, realFile);
    if (realRelative === '..' || realRelative.startsWith('..' + sep) || isAbsolute(realRelative)) return null;
    return file;
  } catch { return null; }
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];

export function normalizeContentRating(value) {
  const rating = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const ratings = { everyone: 'G', questionable: 'PG-13', mature: 'R-18', g: 'G', 'pg-13': 'PG-13', 'r-18': 'R-18' };
  return Object.hasOwn(ratings, rating) ? ratings[rating] : 'UNRATED';
}

export function readProject(projectDir, source = 'local') {
  const projectPath = join(projectDir, 'project.json');
  if (!existsSync(projectPath)) return null;
  try {
    const data = JSON.parse(readFileSync(projectPath, 'utf8'));
    if (!data || typeof data !== 'object' || typeof data.file !== 'string') return null;
    const folderId = basename(projectDir);
    const declaredType = typeof data.type === 'string' ? data.type.toLowerCase() : inferType(data.file);
    const type = ['scene', 'video', 'web', 'application', 'image'].includes(declaredType) ? declaredType : inferType(data.file);
    const previewPath = safeProjectFile(projectDir, data.preview, IMAGE_EXTENSIONS);
    const filePath = safeProjectFile(projectDir, data.file);
    // A manifest may reference a missing media file, but never an absolute or escaped path.
    const relativeFile = relative(resolve(projectDir), resolve(projectDir, data.file));
    if (isAbsolute(data.file) || relativeFile === '..' || relativeFile.startsWith('..' + sep) || isAbsolute(relativeFile)) return null;
    const portableMediaExists = Boolean(filePath);
    return {
      id: source === 'workshop' ? folderId : `${source}:${folderId}`,
      source,
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : folderId,
      ageRating: normalizeContentRating(data.contentrating),
      type: ['scene', 'video', 'web', 'application', 'image'].includes(type) ? type : inferType(data.file),
      projectPath,
      projectDir,
      filePath: filePath || resolve(projectDir, data.file),
      previewPath,
      skinMode: type === 'video' && portableMediaExists && VIDEO_EXTENSIONS.includes(extname(filePath).toLowerCase())
        ? 'video'
        : type === 'image' && portableMediaExists && IMAGE_EXTENSIONS.includes(extname(filePath).toLowerCase())
          ? 'image'
        : type === 'web' && portableMediaExists
          ? 'web'
          : previewPath
            ? 'preview'
            : 'unsupported',
    };
  } catch {
    return null;
  }
}

export function enumerateWallpaperSources(info = wallpaperEngineSourceInfo()) {
  const roots = [];
  if (info.installDir) {
    roots.push({ path: join(info.installDir, 'projects', 'defaultprojects'), source: 'default' });
    roots.push({ path: join(info.installDir, 'projects', 'myprojects'), source: 'local' });
  }
  for (const library of info.libraryDirs || []) {
    roots.push({ path: join(library, 'steamapps', 'workshop', 'content', WE_APP_ID), source: 'workshop' });
  }

  const found = new Map();
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    let entries;
    try { entries = readdirSync(root.path); } catch { continue; }
    for (const entry of entries) {
      const projectDir = join(root.path, entry);
      let stat;
      try { stat = statSync(projectDir); } catch { continue; }
      if (!stat.isDirectory()) continue;
      const project = readProject(projectDir, root.source);
      if (!project) continue;
      const key = normalize(project.projectPath).toLowerCase();
      if (!found.has(key)) found.set(key, project);
    }
  }
  return [...found.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function wallpaperSourceStatus() {
  const info = wallpaperEngineSourceInfo();
  const sources = info.installed ? enumerateWallpaperSources(info) : [];
  return {
    platform: process.platform,
    installed: info.installed,
    installDir: info.installDir,
    sourceCount: sources.length,
    usableAsCodexSkin: sources.filter((item) => item.skinMode !== 'unsupported').length,
    countsByMode: Object.fromEntries(
      ['video', 'image', 'web', 'preview', 'unsupported'].map((mode) => [mode, sources.filter((item) => item.skinMode === mode).length]),
    ),
  };
}

