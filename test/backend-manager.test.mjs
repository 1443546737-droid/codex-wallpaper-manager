import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { CodexSkinBridge, normalizeSkinSettings, readSavedSkinState, isCodexTarget, buildSourceOptions, prepareSourceThumbnails } from '../src/codex-skin.mjs';
import { readProject, normalizeContentRating } from '../src/wallpaper-engine.mjs';

const command = (action, properties) => ({ method: 'Runtime.bindingCalled', params: { name: 'codexSkinCommand', payload: JSON.stringify({ action, ...properties }) } });
const sources = [{ id: 'a', title: 'Image A', type: 'image', skinMode: 'image', filePath: 'unused.png' }, { id: 'b', title: 'Video B', type: 'video', skinMode: 'video', filePath: 'unused.mp4' }];
const fakeMedia = project => ({ mediaUrl: 'data:image/png;base64,AA==', mode: project.type, fallback: false, fallbackKind: null });
function cleanup(root) {
  const target = resolve(root), allowedRoot = resolve(tmpdir()) + sep;
  assert.ok(target.toLowerCase().startsWith(allowedRoot.toLowerCase()) && basename(target).startsWith('codex-wallpaper-'));
  rmSync(target, { recursive: true, force: true });
}
class StateBridge extends CodexSkinBridge {
  constructor(stateFile) { super({ stateFile, autoRestore: false, enumerateSources: () => sources, selectMedia: fakeMedia }); }
  async injectCurrent() { return [{ installed: true }]; }
}

test('per-wallpaper framing survives source switches and restart; soundtrack and disabled state persist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-wallpaper-state-test-'));
  const stateFile = join(root, 'state.json');
  const bridge = new StateBridge(stateFile);
  let restarted;
  try {
    await bridge.apply({ id: 'a', zoom: 185, positionX: 72, positionY: 36, muted: false, volume: 0.23, bubbleBlurPx: 21, bubbleOpacity: 0.42 });
    bridge.handleClientEvent(command('settings', { settings: { zoom: 235, positionX: 82, panelOpacity: 0.37 } }));
    await bridge.apply({ id: 'b' });
    assert.equal(bridge.active.zoom, 100, 'a new wallpaper starts with its own default framing');
    assert.equal(bridge.active.positionX, 50);
    assert.equal(bridge.active.volume, 0.23, 'common audio setting carries to a new wallpaper');
    bridge.handleClientEvent(command('settings', { settings: { zoom: 120, positionY: 64, muted: true, volume: 0.6 } }));
    await bridge.apply({ id: 'a' });
    assert.equal(bridge.active.zoom, 235);
    assert.equal(bridge.active.positionX, 82);
    assert.equal(bridge.active.positionY, 36);
    assert.equal(bridge.active.volume, 0.23);
    assert.equal(bridge.active.muted, false);
    assert.equal(bridge.active.bubbleBlurPx, 21);
    assert.equal(bridge.active.bubbleOpacity, 0.42);
    bridge.handleClientEvent(command('toggle-enabled', { enabled: false }));
    const saved = readSavedSkinState(stateFile);
    assert.equal(saved.enabled, false, 'disabled wallpaper retains the manager configuration');
    assert.equal(saved.profiles.b.zoom, 120);
    restarted = new StateBridge(stateFile);
    await restarted.apply(restarted.saved);
    assert.equal(restarted.active.enabled, false);
    assert.equal(restarted.active.zoom, 235);
    assert.equal(restarted.active.bubbleBlurPx, 21);
    await restarted.apply({ id: 'b' });
    assert.equal(restarted.active.enabled, false);
    assert.equal(restarted.active.positionY, 64);
    assert.equal(restarted.active.volume, 0.6);
    await assert.rejects(restarted.apply({ id: '../outside-file.mp4' }), /Unknown Wallpaper Engine source/);
  } finally { bridge.disconnect();restarted?.disconnect();cleanup(root); }
});

