import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'smol-toml';
const root=fileURLToPath(new URL('../',import.meta.url));
const ps=(script,args=[])=>execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'scripts',script),...args],{encoding:'utf8',windowsHide:true,timeout:30000});

test('isolated installation preserves other MCP settings, updates cleanly and uninstalls', {skip:process.platform!=='win32'},()=>{
 const temporary=mkdtempSync(join(tmpdir(),'codex-wallpaper-install-'));
 const install=join(temporary,'install');const codexHome=join(temporary,'codex');
 const executable=join(temporary,'ChatGPT.exe');writeFileSync(executable,'test executable; never launched');
 mkdirSync(codexHome);const config=join(codexHome,'config.toml');
 writeFileSync(config,'model = "test-model"\n[mcp_servers.unrelated]\ncommand = "keep-me"\n');
 const args=['-InstallRoot',install,'-CodexHome',codexHome,'-NodePath',process.execPath,'-CodexExe',executable,'-Port','19974','-NoShortcuts'];
 try{
  ps('install.ps1',[...args,'-ValidateOnly']);assert.equal(existsSync(install),false);
  ps('install.ps1',args);
  const settings=JSON.parse(readFileSync(join(install,'installation.json'),'utf8'));
  assert.equal(settings.product,'codex-wallpaper-manager');
  let parsed=parse(readFileSync(config,'utf8'));
  assert.equal(parsed.model,'test-model');assert.equal(parsed.mcp_servers.unrelated.command,'keep-me');
  assert.equal(parsed.mcp_servers['codex-wallpaper-manager'].command,process.execPath);
  assert.equal(parsed.mcp_servers['codex-wallpaper-manager'].env.CODEX_SKIN_CDP_PORT,'19974');
  assert.ok(existsSync(join(install,'runtime','src','manager-renderer.mjs')));
  assert.ok(existsSync(join(codexHome,'skills','codex-wallpaper-manager','SKILL.md')));
  ps('launch-codex.ps1',['-InstallRoot',install,'-ValidateOnly']);
  ps('install.ps1',args);
  assert.equal((readFileSync(config,'utf8').match(/\[mcp_servers\.codex-wallpaper-manager\]/g)||[]).length,1);
  const saved=join(install,'state.json');writeFileSync(saved,JSON.stringify({id:'example',zoom:120}));
  ps('uninstall.ps1',['-InstallRoot',install]);
  parsed=parse(readFileSync(config,'utf8'));
  assert.equal(parsed.mcp_servers.unrelated.command,'keep-me');assert.equal(parsed.mcp_servers['codex-wallpaper-manager'],undefined);
  assert.equal(existsSync(join(install,'runtime')),false);
  assert.equal(JSON.parse(readFileSync(saved,'utf8')).zoom,120);
  assert.equal(existsSync(join(codexHome,'skills','codex-wallpaper-manager')),false);
 }finally{
  const absolute=resolve(temporary);assert.ok(absolute.toLowerCase().startsWith((resolve(tmpdir())+sep).toLowerCase()));
  assert.ok(absolute.includes('codex-wallpaper-install-'));rmSync(absolute,{recursive:true,force:true});
 }
});

test('PowerShell entry points parse without syntax errors', {skip:process.platform!=='win32'},()=>{
 const command='$errorsFound=@(); Get-ChildItem -LiteralPath '+"'"+join(root,'scripts').replaceAll("'","''")+"'"+' -Filter *.ps1 | ForEach-Object { $tokens=$null; $errors=$null; $null=[Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors); $errorsFound += $errors }; if($errorsFound.Count){$errorsFound | Out-String | Write-Error;exit 1}';
 execFileSync('powershell.exe',['-NoLogo','-NoProfile','-Command',command],{windowsHide:true,timeout:10000});
});
