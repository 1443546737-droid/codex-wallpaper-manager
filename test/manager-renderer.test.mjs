import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeManagerInjectionScript, makeManagerRemovalScript } from '../src/manager-renderer.mjs';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(pluginRoot, 'qa/manager');
mkdirSync(output, { recursive: true });
const { chromium } = await import('playwright');
const picture = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#c0dfdf"/><stop offset=".5" stop-color="#b5b6df"/><stop offset="1" stop-color="#596da8"/></linearGradient></defs><path fill="url(#a)" d="M0 0h1280v800H0z"/><circle cx="830" cy="270" r="180" fill="#f5e4c0" opacity=".7"/><path d="M0 670 300 340l260 320 200-130 520 270H0" fill="#4d7690" opacity=".65"/></svg>').toString('base64');
const base = {
  enabled: true, mode: 'image', mediaUrl: picture, currentId: 'image-one', muted: true, volume: .35,
  panelOpacity: .48, scrimOpacity: .08, blurPx: 0, fitMode: 'cover', zoom: 100, positionX: 50, positionY: 50,
  showControls: true, sourceOptions: [
    { id: 'image-one', title: '山色与晨光', type: 'scene', labelType: 'image', ageRating: 'G', thumbnail: picture },
    { id: 'video-one', title: '流动云层', type: 'video', labelType: 'video', ageRating: 'PG-13', thumbnail: picture },
    { id: 'rating-three', title: '分级测试三', type: 'video', labelType: 'video', ageRating: 'R-18', thumbnail: picture },
    { id: 'unrated-one', title: '未标注示例', type: 'scene', labelType: 'image', ageRating: 'UNRATED', thumbnail: picture },
  ],
};

