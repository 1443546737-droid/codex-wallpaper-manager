/* Local Codex wallpaper controls. The bridge supplies only enumerated local media. */
function installWallpaperManager(input) {
  if (location.href !== 'app://-/index.html') return { installed: false, blocked: true };
  if (!document.body) {
    if (window.__codexWallpaperPendingInstall) document.removeEventListener('DOMContentLoaded', window.__codexWallpaperPendingInstall);
    window.__codexWallpaperPendingInstall = () => { window.__codexWallpaperPendingInstall = null; installWallpaperManager(input); };
    document.addEventListener('DOMContentLoaded', window.__codexWallpaperPendingInstall, { once: true });
    return { installed: false, pending: true };
  }
  window.__codexWallpaperManagerCleanup?.();
  window.__codexWallpaperPauseCleanup?.();
  if (window.__codexWallpaperFrameTimer) cancelAnimationFrame(window.__codexWallpaperFrameTimer);
  if (window.__codexWallpaperBlobUrl) URL.revokeObjectURL(window.__codexWallpaperBlobUrl);
  window.__codexWallpaperFrameTimer = null;
  window.__codexWallpaperBlobUrl = null;
  window.__codexWallpaperFrameCache = null;
  window.__codexWallpaperVideoChunks = null;
  const id = 'codex-wallpaper-engine-skin';
  [id, id + '-style', id + '-controls'].forEach(name => document.getElementById(name)?.remove());
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const cfg = {
    ...input, enabled: input.enabled !== false, muted: input.muted !== false,
    volume: clamp(input.volume, 0, 1, .35), panelOpacity: clamp(input.panelOpacity, 0, 1, 0),
    scrimOpacity: clamp(input.scrimOpacity, 0, .8, 0), blurPx: clamp(input.blurPx, 0, 40, 0),
    bubbleBlurPx: clamp(input.bubbleBlurPx, 0, 40, 18), bubbleOpacity: clamp(input.bubbleOpacity, 0, .8, .34),
    fitMode: ['cover', 'contain', 'fill'].includes(input.fitMode) ? input.fitMode : 'cover',
    zoom: clamp(input.zoom, 50, 300, 100), positionX: clamp(input.positionX, 0, 100, 50),
    positionY: clamp(input.positionY, 0, 100, 50), sourceOptions: Array.isArray(input.sourceOptions) ? input.sourceOptions : [],
  };
  const listeners = [];
  const on = (target, name, handler, options) => { target.addEventListener(name, handler, options); listeners.push(() => target.removeEventListener(name, handler, options)); };
  const node = (tag, attrs = {}, text) => {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') element.className = value;
      else element.setAttribute(key, String(value));
    }
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const command = value => {
    try { if (typeof window.codexSkinCommand === 'function') window.codexSkinCommand(JSON.stringify(value)); } catch { /* window may close while saving */ }
  };
  let saveTimer;
  const persist = (immediate = false) => {
    clearTimeout(saveTimer);
    const save = () => command({ action: 'settings', id: cfg.currentId, settings: {
      panelOpacity: cfg.panelOpacity, scrimOpacity: cfg.scrimOpacity, blurPx: cfg.blurPx,
      bubbleBlurPx: cfg.bubbleBlurPx, bubbleOpacity: cfg.bubbleOpacity,
      fitMode: cfg.fitMode, zoom: cfg.zoom, positionX: cfg.positionX, positionY: cfg.positionY,
      volume: cfg.volume, muted: cfg.muted,
    } });
    if (immediate) save(); else saveTimer = setTimeout(save, 140);
  };
  let ui;
  try { ui = window.__codexWallpaperUiState || JSON.parse(localStorage.getItem('codex-wallpaper-manager-ui-v1') || '{}'); } catch { ui = {}; }
  const ratingKeys = ['G', 'PG-13', 'R-18', 'UNRATED'];
  ui = { ...ui, open: Boolean(ui.open), tab: ['library', 'picture', 'sound'].includes(ui.tab) ? ui.tab : 'library',
    ageRatings: Array.isArray(ui.ageRatings) ? [...new Set(ui.ageRatings.filter(value => ratingKeys.includes(value)))] : ['G', 'PG-13'] };
  const saveUi = () => {
    window.__codexWallpaperUiState = ui;
    window.__codexWallpaperControlsOpen = ui.open;
    try { localStorage.setItem('codex-wallpaper-manager-ui-v1', JSON.stringify(ui)); } catch { /* optional geometry memory */ }
  };

  const layer = node('div', { id, 'aria-hidden': 'true' });
  layer.style.cssText = 'position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:#101317;isolation:isolate';
  const videoMode = cfg.mode === 'video' || cfg.mode === 'video-blob';
  const media = node(videoMode ? 'video' : cfg.mode === 'frames' ? 'canvas' : 'img');
  media.dataset.wallpaperMedia = 'true';
  media.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;border:0;pointer-events:none;transform-origin:center;will-change:transform';
  if (videoMode) {
    media.autoplay = true; media.loop = true; media.playsInline = true; media.muted = cfg.muted; media.volume = cfg.volume;
    if (cfg.mode === 'video-blob') { if (cfg.mediaUrl) media.poster = cfg.mediaUrl; }
    else if (cfg.mediaUrl) media.src = cfg.mediaUrl;
  } else if (cfg.mode !== 'frames' && cfg.mediaUrl) { media.src = cfg.mediaUrl; media.alt = ''; }
  layer.append(media);
  const scrim = node('div');
  scrim.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  layer.append(scrim);
  const interfaceTint = node('div');
  interfaceTint.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  layer.append(interfaceTint);
  document.body.prepend(layer);

  const style = node('style', { id: id + '-style' });
  style.textContent = `
    html[data-codex-wallpaper="on"],html[data-codex-wallpaper="on"] body{background:transparent!important}
    html[data-codex-wallpaper="on"] body>div:not(#${id}):not(#${id}-controls){position:relative!important;z-index:1!important;background:transparent!important}
    html[data-codex-wallpaper="on"] body{
      --color-token-bg-primary:transparent;
      --color-token-bg-secondary:transparent;
      --color-token-bg-tertiary:transparent;
      --color-token-main-surface-primary:transparent;
      --color-token-sidebar-surface-primary:transparent;
    }
    html[data-codex-wallpaper="on"] main,html[data-codex-wallpaper="on"] aside,
    html[data-codex-wallpaper="on"] nav,html[data-codex-wallpaper="on"] header,
    html[data-codex-wallpaper="on"] section,
    html[data-codex-wallpaper="on"] [role="navigation"],html[data-codex-wallpaper="on"] [role="main"],
    html[data-codex-wallpaper="on"] [class*="bg-surface"],html[data-codex-wallpaper="on"] [class*="bg-elevated"],
    html[data-codex-wallpaper="on"] [class*="bg-token-bg-"],html[data-codex-wallpaper="on"] [class*="bg-token-sidebar-surface"],
    html[data-codex-wallpaper="on"] [class*="bg-token-main-surface"]{
      background-color:transparent!important;
      backdrop-filter:none!important;
    }
    html[data-codex-wallpaper="on"] [data-radix-popper-content-wrapper],html[data-codex-wallpaper="on"] [role="dialog"],
    html[data-codex-wallpaper="on"] [role="menu"]{
      background-color:rgba(var(--codex-skin-panel-rgb),.95)!important;
      backdrop-filter:blur(var(--codex-skin-blur))!important;
    }
    html[data-codex-wallpaper="on"] .bg-user-message,
    html[data-codex-wallpaper="on"] [data-response-annotation-target]:has(> [data-markdown-text-style="assistant-message"]:not(:empty)),
    html[data-codex-wallpaper="on"] [data-codex-composer-root] [data-composer-surface-variant],
    html[data-codex-wallpaper="on"] [data-app-shell-tab-panel-controller="right"]:has([data-viewer-density]){
      background:linear-gradient(135deg,#ffffff12,#ffffff03),rgba(var(--codex-skin-glass-rgb),var(--codex-skin-glass-opacity))!important;
      backdrop-filter:blur(var(--codex-skin-bubble-blur)) saturate(1.08)!important;
      -webkit-backdrop-filter:blur(var(--codex-skin-bubble-blur)) saturate(1.08)!important;
      border-radius:20px!important;
      box-shadow:0 0 0 1px rgba(var(--codex-skin-glass-edge-rgb),.18),inset 0 1px 0 #ffffff16,0 6px 22px #00000016!important;
    }
    html[data-codex-wallpaper="on"] [data-response-annotation-target]:has(> [data-markdown-text-style="assistant-message"]:not(:empty)){
      padding:12px 16px;box-sizing:border-box;min-width:0;
    }
    html[data-codex-wallpaper="on"] [data-codex-composer-root] [data-composer-surface-variant]::before,
    html[data-codex-wallpaper="on"] [data-codex-composer-root] [data-composer-surface-variant]::after{
      background:transparent!important;
    }
    html[data-codex-wallpaper="on"] [data-app-shell-focus-area="right-panel"] [data-app-shell-tabs="true"]:has([data-viewer-density]){
      --app-shell-panel-background:transparent;
    }
    html[data-codex-wallpaper="on"] [data-app-shell-tab-panel-controller="right"]:has([data-viewer-density]){
      margin:8px;overflow:hidden;
    }
    html[data-codex-wallpaper="on"] [data-app-shell-tab-panel-controller="right"] [data-editor-search-surface]{
      background-color:transparent!important;
    }
  `;
  document.head.append(style);

  const host = node('div', { id: id + '-controls' });
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:none!important;isolation:isolate';
  const shadow = host.attachShadow({ mode: 'open' });
  const managerStyle = node('style');
  managerStyle.textContent = `
    :host{font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#edf3fd;color-scheme:dark;--accent:#82b4ff}
    *{box-sizing:border-box} button,input,select{font:inherit} button{cursor:pointer}button:disabled{cursor:default;opacity:.45}
    button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .launcher{position:fixed;right:20px;bottom:24px;pointer-events:auto;border:1px solid #ffffff26;border-radius:15px;background:#202734ee;color:#edf3fd;box-shadow:0 5px 20px #0005;padding:9px 13px;display:flex;align-items:center;gap:7px;touch-action:none;user-select:none;backdrop-filter:blur(16px)}
    .launcher:hover{background:#2d3b50}.launcher svg{width:17px;height:17px}.launcher .indicator{width:6px;height:6px;border-radius:50%;background:#88d7a5}
    .panel{position:fixed;right:20px;bottom:78px;width:370px;max-width:calc(100vw - 24px);max-height:min(700px,calc(100vh - 80px));pointer-events:auto;background:linear-gradient(145deg,#202936f5,#141a25f8);border:1px solid #c1d5f52c;border-radius:18px;box-shadow:0 16px 60px #0008;backdrop-filter:blur(22px);overflow:hidden;display:flex;flex-direction:column}
    .panel[hidden]{display:none}.header{padding:15px 16px 11px;display:flex;justify-content:space-between;align-items:center;cursor:move;touch-action:none;user-select:none}.heading{font-size:15px;font-weight:650;letter-spacing:.3px}.subtitle{font-size:11px;color:#aebcd0;margin-top:2px}.icon{border:0;background:transparent;color:#bac9df;border-radius:7px;padding:5px 8px;font-size:17px}.icon:hover{background:#ffffff12;color:white}
    .body{padding:0 16px 15px;overflow:auto;scrollbar-width:thin;scrollbar-color:#4d5c73 transparent}.topline{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}.status{font-size:11px;color:#aebcd0;line-height:1.5;overflow-wrap:anywhere}.status.error{color:#ffb8b8}.status.success{color:#9addba}
    .pill{border:1px solid #ffffff24;background:#ffffff0a;color:#dbe8fb;border-radius:8px;padding:5px 9px;font-size:11px;white-space:nowrap}.pill:hover{background:#ffffff16}.pill.on{border-color:#7db9ff77;color:#c8e0ff;background:#3b76bb25}
    .tabs{display:flex;gap:4px;background:#0b111b66;padding:4px;border-radius:10px;margin:10px 0 14px}.tab{flex:1;border:0;border-radius:7px;background:transparent;color:#9fb0c7;padding:7px 3px}.tab[aria-selected=true]{background:#ffffff15;color:#eff6ff;box-shadow:0 1px 3px #0002}
    .view[hidden]{display:none}.row{display:grid;grid-template-columns:70px minmax(50px,1fr) 58px;align-items:center;gap:8px;margin:11px 0}.row input[type=range]{min-width:0;width:100%;accent-color:var(--accent)}.row input[type=number]{width:58px;text-align:right;padding:4px 5px;border-radius:6px;border:1px solid #ffffff20;background:#080d1699;color:#edf3fd;appearance:textfield}.row input::-webkit-inner-spin-button{opacity:.6}.row .label{font-size:12px;color:#c5d1e3}
    .select{border:1px solid #ffffff20;background:#121b29;color:#edf3fd;border-radius:7px;padding:7px 8px;min-width:0}.fitrow{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:10px 0}.fitrow select{flex:1}.hint{font-size:11px;color:#97a9c1;margin:9px 0 12px}.actions{display:flex;gap:7px;margin:13px 0 2px}.primary{border:1px solid #91bfff66;color:#e6f1ff;background:#477bb933;border-radius:9px;padding:8px 10px;flex:1}.primary:hover{background:#477bb955}.secondary{border:1px solid #ffffff22;background:#ffffff08;color:#cddbef;border-radius:9px;padding:8px 10px}.separator{height:1px;background:#ffffff12;margin:16px 0}.section{font-size:11px;color:#99acc7;font-weight:600;letter-spacing:.4px;margin-top:13px}
    .searchrow{display:flex;gap:7px;margin:5px 0 11px}.search{width:100%;min-width:0;border:1px solid #ffffff20;background:#0b111a99;color:#f0f5ff;border-radius:8px;padding:8px 9px}.search::placeholder{color:#7f92ae}.filter{width:78px}.library{display:grid;grid-template-columns:1fr 1fr;gap:9px;max-height:330px;overflow:auto;padding:2px}.card{position:relative;min-width:0;text-align:left;color:#dfe9f8;padding:0;border:1px solid #ffffff17;border-radius:10px;background:#111924;overflow:hidden}.card:hover{border-color:#8ebdff77}.card.selected{border-color:#86b9ff;box-shadow:0 0 0 1px #86b9ff66}.thumb{height:78px;background:linear-gradient(140deg,#354a60,#1c2839);display:flex;align-items:center;justify-content:center;color:#a4b7ce;font-size:25px}.thumb img{width:100%;height:100%;object-fit:cover;display:block}.cardtitle{font-size:11px;padding:7px 8px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tag{font-size:10px;color:#829ab8;padding:0 8px 7px}.check{position:absolute;right:6px;top:6px;border-radius:50%;width:18px;height:18px;background:#8ebdff;color:#10233c;text-align:center;font-size:12px;font-weight:700}.empty{grid-column:1/-1;color:#9db0cb;text-align:center;padding:22px 6px;font-size:12px}.count{color:#8197b5;font-size:10px;margin-top:9px}
    .ratings{min-width:0;border:1px solid #ffffff16;border-radius:10px;padding:6px 10px 8px;margin:0 0 11px;background:#ffffff03}.ratings legend{font-size:11px;color:#aebfd7;padding:0 4px}.rating-option{display:flex;align-items:center;gap:8px;margin:5px 0;color:#dae5f5;font-size:12px;cursor:pointer}.rating-option input{width:14px;height:14px;margin:0;accent-color:var(--accent)}.rating-count{margin-left:auto;font-size:10px;color:#8197b5}.rating-hint{font-size:10px;color:#8197b5;margin:6px 0 0;line-height:1.5}
    .soundmain{padding:14px 12px;border:1px solid #ffffff16;border-radius:12px;background:#ffffff04}.soundtitle{font-size:12px;margin-bottom:6px}.soundhint{font-size:11px;color:#9bafca}.progress{height:4px;border-radius:3px;background:#ffffff16;margin:7px 0 12px;overflow:hidden}.progress[hidden]{display:none}.fill{height:100%;width:0;background:#82b4ff;transition:width .12s}.indeterminate{animation:loading 1s ease-in-out infinite;width:30%}@keyframes loading{0%{transform:translateX(-110%)}100%{transform:translateX(450%)}}
    .adjust{position:fixed;inset:0;pointer-events:auto;cursor:grab;border:3px solid #8bbbffb3;background:#87b9ff03;touch-action:none}.adjust[hidden]{display:none}.adjust:active{cursor:grabbing}.adjustnote{position:absolute;top:18px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:15px;white-space:nowrap;padding:9px 12px;border-radius:10px;color:#e7f0ff;background:#141d2ded;box-shadow:0 5px 25px #0004}.adjustnote button{border:1px solid #8bbbff66;border-radius:6px;color:#dceaff;background:#467bbc3d;padding:3px 9px}
    @media(max-width:520px){.panel{width:calc(100vw - 24px);right:12px}.adjustnote{font-size:11px;gap:8px}.launcher{bottom:15px;right:15px}}
  `;
  shadow.append(managerStyle);
  const overlay = node('div', { className: 'adjust', hidden: '', 'data-testid': 'wallpaper-adjust-overlay' });
  const adjustNote = node('div', { className: 'adjustnote' });
  adjustNote.append(node('span', {}, '拖动平移 · 滚轮缩放 · Esc 退出'));
  const done = node('button', { type: 'button' }, '完成'); adjustNote.append(done); overlay.append(adjustNote); shadow.append(overlay);
  const launcher = node('button', { type: 'button', className: 'launcher', 'aria-label': '打开壁纸管理器', title: '壁纸管理 · 可拖动按钮', 'data-testid': 'wallpaper-launcher' });
  launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="9" r="1.6" fill="currentColor"/><path d="m4 17 5-5 4 4 3-3 4 4" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  launcher.append(node('span', {}, '壁纸'), node('span', { className: 'indicator' }));
  const panel = node('section', { className: 'panel', role: 'dialog', 'aria-label': '壁纸管理器', 'aria-modal': 'false', 'data-testid': 'wallpaper-panel' });
  const header = node('div', { className: 'header' });
  const heading = node('div'); heading.append(node('div', { className: 'heading' }, '壁纸管理'), node('div', { className: 'subtitle' }, 'Wallpaper Engine · Codex 独立壁纸'));
  const close = node('button', { type: 'button', className: 'icon', 'aria-label': '关闭壁纸管理器' }, '×'); header.append(heading, close); panel.append(header);
  const body = node('div', { className: 'body' }); panel.append(body);
  const topLine = node('div', { className: 'topline' });
  const status = node('div', { className: 'status', role: 'status' });
  const enabled = node('button', { type: 'button', className: 'pill', 'data-testid': 'wallpaper-enabled' });
  topLine.append(status, enabled); body.append(topLine);
  const progress = node('div', { className: 'progress', hidden: '', role: 'progressbar', 'aria-label': '壁纸加载进度' });
  const fill = node('div', { className: 'fill' }); progress.append(fill); body.append(progress);
  const tabs = node('div', { className: 'tabs', role: 'tablist', 'aria-label': '壁纸管理分类' }); body.append(tabs);
  const views = {}, tabButtons = {};
  for (const [key, label] of [['library', '壁纸库'], ['picture', '画面'], ['sound', '声音']]) {
    const tab = node('button', { type: 'button', className: 'tab', role: 'tab', 'data-tab': key }, label);
    const view = node('div', { className: 'view', role: 'tabpanel', 'aria-label': label });
    tabButtons[key] = tab; views[key] = view; tabs.append(tab); body.append(view);
    on(tab, 'click', () => { ui.tab = key; showTab(); saveUi(); });
  }
  function showTab() { for (const key of Object.keys(views)) { views[key].hidden = ui.tab !== key; tabButtons[key].setAttribute('aria-selected', String(ui.tab === key)); } }
  const setStatus = (text, tone = '') => { status.textContent = text; status.className = 'status' + (tone ? ' ' + tone : ''); };
  const setProgress = (percent, state = 'loading') => {
    progress.hidden = false; fill.style.background = state === 'error' ? '#f59191' : state === 'done' ? '#8dd1ab' : '#82b4ff';
    fill.classList.toggle('indeterminate', percent === null);
    if (percent === null) progress.removeAttribute('aria-valuenow');
    else { const value = clamp(percent, 0, 100, 0); fill.style.width = value + '%'; progress.setAttribute('aria-valuenow', String(Math.round(value))); }
  };
  const refreshEnabled = () => {
    document.documentElement.toggleAttribute('data-codex-wallpaper', cfg.enabled);
    if (cfg.enabled) document.documentElement.setAttribute('data-codex-wallpaper', 'on');
    layer.hidden = !cfg.enabled;
    enabled.textContent = cfg.enabled ? '已开启' : '已关闭'; enabled.classList.toggle('on', cfg.enabled); enabled.setAttribute('aria-pressed', String(cfg.enabled));
    launcher.querySelector('.indicator').style.background = cfg.enabled ? '#88d7a5' : '#8390a1';
  };

  let adjustMode = false, userPaused = false, audioBlocked = false, disposed = false;
  let frameRequest = 0, frameImages = [], frameIndex = 0, lastFrame = 0;
  const values = new Map();
  const applyPicture = () => {
    media.style.objectFit = cfg.fitMode;
    media.style.objectPosition = '50% 50%';
    // Translate independently of object-position, which cannot pan equal-aspect content.
    media.style.transform = 'translate(' + ((cfg.positionX - 50) * 2) + '%,' + ((cfg.positionY - 50) * 2) + '%) scale(' + cfg.zoom / 100 + ')';
    document.documentElement.style.setProperty('--codex-skin-panel-opacity', cfg.panelOpacity);
    document.documentElement.style.setProperty('--codex-skin-blur', cfg.blurPx + 'px');
    const root = document.documentElement;
    const light = root.classList.contains('light') || root.dataset.theme === 'light' ||
      (!root.classList.contains('dark') && root.dataset.theme !== 'dark' && getComputedStyle(root).colorScheme === 'light');
    document.documentElement.style.setProperty('--codex-skin-panel-rgb', light ? '247,249,252' : '24,27,33');
    root.style.setProperty('--codex-skin-glass-rgb', light ? '245,247,252' : '20,23,32');
    root.style.setProperty('--codex-skin-glass-edge-rgb', light ? '80,95,120' : '245,248,255');
    root.style.setProperty('--codex-skin-glass-opacity', cfg.bubbleOpacity);
    root.style.setProperty('--codex-skin-bubble-blur', cfg.bubbleBlurPx + 'px');
    scrim.style.background = 'rgba(0,0,0,' + cfg.scrimOpacity + ')';
    interfaceTint.style.background = 'rgba(' + (light ? '247,249,252' : '24,27,33') + ',' + cfg.panelOpacity + ')';
    interfaceTint.style.backdropFilter = cfg.blurPx > 0 ? 'blur(' + cfg.blurPx + 'px) saturate(1.08)' : 'none';
  };
  const refreshValues = () => { for (const [key, item] of values) { const value = item.read(); item.range.value = String(value); item.number.value = String(value); } };
  const pictureChanged = () => { applyPicture(); refreshValues(); persist(); };
  function addControl(container, label, key, min, max, step, read, write) {
    const row = node('label', { className: 'row' }); row.append(node('span', { className: 'label' }, label));
    const range = node('input', { type: 'range', min, max, step, 'aria-label': label, 'data-setting': key });
    const number = node('input', { type: 'number', min, max, step, 'aria-label': label + '数值', 'data-setting-number': key });
    range.value = number.value = String(read());
    const update = raw => { if (raw === '') return; const value = clamp(Number(raw), min, max, read()); write(value); range.value = number.value = String(value); };
    on(range, 'input', () => update(range.value)); on(number, 'change', () => update(number.value));
    on(number, 'keydown', event => { if (event.key === 'Enter') { update(number.value); number.blur(); } });
    row.append(range, number); container.append(row); values.set(key, { range, number, read });
  }
  const searchRow = node('div', { className: 'searchrow' });
  const search = node('input', { type: 'search', className: 'search', placeholder: '搜索本机壁纸…', 'aria-label': '搜索本机壁纸' });
  const filter = node('select', { className: 'select filter', 'aria-label': '壁纸类型' });
  for (const [value, text] of [['all', '全部'], ['video', '视频'], ['image', '图片']]) filter.append(node('option', { value }, text));
  searchRow.append(search, filter); views.library.append(searchRow);
  const ratingOf = item => ratingKeys.includes(item.ageRating) ? item.ageRating : 'UNRATED';
  const ratingLabels = { G: '大众级（G）', 'PG-13': '家长指导级（PG-13）', 'R-18': '限制级/成人级（R-18）', UNRATED: '未标注分级' };
  const ratings = node('fieldset', { className: 'ratings', 'data-testid': 'wallpaper-age-ratings' });
  ratings.append(node('legend', {}, '年龄分级'));
  for (const key of ratingKeys) {
    const total = cfg.sourceOptions.filter(item => ratingOf(item) === key).length;
    if (key === 'UNRATED' && !total) continue;
    const label = node('label', { className: 'rating-option' });
    const checkbox = node('input', { type: 'checkbox', 'data-age-rating': key, 'aria-label': ratingLabels[key] });
    checkbox.checked = ui.ageRatings.includes(key);
    label.append(checkbox, node('span', {}, ratingLabels[key]), node('span', { className: 'rating-count' }, String(total)));
    ratings.append(label);
    on(checkbox, 'change', () => { ui.ageRatings = [...ratings.querySelectorAll('input:checked')].map(input => input.dataset.ageRating); saveUi(); renderLibrary(); });
  }
  ratings.append(node('div', { className: 'rating-hint' }, '按本机项目的分级标记筛选，可同时勾选。'));
  views.library.append(ratings);
  const library = node('div', { className: 'library' }); views.library.append(library);
  const libraryFooter = node('div'); libraryFooter.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px';
  const count = node('div', { className: 'count' }); count.style.marginTop = '0';
  const refreshLibrary = node('button', { type: 'button', className: 'pill', 'data-testid': 'wallpaper-refresh-library' }, '刷新');
  libraryFooter.append(count, refreshLibrary); views.library.append(libraryFooter);
  on(refreshLibrary, 'click', () => { persist(true); setStatus('正在刷新本机壁纸…'); command({ action: 'refresh-library' }); });
  const kindOf = item => item.labelType || (item.type === 'video' ? 'video' : 'image');
  const renderLibrary = () => {
    library.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    const sources = cfg.sourceOptions.filter(item => ui.ageRatings.includes(ratingOf(item)) && (filter.value === 'all' || kindOf(item) === filter.value) && String(item.title || item.id).toLocaleLowerCase().includes(query));
    for (const item of sources) {
      const selected = item.id === cfg.currentId;
      const card = node('button', { type: 'button', className: 'card' + (selected ? ' selected' : ''), title: item.title, 'data-source-id': item.id, 'data-age-rating': ratingOf(item), 'aria-pressed': selected });
      const thumb = node('div', { className: 'thumb' });
      if (typeof item.thumbnail === 'string' && /^data:image\//.test(item.thumbnail)) { thumb.append(node('img', { src: item.thumbnail, alt: '', loading: 'lazy' })); }
      else thumb.textContent = kindOf(item) === 'video' ? '▷' : '▧';
      card.append(thumb, node('div', { className: 'cardtitle' }, item.title || item.id), node('div', { className: 'tag' }, (kindOf(item) === 'video' ? '视频' : item.type === 'scene' || item.type === 'web' ? '图片 · 项目预览' : '图片') + ' · ' + (ratingOf(item) === 'UNRATED' ? '未标注' : ratingOf(item))));
      if (selected) card.append(node('span', { className: 'check', 'aria-label': '当前壁纸' }, '✓'));
      library.append(card);
    }
    if (!sources.length) library.append(node('div', { className: 'empty' }, cfg.sourceOptions.length ? '没有匹配的壁纸' : '本机未找到兼容项目，请先下载壁纸后点击刷新。'));
    count.textContent = '显示 ' + sources.length + ' / ' + cfg.sourceOptions.length + ' 张 · 调整只影响 Codex';
  };
  on(library, 'click', event => {
    const card = event.target.closest('button[data-source-id]');
    if (!card || card.dataset.sourceId === cfg.currentId) return;
    persist(true); setAdjust(false); setStatus('正在切换壁纸…'); setProgress(null); command({ action: 'select', id: card.dataset.sourceId });
  });
  on(search, 'input', renderLibrary); on(filter, 'change', renderLibrary);

  const fitRow = node('label', { className: 'fitrow' }); fitRow.append(node('span', { className: 'label' }, '画面适配'));
  const fit = node('select', { className: 'select', 'aria-label': '画面适配' });
  for (const [value, text] of [['cover', '铺满裁切'], ['contain', '完整显示'], ['fill', '拉伸铺满']]) fit.append(node('option', { value }, text));
  fit.value = cfg.fitMode; fitRow.append(fit); views.picture.append(fitRow);
  on(fit, 'change', () => { cfg.fitMode = fit.value; pictureChanged(); });
  addControl(views.picture, '缩放 %', 'zoom', 50, 300, 1, () => Math.round(cfg.zoom), value => { cfg.zoom = value; pictureChanged(); });
  addControl(views.picture, '水平 %', 'positionX', -100, 100, 1, () => Math.round((cfg.positionX - 50) * 2), value => { cfg.positionX = value / 2 + 50; pictureChanged(); });
  addControl(views.picture, '垂直 %', 'positionY', -100, 100, 1, () => Math.round((cfg.positionY - 50) * 2), value => { cfg.positionY = value / 2 + 50; pictureChanged(); });
  const pictureActions = node('div', { className: 'actions' });
  const adjust = node('button', { type: 'button', className: 'primary', 'data-testid': 'wallpaper-adjust' }, '打开调整模式');
  const reset = node('button', { type: 'button', className: 'secondary', 'data-testid': 'wallpaper-reset' }, '取景复位');
  pictureActions.append(adjust, reset); views.picture.append(pictureActions, node('div', { className: 'hint' }, '调整模式支持拖动与滚轮；退出后照常聊天。每张壁纸单独记住取景。'), node('div', { className: 'separator' }), node('div', { className: 'section' }, '界面与背景'));
  addControl(views.picture, '不透明度 %', 'panelOpacity', 0, 100, 1, () => Math.round(cfg.panelOpacity * 100), value => { cfg.panelOpacity = value / 100; pictureChanged(); });
  addControl(views.picture, '背景暗化 %', 'scrimOpacity', 0, 80, 1, () => Math.round(cfg.scrimOpacity * 100), value => { cfg.scrimOpacity = value / 100; pictureChanged(); });
  addControl(views.picture, '界面模糊', 'blurPx', 0, 40, 1, () => Math.round(cfg.blurPx), value => { cfg.blurPx = value; pictureChanged(); });
  views.picture.append(node('div', { className: 'separator' }), node('div', { className: 'section' }, '聊天气泡、输入框与文件面板'));
  addControl(views.picture, '气泡模糊', 'bubbleBlurPx', 0, 40, 1, () => Math.round(cfg.bubbleBlurPx), value => { cfg.bubbleBlurPx = value; pictureChanged(); });
  addControl(views.picture, '气泡遮罩 %', 'bubbleOpacity', 0, 80, 1, () => Math.round(cfg.bubbleOpacity * 100), value => { cfg.bubbleOpacity = value / 100; pictureChanged(); });
  function setAdjust(value) { adjustMode = Boolean(value) && cfg.enabled; overlay.hidden = !adjustMode; adjust.textContent = adjustMode ? '完成调整' : '打开调整模式'; adjust.setAttribute('aria-pressed', String(adjustMode)); }
  on(adjust, 'click', () => setAdjust(!adjustMode)); on(done, 'click', () => setAdjust(false));
  on(reset, 'click', () => { cfg.zoom = 100; cfg.positionX = cfg.positionY = 50; cfg.fitMode = 'cover'; fit.value = cfg.fitMode; pictureChanged(); });
  let pan = null;
  on(overlay, 'pointerdown', event => {
    if (!adjustMode || event.target.closest('button') || event.button !== 0) return;
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: cfg.positionX, startY: cfg.positionY };
    overlay.setPointerCapture(event.pointerId); event.preventDefault();
  });
  on(overlay, 'pointermove', event => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    cfg.positionX = clamp(pan.startX + (event.clientX - pan.x) / Math.max(1, innerWidth) * 50, 0, 100, 50);
    cfg.positionY = clamp(pan.startY + (event.clientY - pan.y) / Math.max(1, innerHeight) * 50, 0, 100, 50);
    pictureChanged(); event.preventDefault();
  });
  const stopPan = () => { pan = null; persist(true); };
  on(overlay, 'pointerup', stopPan); on(overlay, 'pointercancel', stopPan);
  on(overlay, 'wheel', event => { if (!adjustMode) return; event.preventDefault(); cfg.zoom = clamp(Math.round(cfg.zoom * Math.exp(-event.deltaY * .0015)), 50, 300, 100); pictureChanged(); }, { passive: false });
  on(window, 'keydown', event => { if (event.key === 'Escape' && adjustMode) { setAdjust(false); event.preventDefault(); event.stopPropagation(); } }, true);

  const soundBox = node('div', { className: 'soundmain' });
  soundBox.append(node('div', { className: 'soundtitle' }, videoMode ? '壁纸原片音轨' : '当前为图片壁纸'), node('div', { className: 'soundhint' }, videoMode ? '只调整这张壁纸的声音，不改变桌面壁纸或系统音量。' : '图片没有音轨。选择视频后可调节音量。'));
  views.sound.append(soundBox);
  const soundActions = node('div', { className: 'actions' });
  const mute = node('button', { type: 'button', className: 'primary', disabled: !videoMode }, cfg.muted ? '开启声音' : '静音');
  // Boolean attributes must be removed when false.
  mute.disabled = !videoMode;
  const pause = node('button', { type: 'button', className: 'secondary' }, '暂停画面'); pause.disabled = !videoMode && cfg.mode !== 'frames';
  soundActions.append(mute, pause); views.sound.append(soundActions);
  addControl(views.sound, '音量 %', 'volume', 0, 100, 1, () => Math.round(cfg.volume * 100), value => {
    cfg.volume = value / 100;
    if (videoMode) { cfg.muted = value === 0; media.volume = cfg.volume; media.muted = cfg.muted; audioBlocked = false; syncPlayback(true); }
    refreshSound(); persist();
  });
  for (const input of views.sound.querySelectorAll('input')) input.disabled = !videoMode;
  views.sound.append(node('div', { className: 'hint' }, '离开 Codex 或最小化后自动暂停，返回时继续。首次有声播放可能需要点击“开启声音”。'));
  const refreshSound = () => { mute.textContent = cfg.muted || audioBlocked ? '开启声音' : '静音'; mute.setAttribute('aria-pressed', String(!cfg.muted && !audioBlocked)); pause.textContent = userPaused ? '继续播放' : '暂停画面'; };
  const inactive = () => document.hidden || !document.hasFocus() || !cfg.enabled || userPaused;
  function playFrames(time) {
    frameRequest = 0;
    if (disposed || inactive() || !frameImages.length) return;
    const delay = Math.max(33, Number(cfg.frameDelayMs) || 250);
    if (time - lastFrame >= delay) { frameIndex = (frameIndex + Math.max(1, Math.floor((time - lastFrame) / delay))) % frameImages.length; lastFrame = time; }
    const image = frameImages[frameIndex];
    if (image.complete && image.naturalWidth) { if (media.width !== image.naturalWidth) { media.width = image.naturalWidth; media.height = image.naturalHeight; } media.getContext('2d', { alpha: false }).drawImage(image, 0, 0); }
    frameRequest = requestAnimationFrame(playFrames);
  }
  function syncPlayback(userGesture = false) {
    if (disposed) return;
    if (videoMode) {
      if (inactive()) { media.pause(); if (cfg.enabled) setStatus(userPaused ? '画面已暂停' : '已暂停 · 返回 Codex 后继续'); }
      else if (media.src) {
        if (userGesture) { audioBlocked = false; media.muted = cfg.muted; }
        media.play().then(() => {
          if (!disposed && !inactive()) setStatus(audioBlocked ? '点击“开启声音”恢复音乐' : '视频播放中', audioBlocked ? '' : 'success');
        }).catch(() => {
          if (disposed || inactive()) return;
          if (!media.muted) { audioBlocked = true; media.muted = true; media.play().catch(() => {}); setStatus('点击“开启声音”恢复音乐'); refreshSound(); }
          else setStatus('点击“继续播放”开始播放');
        });
      }
    } else if (cfg.mode === 'frames') {
      if (inactive()) { if (frameRequest) cancelAnimationFrame(frameRequest); frameRequest = 0; }
      else if (!frameRequest && frameImages.length) { lastFrame = performance.now(); frameRequest = requestAnimationFrame(playFrames); }
    }
  }
  on(mute, 'click', () => { cfg.muted = !(cfg.muted || audioBlocked); audioBlocked = false; media.muted = cfg.muted; syncPlayback(true); refreshSound(); persist(true); });
  on(pause, 'click', () => { userPaused = !userPaused; refreshSound(); syncPlayback(true); });
  for (const [target, event] of [[document, 'visibilitychange'], [window, 'focus'], [window, 'blur']]) on(target, event, () => syncPlayback());
  if (videoMode) {
    on(media, 'error', () => { setStatus('视频无法解码，请选择另一张壁纸', 'error'); setProgress(100, 'error'); });
    on(media, 'loadeddata', () => { setProgress(100, 'done'); syncPlayback(); });
  }
  if (cfg.mode === 'frames' && Array.isArray(cfg.mediaFrames)) {
    frameImages = cfg.mediaFrames.map(src => { const image = new Image(); image.src = src; return image; });
    Promise.allSettled(frameImages.map(image => image.decode())).then(() => { if (!disposed) syncPlayback(); });
  }
  let blobUrl = null, transfer = null;
  const revokeBlob = () => { if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = null; window.__codexWallpaperBlobUrl = null; };
  window.__codexWallpaperBeginVideo = (token, totalBytes) => { revokeBlob(); transfer = { token, totalBytes, received: 0, chunks: [] }; setStatus('正在载入视频…'); setProgress(0); return true; };
  window.__codexWallpaperPushVideoChunk = (token, base64) => {
    if (!transfer || token !== transfer.token) return false;
    const binary = atob(base64), bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    transfer.chunks.push(bytes); transfer.received += bytes.length;
    const percent = transfer.totalBytes > 0 ? Math.min(100, transfer.received / transfer.totalBytes * 100) : 0;
    setStatus('正在载入视频 ' + Math.round(percent) + '%'); setProgress(percent); return true;
  };
  window.__codexWallpaperFinishVideo = (token, mime) => {
    if (!transfer || token !== transfer.token) return false;
    const blob = new Blob(transfer.chunks, { type: mime }); transfer = null; blobUrl = URL.createObjectURL(blob);
    window.__codexWallpaperBlobUrl = blobUrl; media.src = blobUrl; syncPlayback(); setProgress(100, 'done'); return true;
  };
  window.__codexWallpaperVideoError = message => { transfer = null; setStatus('加载失败：' + String(message).slice(0, 150), 'error'); setProgress(100, 'error'); };
  window.__codexWallpaperSyncPlayback = syncPlayback;
  window.__codexWallpaperSetEnabled = value => { cfg.enabled = Boolean(value); if (!cfg.enabled) setAdjust(false); refreshEnabled(); syncPlayback(); if (!cfg.enabled) setStatus('壁纸已关闭 · 可随时重新开启'); };
  on(enabled, 'click', () => { window.__codexWallpaperSetEnabled(!cfg.enabled); command({ action: 'toggle-enabled', enabled: cfg.enabled }); });
  const setOpen = value => { ui.open = Boolean(value); panel.hidden = !ui.open; launcher.setAttribute('aria-expanded', String(ui.open)); if (!ui.open) setAdjust(false); saveUi(); };
  on(close, 'click', () => setOpen(false));
  const place = (element, point, defaultPosition) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const rect = element.getBoundingClientRect();
    element.style.left = Math.max(8, Math.min(innerWidth - Math.max(rect.width, defaultPosition.width) - 8, point.x)) + 'px';
    element.style.top = Math.max(8, Math.min(innerHeight - Math.max(rect.height, defaultPosition.height) - 8, point.y)) + 'px';
    element.style.right = 'auto'; element.style.bottom = 'auto';
  };
  function makeDraggable(handle, element, key, toggleOnClick) {
    let drag = null;
    on(handle, 'pointerdown', event => {
      if (event.button !== 0 || (handle !== element && event.target.closest('button'))) return;
      const rect = element.getBoundingClientRect();
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      handle.setPointerCapture(event.pointerId); event.preventDefault();
    });
    on(handle, 'pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; ui[key] = { x: drag.left + dx, y: drag.top + dy }; place(element, ui[key], { width: element.offsetWidth, height: element.offsetHeight });
    });
    on(handle, 'pointerup', event => { if (!drag || drag.pointerId !== event.pointerId) return; const moved = drag.moved; drag = null; if (moved) { const rect = element.getBoundingClientRect(); ui[key] = { x: rect.left, y: rect.top }; saveUi(); } else if (toggleOnClick) setOpen(!ui.open); });
    on(handle, 'pointercancel', () => { drag = null; });
    if (toggleOnClick) on(handle, 'click', event => { if (event.detail === 0) setOpen(!ui.open); });
  }
  makeDraggable(launcher, launcher, 'buttonPosition', true); makeDraggable(header, panel, 'panelPosition', false);
  on(window, 'resize', () => { place(launcher, ui.buttonPosition, { width: 83, height: 40 }); if (ui.open) place(panel, ui.panelPosition, { width: 370, height: 200 }); });
  shadow.append(launcher, panel); document.body.append(host);
  if (cfg.showControls === false) host.hidden = true;
  applyPicture(); refreshEnabled(); showTab(); renderLibrary(); refreshSound(); setOpen(ui.open);
  place(launcher, ui.buttonPosition, { width: 83, height: 40 }); if (ui.open) place(panel, ui.panelPosition, { width: 370, height: 200 });
  setStatus(!cfg.enabled ? '壁纸已关闭' : cfg.mode === 'library' ? '请选择本机壁纸' : cfg.mode === 'video-blob' ? '正在准备视频…' : videoMode ? '视频已就绪' : cfg.mode === 'frames' ? '解码预览动画' : '图片壁纸已就绪', 'success');
  if (cfg.mode === 'video-blob') setProgress(0);
  syncPlayback();
  const themeObserver = new MutationObserver(applyPicture);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme'] });
  const cleanup = () => {
    if (disposed) return;
    saveUi(); disposed = true; clearTimeout(saveTimer); themeObserver.disconnect();
    listeners.splice(0).forEach(remove => remove());
    if (frameRequest) cancelAnimationFrame(frameRequest);
    if (videoMode) { media.pause(); media.removeAttribute('src'); media.load(); }
    transfer = null; frameImages = []; revokeBlob();
    layer.remove(); style.remove(); host.remove(); document.documentElement.removeAttribute('data-codex-wallpaper');
    for (const property of ['--codex-skin-panel-opacity', '--codex-skin-blur', '--codex-skin-panel-rgb', '--codex-skin-glass-rgb', '--codex-skin-glass-edge-rgb', '--codex-skin-glass-opacity', '--codex-skin-bubble-blur']) document.documentElement.style.removeProperty(property);
    for (const name of ['__codexWallpaperBeginVideo', '__codexWallpaperPushVideoChunk', '__codexWallpaperFinishVideo', '__codexWallpaperVideoError', '__codexWallpaperSyncPlayback', '__codexWallpaperSetEnabled', '__codexWallpaperPauseCleanup', '__codexWallpaperManagerCleanup']) window[name] = null;
  };
  window.__codexWallpaperPauseCleanup = cleanup;
  window.__codexWallpaperManagerCleanup = cleanup;
  return { installed: true, mode: cfg.mode, controls: !host.hidden, managerVersion: 1, currentId: cfg.currentId, enabled: cfg.enabled };
}

export function makeManagerInjectionScript(config) {
  const serialized = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `(${installWallpaperManager.toString()})(${serialized})`;
}

export function makeManagerRemovalScript() {
  return `(() => { window.__codexWallpaperManagerCleanup?.(); if (window.__codexWallpaperPendingInstall) { document.removeEventListener('DOMContentLoaded', window.__codexWallpaperPendingInstall); window.__codexWallpaperPendingInstall = null; } return {removed:true,url:location.href}; })()`;
}
