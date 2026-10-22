param(
    [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexWallpaperManager'),
    [switch]$Purge
)
$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$installation = Get-Content -LiteralPath (Join-Path $InstallRoot 'installation.json') -Raw | ConvertFrom-Json
if ($installation.product -ne 'codex-wallpaper-manager') { throw 'This directory is not a Codex Wallpaper Manager installation.' }
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot).TrimEnd('\') -or $InstallRoot -eq [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')) { throw 'Unsafe installation path.' }
$runtime = [IO.Path]::GetFullPath((Join-Path $InstallRoot 'runtime'))
if ([IO.Path]::GetFullPath($installation.runtime) -ne $runtime -or -not $runtime.StartsWith($InstallRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime directory leaves the managed installation.' }
$serviceScript = Join-Path $runtime 'scripts\wallpaper-service.mjs'
if (Test-Path -LiteralPath $installation.serviceFile) {
    try {
        $lease = Get-Content -LiteralPath $installation.serviceFile -Raw | ConvertFrom-Json
        $processInfo = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$lease.pid)
        if ($processInfo -and $processInfo.ExecutablePath -eq $installation.nodePath -and $processInfo.CommandLine.Contains($serviceScript)) { Stop-Process -Id $processInfo.ProcessId -Force }
    } catch { Write-Warning 'Could not stop the wallpaper service. Close Codex before removing the runtime.' }
}
& $installation.nodePath (Join-Path $runtime 'scripts\remove-layer.mjs') ([string]$installation.port)
if ($LASTEXITCODE -ne 0) { Write-Warning 'Close Codex once to finish restoring the normal appearance.' }
$configFile = Join-Path $installation.codexHome 'config.toml'
$utf8 = New-Object Text.UTF8Encoding($false)
if (Test-Path -LiteralPath $configFile) {
    $config = [IO.File]::ReadAllText($configFile)
    Copy-Item -LiteralPath $configFile -Destination (Join-Path $InstallRoot ('config-before-uninstall-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.toml'))
    $pattern = '(?ms)^# BEGIN codex-wallpaper-manager\r?\n.*?^# END codex-wallpaper-manager\r?\n?'
    [IO.File]::WriteAllText($configFile,[regex]::Replace($config,$pattern,''),$utf8)
}
if ($installation.skillPath) {
    $expectedSkill = [IO.Path]::GetFullPath((Join-Path $installation.codexHome 'skills\codex-wallpaper-manager'))
    if ([IO.Path]::GetFullPath($installation.skillPath) -ne $expectedSkill) { throw 'Skill path does not match the managed skill.' }
    if (Test-Path -LiteralPath (Join-Path $expectedSkill '.managed-by-codex-wallpaper-manager')) { Remove-Item -LiteralPath $expectedSkill -Recurse -Force }
}
$shell = New-Object -ComObject WScript.Shell
$index = 0
foreach ($shortcut in $installation.shortcuts) {
    if (Test-Path -LiteralPath $shortcut) {
        $link = $shell.CreateShortcut($shortcut)
        if ($link.Arguments.Contains((Join-Path $runtime 'scripts\launch-codex.ps1'))) {
            $backup = Join-Path $InstallRoot ('shortcut-backup-'+$index+'.lnk')
            if (Test-Path -LiteralPath $backup) { Copy-Item -LiteralPath $backup -Destination $shortcut -Force }
            else { Remove-Item -LiteralPath $shortcut -Force }
        }
    }
    $index++
}
if ($Purge) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
else {
    if (Test-Path -LiteralPath $runtime) { Remove-Item -LiteralPath $runtime -Recurse -Force }
    $installation | Add-Member -NotePropertyName uninstalled -NotePropertyValue $true -Force
    [IO.File]::WriteAllText((Join-Path $InstallRoot 'installation.json'),($installation | ConvertTo-Json -Depth 6),$utf8)
}
[PSCustomObject]@{uninstalled=$true;settingsPreserved=(-not $Purge);installRoot=$InstallRoot} | ConvertTo-Json
