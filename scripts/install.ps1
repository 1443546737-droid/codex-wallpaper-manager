param(
    [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexWallpaperManager'),
    [string]$CodexHome = (Join-Path $env:USERPROFILE '.codex'),
    [string]$NodePath,
    [string]$CodexExe,
    [ValidateRange(1024,65535)][int]$Port = 9222,
    [switch]$NoShortcuts,
    [switch]$NoSkill,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$utf8 = New-Object Text.UTF8Encoding($false)
if (-not $NodePath) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $NodePath = $nodeCommand.Source }
    else {
        $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
        if (Test-Path -LiteralPath $bundledNode) { $NodePath = $bundledNode }
    }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Node.js 22 or newer is required. Install Node.js, or provide -NodePath.' }
$nodeMajor = & $NodePath -p "Number(process.versions.node.split('.')[0])"
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 22) { throw 'Node.js 22 or newer is required.' }
if (-not $CodexExe) {
    $package = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
    if ($package) { $CodexExe = Join-Path $package.InstallLocation 'app\ChatGPT.exe' }
}
if (-not $CodexExe -or -not (Test-Path -LiteralPath $CodexExe -PathType Leaf)) { throw 'Codex was not found. Install Codex for Windows, or provide -CodexExe.' }
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot) -or $InstallRoot -eq [IO.Path]::GetFullPath($env:USERPROFILE) -or $InstallRoot -eq $CodexHome -or $InstallRoot -eq $sourceRoot) { throw 'Choose a dedicated installation directory.' }
$markerPath = Join-Path $InstallRoot 'installation.json'
if ((Test-Path -LiteralPath $InstallRoot) -and @(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -gt 0) {
    if (-not (Test-Path -LiteralPath $markerPath)) { throw 'The selected installation directory is not managed by this project.' }
    $old = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    if ($old.product -ne 'codex-wallpaper-manager') { throw 'Installation identity does not match.' }
}
$skillDestination = Join-Path $CodexHome 'skills\codex-wallpaper-manager'
if (-not $NoSkill -and (Test-Path -LiteralPath $skillDestination) -and -not (Test-Path -LiteralPath (Join-Path $skillDestination '.managed-by-codex-wallpaper-manager'))) { throw 'An existing skill with this name is not managed by this installer.' }
$configFile = Join-Path $CodexHome 'config.toml'
$config = if (Test-Path -LiteralPath $configFile) { [IO.File]::ReadAllText($configFile) } else { '' }
$start = '# BEGIN codex-wallpaper-manager'
$end = '# END codex-wallpaper-manager'
$pattern = '(?ms)^' + [regex]::Escape($start) + '\r?\n.*?^' + [regex]::Escape($end) + '\r?\n?'
$unmanaged = [regex]::Replace($config,$pattern,'')
if ($unmanaged -match '(?m)^\[mcp_servers\.codex-wallpaper-manager(?:\]|\.)') { throw 'An unmanaged MCP configuration with this name exists; review it before installing.' }
if ($ValidateOnly) { [PSCustomObject]@{valid=$true;node=$NodePath;codex=$CodexExe;installRoot=$InstallRoot;port=$Port} | ConvertTo-Json; exit 0 }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$serviceWasRunning = $false
if (Test-Path -LiteralPath (Join-Path $InstallRoot 'service.json')) {
    try {
        $lease = Get-Content -LiteralPath (Join-Path $InstallRoot 'service.json') -Raw | ConvertFrom-Json
        $previousService = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$lease.pid)
        if ($previousService -and $previousService.ExecutablePath -eq $NodePath -and $previousService.CommandLine.Contains((Join-Path $InstallRoot 'runtime\scripts\wallpaper-service.mjs'))) { Stop-Process -Id $previousService.ProcessId -Force; $serviceWasRunning = $true }
    } catch {}
}
$runtime = Join-Path $InstallRoot 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
foreach ($folder in @('src','scripts','skills')) {
    $target = Join-Path $runtime $folder
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceRoot ($folder + '\*')) -Destination $target -Recurse -Force
}
foreach ($file in @('package.json','LICENSE','NOTICE.md')) { Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination (Join-Path $runtime $file) -Force }
$state = Join-Path $InstallRoot 'state.json'
$service = Join-Path $InstallRoot 'service.json'
New-Item -ItemType Directory -Path $CodexHome -Force | Out-Null
if (Test-Path -LiteralPath $configFile) { Copy-Item -LiteralPath $configFile -Destination (Join-Path $InstallRoot ('config-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.toml')) }
function Quote-Toml([string]$value) { return ($value | ConvertTo-Json -Compress) }
$server = Join-Path $runtime 'scripts\mcp-server.mjs'
$block = @"
$start
[mcp_servers.codex-wallpaper-manager]
command = $(Quote-Toml $NodePath)
args = [$(Quote-Toml $server)]
cwd = $(Quote-Toml $runtime)
startup_timeout_sec = 30
tool_timeout_sec = 120
[mcp_servers.codex-wallpaper-manager.env]
CODEX_WALLPAPER_STATE_FILE = $(Quote-Toml $state)
CODEX_WALLPAPER_SERVICE_FILE = $(Quote-Toml $service)
CODEX_SKIN_CDP_PORT = "$Port"
CODEX_SKIN_DISABLE_FRAME_EXTRACTION = "1"
$end
"@
[IO.File]::WriteAllText($configFile,($unmanaged.TrimEnd()+"`r`n`r`n"+$block+"`r`n"),$utf8)
if (-not $NoSkill) {
    New-Item -ItemType Directory -Path $skillDestination -Force | Out-Null
    Copy-Item -Path (Join-Path $runtime 'skills\codex-wallpaper-manager\*') -Destination $skillDestination -Recurse -Force
    [IO.File]::WriteAllText((Join-Path $skillDestination '.managed-by-codex-wallpaper-manager'),'managed',$utf8)
}
$shortcuts = @()
if (-not $NoShortcuts) {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($directory in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))) {
        $path = Join-Path $directory 'Codex Wallpaper.lnk'
        if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination (Join-Path $InstallRoot ('shortcut-backup-' + $shortcuts.Count + '.lnk')) }
        $link = $shell.CreateShortcut($path)
        $link.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $link.Arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $runtime 'scripts\launch-codex.ps1') + '"'
        $link.WorkingDirectory = $InstallRoot
        $link.IconLocation = $CodexExe + ',0'
        $link.WindowStyle = 7
        $link.Save()
        $shortcuts += $path
    }
}
$installation = [PSCustomObject]@{product='codex-wallpaper-manager';version='0.1.0';nodePath=$NodePath;codexExe=$CodexExe;port=$Port;runtime=$runtime;stateFile=$state;serviceFile=$service;codexHome=$CodexHome;skillPath=$(if($NoSkill){$null}else{$skillDestination});shortcuts=$shortcuts}
[IO.File]::WriteAllText($markerPath,($installation | ConvertTo-Json -Depth 6),$utf8)
if ($serviceWasRunning) { & (Join-Path $runtime 'scripts\launch-codex.ps1') -InstallRoot $InstallRoot }
[PSCustomObject]@{installed=$true;installRoot=$InstallRoot;launch=(Join-Path $runtime 'scripts\launch-codex.ps1');nextStep='Fully quit Codex once, then open Codex Wallpaper. No application was closed by this installer.'} | ConvertTo-Json