test('legacy flat saved state migrates to an individual wallpaper profile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-wallpaper-legacy-test-'));
  const file = join(root, 'state.json');
  // Windows PowerShell may write a UTF-8 BOM when creating the first configuration.
  writeFileSync(file, '\uFEFF' + JSON.stringify({ enabled: true, id: 'a', zoom: 173, positionX: 63, muted: true }));
  const bridge = new StateBridge(file);
  try {
    await bridge.apply(bridge.saved);
    assert.equal(bridge.active.zoom, 173);
    assert.equal(JSON.parse(readFileSync(file)).schema, 2);
    assert.equal(JSON.parse(readFileSync(file)).profiles.a.positionX, 63);
  } finally { bridge.disconnect();cleanup(root); }
});

test('an empty local library still opens the manager instead of hiding all controls', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-wallpaper-empty-test-'));
  const bridge = new StateBridge(join(root, 'state.json')); bridge.enumerateSources = () => [];
  try { await bridge.apply({ id: '@library' }); assert.equal(bridge.active.mode, 'library'); assert.equal(bridge.active.sourceOptions.length, 0); assert.equal(bridge.saved.id, '@library'); }
  finally { bridge.disconnect();cleanup(root); }
});

test('settings clamp values and ignore arbitrary renderer properties', () => {
  const settings = normalizeSkinSettings({ zoom: 400, volume: -5, positionX: 110, panelOpacity: NaN, unsafe: 'code' });
  assert.equal(settings.zoom, 300);
  assert.equal(settings.volume, 0);
  assert.equal(settings.positionX, 100);
  assert.equal(settings.panelOpacity, 0);
  assert.equal(normalizeSkinSettings({ panelOpacity: 0 }).panelOpacity, 0);
  assert.equal(Object.hasOwn(settings, 'unsafe'), false);
});

test('real media is streamed to newly opened and reloaded renderers without restreaming unaffected windows', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-wallpaper-cdp-test-'));
  const file = join(root, 'video.mp4');writeFileSync(file, Buffer.alloc(24, 7));
  const bridge = new CodexSkinBridge({ stateFile: join(root, 'unused.json'), autoRestore: false });
  const makeClient = id => ({ targetId: id, needsInjection: true, calls: [], async call(method, parameters = {}) {
    this.calls.push({ method, ...parameters });
    if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script-' + id };
    return { result: { value: { installed: true } } };
  }, close() {} });
  const one = makeClient('one'), two = makeClient('two');
  bridge.active = { ...normalizeSkinSettings(), mediaUrl: null, mode: 'video-blob', currentId: 'b', sourceOptions: [] };
  bridge.streamGeneration = 1;bridge.videoTransfer = { path: file, bytes: 24, generation: 1 };
  bridge.clients.set('one', one);
  let added = [one];bridge.ensureClients = async () => ({ targetCount: bridge.clients.size, added });
  const finishes = client => client.calls.filter(call => call.expression?.startsWith('window.__codexWallpaperFinishVideo?.(')).length;
  try {
    await bridge.injectCurrent({ onlyNew: true });
    assert.equal(finishes(one), 1);
    bridge.clients.set('two', two);added = [two];
    await bridge.injectCurrent({ onlyNew: true });
    assert.equal(finishes(one), 1);assert.equal(finishes(two), 1);
    added = [];one.needsInjection = true;
    await bridge.injectCurrent({ onlyNew: true });
    assert.equal(finishes(one), 2);assert.equal(finishes(two), 1);
  } finally { bridge.disconnect();cleanup(root); }
});

test('MCP does not mutate a renderer owned by a live standalone service', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-wallpaper-lease-test-'));
  const lease = join(root, 'lease.json');
  writeFileSync(lease, JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString() }));
  const bridge = new CodexSkinBridge({ stateFile: join(root, 'state.json'), serviceLeaseFile: lease, role: 'mcp', autoRestore: false });
  try { assert.equal(bridge.externallyManaged(), true);await assert.rejects(bridge.apply({ id: 'a' }), /already running/); }
  finally { bridge.disconnect();cleanup(root); }
});