test('wallpaper manager browser behavior', { timeout: 90000 }, async t => {
  const launch = { headless: true };
  if (process.env.CODEX_WALLPAPER_TEST_BROWSER) launch.executablePath = process.env.CODEX_WALLPAPER_TEST_BROWSER;
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<html class="light" style="color-scheme:light"><head><style>body{margin:0;font:15px system-ui;color:#283649}#app{display:flex;height:100vh;background:white}nav{width:210px;padding:24px;background:#eee}main{flex:1;padding:40px;background:white}header{font-size:23px;margin-bottom:20px}textarea{width:480px;height:100px;display:block;margin-top:180px}p{max-width:550px;line-height:1.8}</style></head><body><div id="app" class="bg-surface"><nav class="bg-surface-secondary"><b>Codex</b><p>新聊天</p><p>项目</p><p>我的聊天记录</p></nav><main class="bg-surface-canvas"><header>让喜欢的壁纸陪伴每一次对话</header><p>壁纸显示在整个窗口后方。聊天文字、输入框和侧栏可以正常使用，浮动管理器独立控制取景与声音。</p><textarea id="chat" aria-label="聊天输入"></textarea></main></div><audio id="unrelated-audio"></audio></body></html>`);
    await page.evaluate(() => {
      const chat = document.getElementById('chat');
      const user = document.createElement('div'); user.className = 'bg-user-message'; user.style.cssText = 'padding:12px 16px;max-width:440px;margin:24px 0'; user.textContent = '保持壁纸清晰，让消息气泡有独立的毛玻璃背景。';
      const assistant = document.createElement('div'); assistant.dataset.responseAnnotationTarget = 'test'; assistant.style.cssText = 'max-width:500px;margin:24px 0';
      const markdown = document.createElement('div'); markdown.dataset.markdownTextStyle = 'assistant-message'; markdown.textContent = '背景只有暗色蒙板。气泡底下的画面单独模糊，文字保持清晰。'; assistant.append(markdown);
      const root = document.createElement('div'); root.dataset.codexComposerRoot = ''; root.style.cssText = 'width:490px;margin-top:24px';
      const surface = document.createElement('div'); surface.dataset.composerSurfaceVariant = 'default'; surface.style.padding = '8px'; root.append(surface);
      chat.before(user, assistant, root); surface.append(chat); chat.style.marginTop = '0'; chat.style.background = 'transparent';
    });
    await page.evaluate(() => { window.commands = []; window.codexSkinCommand = text => window.commands.push(JSON.parse(text)); });
    const install = cfg => page.evaluate(script => {
      // The test shadows only this lexical URL; production has an unconditional exact-app guard.
      return new Function('location', 'return ' + script)({ href: 'app://-/index.html' });
    }, makeManagerInjectionScript(cfg));
    const ui = page.locator('#codex-wallpaper-engine-skin-controls');

    await t.test('rejects non-Codex navigation', async () => {
      const result = await page.evaluate(script => eval(script), makeManagerInjectionScript(base));
      assert.equal(result.blocked, true);
      assert.equal(await ui.count(), 0);
    });
    await t.test('normal mode does not intercept chat input', async () => {
      assert.equal((await install(base)).installed, true);
      await page.locator('#chat').fill('可以正常输入和选择文字');
      assert.equal(await page.locator('#chat').inputValue(), '可以正常输入和选择文字');
      assert.equal(await ui.locator('[data-testid=wallpaper-adjust-overlay]').isVisible(), false);
      await ui.locator('[data-testid=wallpaper-launcher]').click();
      assert.equal(await ui.locator('[data-testid=wallpaper-panel]').isVisible(), true);
      assert.equal(await ui.locator('button[data-source-id]').count(), 2);
      await ui.locator('[aria-label=壁纸类型]').selectOption('video');
      assert.equal(await ui.locator('button[data-source-id]').count(), 1);
      await ui.locator('[aria-label=壁纸类型]').selectOption('all');
      await ui.locator('[aria-label=搜索本机壁纸]').fill('晨光');
      assert.equal(await ui.locator('button[data-source-id]').count(), 1);
      await ui.locator('[aria-label=搜索本机壁纸]').fill('');
    });
    await t.test('age checkboxes combine with search and media filters and survive reinjection', async () => {
      const rating = key => ui.locator('input[data-age-rating="' + key + '"]');
      assert.equal(await rating('G').isChecked(), true);
      assert.equal(await rating('PG-13').isChecked(), true);
      assert.equal(await rating('R-18').isChecked(), false);
      assert.equal(await rating('UNRATED').isChecked(), false);
      await rating('G').uncheck();
      assert.equal(await ui.locator('button[data-source-id]').count(), 1);
      await rating('R-18').check();
      assert.equal(await ui.locator('button[data-source-id]').count(), 2);
      await ui.locator('[aria-label=搜索本机壁纸]').fill('云层');
      assert.equal(await ui.locator('button[data-source-id]').count(), 1);
      await ui.locator('[aria-label=壁纸类型]').selectOption('image');
      assert.equal(await ui.locator('button[data-source-id]').count(), 0);
      await ui.locator('[aria-label=搜索本机壁纸]').fill('');
      await ui.locator('[aria-label=壁纸类型]').selectOption('all');
      await rating('PG-13').uncheck(); await rating('R-18').uncheck();
      assert.equal(await ui.locator('button[data-source-id]').count(), 0);
      await rating('UNRATED').check();
      assert.equal(await ui.locator('button[data-source-id]').count(), 1);
      await install(base);
      assert.equal(await rating('UNRATED').isChecked(), true);
      assert.equal(await rating('G').isChecked(), false);
      assert.equal(await ui.locator('button[data-source-id=unrated-one]').count(), 1);
      await rating('G').check(); await rating('PG-13').check(); await rating('UNRATED').uncheck();
      await page.screenshot({ path: resolve(output, 'manager-age-ratings.png') });
    });
    await t.test('slider/numeric changes synchronize, drag/wheel act only in adjustment', async () => {
      await ui.locator('[data-tab=picture]').click();
      const zoomNumber = ui.locator('[data-setting-number=zoom]');
      await zoomNumber.fill('150'); await zoomNumber.press('Enter');
      assert.equal(await ui.locator('[data-setting=zoom]').inputValue(), '150');
      assert.match(await page.locator('[data-wallpaper-media]').getAttribute('style'), /scale\(1\.5\)/);
      await ui.locator('[data-testid=wallpaper-adjust]').click();
      assert.equal(await ui.locator('[data-testid=wallpaper-adjust-overlay]').isVisible(), true);
      await page.mouse.move(170, 300); await page.mouse.down(); await page.mouse.move(298, 390); await page.mouse.up();
      assert.equal(await ui.locator('[data-setting-number=positionX]').inputValue(), '10');
      assert.equal(await ui.locator('[data-setting-number=positionY]').inputValue(), '10');
      const beforeWheel = Number(await zoomNumber.inputValue());
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(80);
      assert.ok(Number(await zoomNumber.inputValue()) > beforeWheel);
      await page.keyboard.press('Escape');
      assert.equal(await ui.locator('[data-testid=wallpaper-adjust-overlay]').isVisible(), false);
      const afterAdjustment = await zoomNumber.inputValue();
      await page.mouse.move(350, 400); await page.mouse.wheel(0, -100); await page.waitForTimeout(80);
      assert.equal(await zoomNumber.inputValue(), afterAdjustment);
      await page.locator('#chat').fill('调整结束，继续聊天');
      await page.evaluate(() => { window.passedEscape = 0; document.getElementById('chat').addEventListener('keydown', event => { if (event.key === 'Escape') window.passedEscape++; }); });
      await page.locator('#chat').press('Escape');
      assert.equal(await page.evaluate(() => window.passedEscape), 1);
      await ui.locator('[data-testid=wallpaper-reset]').click();
      assert.equal(await zoomNumber.inputValue(), '100');
      assert.equal(await ui.locator('[data-setting-number=positionX]').inputValue(), '0');
      const opacityNumber = ui.locator('[data-setting-number=panelOpacity]');
      await opacityNumber.fill('0'); await opacityNumber.press('Enter');
      assert.equal(await ui.locator('[data-setting=panelOpacity]').inputValue(), '0');
      const clearLayer = await page.locator('#codex-wallpaper-engine-skin > div').last().evaluate(element => ({ backdrop: element.style.backdropFilter, background: element.style.background }));
      assert.equal(clearLayer.backdrop, 'none');
      assert.match(clearLayer.background, /, 0\)$/);
    });
    await t.test('floating panel and launcher can be dragged', async () => {
      const panel = ui.locator('[data-testid=wallpaper-panel]');
      const previous = await panel.boundingBox();
      await ui.locator('.header').hover({ position: { x: 80, y: 25 } });
      await page.mouse.down(); await page.mouse.move(previous.x - 100 + 80, previous.y - 40 + 25); await page.mouse.up();
      const moved = await panel.boundingBox();
      assert.ok(Math.abs(moved.x - (previous.x - 100)) < 2);
      const button = ui.locator('[data-testid=wallpaper-launcher]');
      const buttonPrevious = await button.boundingBox();
      await button.hover(); await page.mouse.down(); await page.mouse.move(buttonPrevious.x - 120, buttonPrevious.y - 30); await page.mouse.up();
      const buttonMoved = await button.boundingBox();
      assert.ok(buttonMoved.x < buttonPrevious.x - 80);
      assert.equal(await panel.isVisible(), true);
    });
    await t.test('message and composer blur are independent of the sharp wallpaper', async () => {
      const setNumber = async (key, value) => { const field = ui.locator('[data-setting-number=' + key + ']'); await field.fill(String(value)); await field.press('Enter'); };
      await setNumber('scrimOpacity', 30);
      await setNumber('bubbleBlurPx', 24);
      await setNumber('bubbleOpacity', 34);
      for (const selector of ['.bg-user-message', '[data-response-annotation-target]', '[data-composer-surface-variant]']) {
        const actual = await page.locator(selector).evaluate(element => ({ backdrop: getComputedStyle(element).backdropFilter, filter: getComputedStyle(element).filter, radius: getComputedStyle(element).borderRadius }));
        assert.match(actual.backdrop, /blur\(24px\)/);
        assert.equal(actual.filter, 'none', 'only the background is blurred');
        assert.equal(actual.radius, '20px');
      }
      assert.equal(await page.locator('#codex-wallpaper-engine-skin > div').last().evaluate(element => getComputedStyle(element).backdropFilter), 'none');
      assert.equal(await page.locator('[data-wallpaper-media]').evaluate(element => getComputedStyle(element).filter), 'none');
      await page.locator('#chat').fill('输入框继续正常使用');
      await setNumber('bubbleBlurPx', 18);
    });
    await t.test('light and dark screenshots, panel survives reinjection', async () => {
      await ui.locator('[data-tab=picture]').click();
      await page.screenshot({ path: resolve(output, 'manager-light.png') });
      await page.evaluate(() => { document.documentElement.className = 'dark'; document.documentElement.style.colorScheme = 'dark'; document.body.style.color = '#edf2fa'; });
      await page.waitForTimeout(60);
      await page.screenshot({ path: resolve(output, 'manager-dark.png') });
      await ui.locator('[data-tab=library]').click();
      await ui.locator('[data-source-id=video-one]').click();
      await page.waitForTimeout(180);
      assert.ok((await page.evaluate(() => window.commands)).some(command => command.action === 'select' && command.id === 'video-one'));
      await install({ ...base, currentId: 'image-two' });
      assert.equal(await ui.locator('[data-testid=wallpaper-panel]').isVisible(), true);
    });
    await t.test('volume controls only wallpaper audio; disabled layer retains manager', async () => {
      await install({ ...base, mode: 'video', mediaUrl: null, currentId: 'video-one', muted: true, volume: .35 });
      await ui.locator('[data-tab=sound]').click();
      const volume = ui.locator('[data-setting-number=volume]');
      await volume.fill('70'); await volume.press('Enter');
      const audioState = await page.evaluate(() => ({ wallpaper: document.querySelector('[data-wallpaper-media]').volume, muted: document.querySelector('[data-wallpaper-media]').muted, unrelated: document.getElementById('unrelated-audio').volume }));
      assert.equal(audioState.wallpaper, .7); assert.equal(audioState.muted, false); assert.equal(audioState.unrelated, 1);
      await ui.locator('[data-testid=wallpaper-enabled]').click();
      assert.equal(await page.locator('#codex-wallpaper-engine-skin').isVisible(), false);
      assert.equal(await ui.locator('[data-testid=wallpaper-launcher]').isVisible(), true);
      assert.equal(await ui.locator('[data-testid=wallpaper-panel]').isVisible(), true);
      await ui.locator('[data-testid=wallpaper-enabled]').click();
      assert.equal(await page.locator('#codex-wallpaper-engine-skin').isVisible(), true);
    });
    await t.test('file preview gets a glass surface without blocking selection, scrolling or controls', async () => {
      await page.evaluate(() => {
        const aside = document.createElement('aside'); aside.dataset.appShellFocusArea = 'right-panel'; aside.style.cssText = 'position:fixed;left:310px;top:60px;width:430px;height:550px;z-index:2';
        const tabs = document.createElement('div'); tabs.dataset.appShellTabs = 'true'; tabs.style.cssText = 'display:flex;height:100%;flex-direction:column';
        const gutter = document.createElement('div'); gutter.id = 'file-gutter'; gutter.style.cssText = 'background:var(--app-shell-panel-background,rgb(24,24,24));display:flex;min-height:0;flex:1';
        const panel = document.createElement('div'); panel.dataset.appShellTabPanelController = 'right'; panel.id = 'file-preview-test'; panel.style.cssText = 'min-width:0;min-height:0;flex:1;display:flex;flex-direction:column';
        const header = document.createElement('header'); header.dataset.viewerDensity = 'compact'; header.style.cssText = 'padding:14px 16px;font-size:15px;margin:0'; header.textContent = 'Document preview.md';
        const copy = document.createElement('button'); copy.id = 'file-copy-test'; copy.textContent = '复制'; copy.addEventListener('click', () => { window.fileCopyClicks = (window.fileCopyClicks || 0) + 1; }); header.append(copy);
        const documentBody = document.createElement('div'); documentBody.id = 'file-preview-scroll'; documentBody.style.cssText = 'overflow:auto;min-height:0;flex:1;padding:16px;line-height:1.8';
        for (let index = 0; index < 18; index++) { const paragraph = document.createElement('p'); paragraph.textContent = index === 0 ? '这是清晰可选择的文件正文。' : '正文保持原有阅读、滚动和复制操作。透明背景和聊天气泡使用同一组参数。'; documentBody.append(paragraph); }
        panel.append(header, documentBody); gutter.append(panel); tabs.append(gutter); aside.append(tabs); document.getElementById('app').append(aside);
      });
      const panel = page.locator('#file-preview-test');
      const appearance = await panel.evaluate(element => ({ backdrop: getComputedStyle(element).backdropFilter, filter: getComputedStyle(element).filter, radius: getComputedStyle(element).borderRadius }));
      assert.match(appearance.backdrop, /blur\(18px\)/);
      assert.equal(appearance.filter, 'none');
      assert.equal(appearance.radius, '20px');
      assert.equal(await page.locator('#file-gutter').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
      await page.locator('#file-copy-test').click();
      assert.equal(await page.evaluate(() => window.fileCopyClicks), 1);
      await page.locator('#file-preview-scroll').evaluate(element => { const range = document.createRange(); range.selectNodeContents(element.firstElementChild); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); element.scrollTop = 240; });
      assert.match(await page.evaluate(() => getSelection().toString()), /清晰可选择/);
      assert.ok(await page.locator('#file-preview-scroll').evaluate(element => element.scrollTop) > 0);
      await page.screenshot({ path: resolve(output, 'manager-file-glass.png') });
    });
    await t.test('empty library keeps the manager and a refresh action available', async () => {
      await install({ ...base, mode: 'library', mediaUrl: null, sourceOptions: [], currentId: '@library' });
      await ui.locator('[data-tab=library]').click();
      assert.equal(await ui.locator('button[data-source-id]').count(), 0);
      assert.match(await ui.locator('.empty').textContent(), /请先下载壁纸/);
      await ui.locator('[data-testid=wallpaper-refresh-library]').click();
      assert.ok((await page.evaluate(() => window.commands)).some(command => command.action === 'refresh-library'));
    });
    await t.test('complete cleanup does not save stale settings', async () => {
      const before = await page.evaluate(() => window.commands.length);
      await page.evaluate(script => new Function('location', 'return ' + script)({ href: 'app://-/index.html' }), makeManagerRemovalScript());
      assert.equal(await ui.count(), 0);
      assert.equal(await page.locator('#codex-wallpaper-engine-skin').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-codex-wallpaper')), false);
      assert.equal(await page.locator('#file-preview-test').evaluate(element => getComputedStyle(element).backdropFilter), 'none');
      assert.equal(await page.locator('#file-gutter').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(24, 24, 24)');
      await page.waitForTimeout(180);
      assert.equal(await page.evaluate(() => window.commands.length), before);
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
