import {wallpaperSourceStatus} from '../src/wallpaper-engine.mjs';
import {CodexSkinBridge} from '../src/codex-skin.mjs';
const bridge=new CodexSkinBridge({autoRestore:false,manageRenderer:false});
try { console.log(JSON.stringify({platform:process.platform,node:process.version,wallpaperEngine:wallpaperSourceStatus(),codex:await bridge.debugStatus()},null,2)); }
finally { bridge.disconnect(); }
