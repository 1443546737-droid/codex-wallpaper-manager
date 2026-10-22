#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, appendFileSync, statSync } from 'node:fs';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

function argumentsFor(argv) {
  const out = {};
  for (let i=0;i<argv.length;i+=2) {
    if (!['--state','--status','--cdp-port','--seed-id'].includes(argv[i]) || !argv[i+1]) throw new Error('Invalid service argument.');
    out[argv[i].slice(2)] = argv[i+1];
  }
  return out;
}
const options = argumentsFor(process.argv.slice(2));
const stateFile = options.state;
const statusFile = options.status;
if (!stateFile || !statusFile || !isAbsolute(stateFile) || !isAbsolute(statusFile)) throw new Error('Absolute state/status paths are required.');
const cdpPort = Number(options['cdp-port'] || 9222);
if (!Number.isInteger(cdpPort) || cdpPort<1024 || cdpPort>65535) throw new Error('Invalid local debug port.');
const serviceRoot = dirname(stateFile);
mkdirSync(serviceRoot,{recursive:true});
const lockFile = join(serviceRoot,'wallpaper-manager.lock');
const logFile = join(serviceRoot,'wallpaper-manager.log');
const nonce = randomUUID();
const scriptPath=fileURLToPath(import.meta.url);
function alive(pid) { try { process.kill(Number(pid),0); return true; } catch { return false; } }
function sameService(pid) {
  if(!Number.isInteger(Number(pid))||Number(pid)<=0||!alive(pid))return false;
  if(process.platform!=='win32') {
    try { const command=readFileSync('/proc/'+Number(pid)+'/cmdline','utf8');return command.includes(scriptPath)&&command.includes(stateFile); } catch { return false; }
  }
  try {
    const query="$p=Get-CimInstance Win32_Process -Filter 'ProcessId = "+Number(pid)+"'; if($p){$p | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress}";
    const entry=JSON.parse(execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',query],{encoding:'utf8',windowsHide:true,timeout:8000}));
    return String(entry.ExecutablePath).toLowerCase()===process.execPath.toLowerCase()
      && String(entry.CommandLine).includes(scriptPath) && String(entry.CommandLine).includes(stateFile);
  } catch { return false; }
}
if (existsSync(lockFile)) {
  let old,original; try { original=readFileSync(lockFile,'utf8');old=JSON.parse(original); } catch {}
  if (!old && Date.now()-statSync(lockFile).mtimeMs<15000)process.exit(0);
  if (old?.pid && sameService(old.pid)) process.exit(0);
  try { if(readFileSync(lockFile,'utf8')!==original)process.exit(0); } catch {}
  try { unlinkSync(lockFile); } catch {}
}
let lock;
try { lock=openSync(lockFile,'wx'); } catch (error) { if(error.code==='EEXIST')process.exit(0);throw error; }
writeFileSync(lock,JSON.stringify({pid:process.pid,nonce,scriptPath,stateFile}));closeSync(lock);
function atomic(file,value) { const partial=file+'.'+process.pid+'.partial';writeFileSync(partial,JSON.stringify(value,null,2)+'\n');renameSync(partial,file); }
function log(message) {
  try { if(existsSync(logFile)&&statSync(logFile).size>1024*1024)writeFileSync(logFile,'');appendFileSync(logFile,new Date().toISOString()+' '+message+'\n'); } catch {}
}
process.env.CODEX_WALLPAPER_SERVICE='1';
process.env.CODEX_WALLPAPER_STATE_FILE=stateFile;
process.env.CODEX_WALLPAPER_SERVICE_FILE=statusFile;
process.env.CODEX_SKIN_DISABLE_FRAME_EXTRACTION='1';
const { CodexSkinBridge }=await import('../src/codex-skin.mjs');
const { enumerateWallpaperSources }=await import('../src/wallpaper-engine.mjs');
if (!existsSync(stateFile)) {
  const sources=enumerateWallpaperSources().filter(item=>item.skinMode==='video'||item.skinMode==='image'||item.previewPath);
  const defaultSources=sources.filter(item=>item.ageRating==='G'||item.ageRating==='PG-13');
  const first=sources.find(item=>item.id===options['seed-id'])||defaultSources.find(item=>item.type==='video')||defaultSources[0];
  atomic(stateFile,{enabled:true,id:first?.id||'@library',panelOpacity:0,scrimOpacity:.28,blurPx:0,bubbleBlurPx:18,bubbleOpacity:.34,muted:true,volume:.35,fitMode:'cover',zoom:100,positionX:50,positionY:50,showControls:true,updatedAt:new Date().toISOString()});
}
const bridge=new CodexSkinBridge({cdpPort,stateFile,serviceLeaseFile:statusFile,restoreIntervalMs:1800});
let running=true,busy=false,lastError='',lastSeen=Date.now(),everConnected=false;
function heartbeat(extra={}) { atomic(statusFile,{pid:process.pid,nonce,scriptPath,stateFile,updatedAt:new Date().toISOString(),...extra}); }
heartbeat({phase:'waiting-for-codex'});
log('service-started');
async function poll() {
 if(busy||!running)return;busy=true;
 try {
  const status=await bridge.status();
  const available=Boolean(status.debug?.available);
  if(available){lastSeen=Date.now();everConnected=true;}
  heartbeat({phase:available?'connected':'waiting-for-codex',debug:status.debug,active:status.active,persistence:status.persistence});
  const error=status.persistence?.lastRestoreError||'';
  if(error&&error!==lastError)log(error);lastError=error;
  if(Date.now()-lastSeen>(everConnected?90000:600000))shutdown();
 } catch(error){log(error.message);} finally {busy=false;}
}
const heartbeatTimer=setInterval(poll,3000);
function shutdown() {
 if(!running)return;running=false;clearInterval(heartbeatTimer);bridge.disconnect();
 try{const lock=JSON.parse(readFileSync(lockFile,'utf8'));if(lock.nonce===nonce)unlinkSync(lockFile);}catch{}
 try{const state=JSON.parse(readFileSync(statusFile,'utf8'));if(state.nonce===nonce)heartbeat({phase:'stopped'});}catch{}
 log('service-stopped');process.exit(0);
}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
process.on('uncaughtException',error=>{log(error.stack||error.message);shutdown();});
process.on('unhandledRejection',error=>{log(String(error));});
await poll();
