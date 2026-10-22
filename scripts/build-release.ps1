param([string]$Ref = 'HEAD')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$output = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$zip = Join-Path $output ('codex-wallpaper-manager-v' + $package.version + '.zip')
& git -C $root archive --format=zip --prefix=codex-wallpaper-manager/ -o $zip $Ref
if ($LASTEXITCODE -ne 0) { throw 'Git archive failed. Commit the verified source first.' }
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($zip + '.sha256'),($hash + '  ' + [IO.Path]::GetFileName($zip) + "`n"),(New-Object Text.UTF8Encoding($false)))
[PSCustomObject]@{zip=$zip;sha256=$hash;ref=$Ref} | ConvertTo-Json
