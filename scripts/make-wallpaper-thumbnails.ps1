param(
    [Parameter(Mandatory=$true)][string]$BatchFile,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\') + '\'
if (-not (Test-Path -LiteralPath $outputRoot -PathType Container)) { throw 'Thumbnail cache directory is missing.' }
$jobs = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($BatchFile))
if ($jobs.Count -gt 1000) { throw 'Too many thumbnail jobs.' }
$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$completed = 0
$failed = 0
$errors = @()
foreach ($job in $jobs) {
    $image = $null
    $bitmap = $null
    $graphics = $null
    $parameters = $null
    $partial = $null
    try {
        if ($job.name -isnot [string] -or $job.source -isnot [string] -or $job.name -notmatch '^[a-f0-9]{32}\.jpg$') { throw 'Invalid thumbnail job.' }
        $destination = [IO.Path]::GetFullPath((Join-Path $outputRoot $job.name))
        if (-not $destination.StartsWith($outputRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Thumbnail path leaves the cache.' }
        $source = Get-Item -LiteralPath $job.source
        if ($source.PSIsContainer -or $source.Length -gt 25165824) { throw 'Invalid preview size.' }
        $image = [Drawing.Image]::FromFile($source.FullName)
        if ([long]$image.Width * $image.Height -gt 64000000) { throw 'Preview dimensions exceed the limit.' }
        $bitmap = New-Object Drawing.Bitmap(320,180)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear([Drawing.Color]::FromArgb(24,30,40))
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $scale = [Math]::Max(320.0/$image.Width,180.0/$image.Height)
        $width = [int][Math]::Ceiling($image.Width*$scale)
        $height = [int][Math]::Ceiling($image.Height*$scale)
        $rectangle = New-Object Drawing.Rectangle([int]((320-$width)/2),[int]((180-$height)/2),$width,$height)
        $graphics.DrawImage($image,$rectangle)
        $parameters = New-Object Drawing.Imaging.EncoderParameters(1)
        $parameters.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality,[long]75)
        $partial = $destination + '.' + $PID + '.partial'
        $bitmap.Save($partial,$codec,$parameters)
        if ((Get-Item -LiteralPath $partial).Length -gt 131072) { throw 'Thumbnail output is too large.' }
        Move-Item -LiteralPath $partial -Destination $destination -Force
        $completed++
    } catch {
        $failed++
        if ($errors.Count -lt 3) { $errors += $_.Exception.Message }
    } finally {
        if ($parameters) { $parameters.Dispose() }
        if ($graphics) { $graphics.Dispose() }
        if ($bitmap) { $bitmap.Dispose() }
        if ($image) { $image.Dispose() }
        if ($partial -and (Test-Path -LiteralPath $partial)) { Remove-Item -LiteralPath $partial -Force }
    }
}
[PSCustomObject]@{completed=$completed;failed=$failed;errors=$errors} | ConvertTo-Json -Compress
