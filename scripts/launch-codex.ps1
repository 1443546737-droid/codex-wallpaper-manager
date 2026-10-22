param([string]$InstallRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),[switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
$installation = Get-Content -LiteralPath (Join-Path $InstallRoot 'installation.json') -Raw | ConvertFrom-Json
if ($installation.product -ne 'codex-wallpaper-manager') { throw 'Invalid installation identity.' }
$serviceScript = Join-Path $installation.runtime 'scripts\wallpaper-service.mjs'
foreach ($file in @($installation.nodePath,$installation.codexExe,$serviceScript)) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw ('Required file is missing: ' + $file) } }
if ($ValidateOnly) { 'WALLPAPER_LAUNCHER_VALID'; exit 0 }
$serviceRunning = $false
if (Test-Path -LiteralPath $installation.serviceFile) {
    try { $lease = Get-Content -LiteralPath $installation.serviceFile -Raw | ConvertFrom-Json; $processInfo = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$lease.pid); $serviceRunning = $processInfo.ExecutablePath -eq $installation.nodePath -and $processInfo.CommandLine.Contains($serviceScript) } catch {}
}
if (-not $serviceRunning) {
    $arguments = @(('"'+$serviceScript+'"'),'--state',('"'+$installation.stateFile+'"'),'--status',('"'+$installation.serviceFile+'"'),'--cdp-port',[string]$installation.port)
    Start-Process -FilePath $installation.nodePath -ArgumentList $arguments -WorkingDirectory $installation.runtime -WindowStyle Hidden | Out-Null
}
$running = @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object { $_.ExecutablePath -eq $installation.codexExe -and $_.CommandLine -notmatch '--type=' })
if ($running.Count) {
    $enabled = @($running | Where-Object { $_.CommandLine -match ('--remote-debugging-port(?:=|\s)' + $installation.port + '(?:\s|$)') })
    if (-not $enabled.Count) { Write-Warning 'Codex is already running without the wallpaper connection. Fully quit it and launch Codex Wallpaper again. Your current chat was not interrupted.' }
    $visible = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if (-not $visible.Count) { Start-Process -FilePath $installation.codexExe -WindowStyle Normal | Out-Null }
    exit 0
}
Start-Process -FilePath $installation.codexExe -ArgumentList '--remote-debugging-address=127.0.0.1',('--remote-debugging-port='+$installation.port) -WorkingDirectory (Split-Path -Parent $installation.codexExe) -WindowStyle Normal | Out-Null