test('only exact Codex renderer URLs are eligible', () => {
  const target = { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/a', url: 'app://-/index.html' };
  assert.equal(isCodexTarget(target), true);
  for (const url of ['https://example.com', 'app://-/login.html', 'app://-/index.html?avatar-overlay', 'app://-/index.html#other']) assert.equal(isCodexTarget({ ...target, url }), false);
});

test('library manifests cannot escape project root and image previews never execute web files', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-wallpaper-project-test-'));
  const project = join(root, 'project');mkdirSync(project);
  writeFileSync(join(root, 'outside.png'), 'outside');
  writeFileSync(join(project, 'photo.png'), 'image');
  writeFileSync(join(project, 'preview.html'), '<script>bad()</script>');
  const manifest = contents => writeFileSync(join(project, 'project.json'), JSON.stringify(contents));
  try {
    manifest({ file: '../outside.png', title: 'bad', type: 'image' });assert.equal(readProject(project), null);
    manifest({ file: join(root, 'outside.png'), title: 'bad', type: 'image' });assert.equal(readProject(project), null);
    manifest({ file: 'photo.png', preview: 'preview.html', title: 'image', type: 'image' });
    const item = readProject(project);
    assert.equal(item.skinMode, 'image');assert.equal(item.previewPath, null);
    assert.equal(buildSourceOptions([item])[0].labelType, 'image');
    manifest({ file: 'scene.pkg', preview: '../outside.png', type: 'scene' });
    assert.equal(readProject(project).skinMode, 'unsupported');
  } finally { cleanup(root); }
});

test('large previews get cached thumbnails without modifying the source', { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-wallpaper-thumbnail-test-'));
  const preview = join(root, 'preview.gif');
  const original = Buffer.concat([Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), Buffer.alloc(200000)]);
  writeFileSync(preview, original);
  const secondPreview = join(root, 'second-preview.gif'); writeFileSync(secondPreview, original);
  const projects = [{ id: 'thumbnail-test', title: 'Large preview', type: 'scene', skinMode: 'preview', previewPath: preview }, { id: 'second-thumbnail', title: 'Second preview', type: 'scene', skinMode: 'preview', previewPath: secondPreview }];
  try {
    assert.equal(buildSourceOptions(projects)[0].thumbnail, undefined);
    const thumbnails = await prepareSourceThumbnails(projects, join(root, 'cache'));
    const options = buildSourceOptions(projects, thumbnails);
    assert.match(options[0].thumbnail, /^data:image\/jpeg;base64,/);
    assert.match(options[1].thumbnail, /^data:image\/jpeg;base64,/);
    assert.ok(readFileSync(thumbnails.get('thumbnail-test')).length < 128 * 1024);
    assert.deepEqual(readFileSync(preview), original);
    const cached = await prepareSourceThumbnails(projects, join(root, 'cache'));
    assert.equal(cached.get('thumbnail-test'), thumbnails.get('thumbnail-test'));
  } finally { cleanup(root); }
});

test('library age ratings come from metadata and unknown values stay unrated', () => {
  assert.equal(normalizeContentRating('Everyone'), 'G');
  assert.equal(normalizeContentRating('Questionable'), 'PG-13');
  assert.equal(normalizeContentRating('Mature'), 'R-18');
  for (const value of [undefined, '', 'unknown', '__proto__', 18]) assert.equal(normalizeContentRating(value), 'UNRATED');
  const root = mkdtempSync(join(tmpdir(), 'codex-wallpaper-rating-test-'));
  try {
    writeFileSync(join(root, 'photo.png'), 'fixture');
    writeFileSync(join(root, 'project.json'), JSON.stringify({ file: 'photo.png', type: 'image', contentrating: 'Mature' }));
    const project = readProject(root);
    assert.equal(project.ageRating, 'R-18');
    assert.equal(buildSourceOptions([project])[0].ageRating, 'R-18');
    assert.equal(buildSourceOptions([{ ...project, ageRating: undefined }])[0].ageRating, 'UNRATED');
  } finally { cleanup(root); }
});
