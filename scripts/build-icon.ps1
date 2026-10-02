param([string]$Source = '', [string]$Output = '')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Source) { $Source = Join-Path $root 'public/icons/folio.png' }
if (-not $Output) { $Output = Join-Path $root 'public/icons/folio.ico' }
Add-Type -AssemblyName System.Drawing
$sourceImage = [Drawing.Image]::FromFile([IO.Path]::GetFullPath($Source))
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = New-Object 'System.Collections.Generic.List[byte[]]'
try {
    foreach ($size in $sizes) {
        $bitmap = New-Object Drawing.Bitmap($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $memory = New-Object IO.MemoryStream
        $attributes = New-Object Drawing.Imaging.ImageAttributes
        try {
            $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $attributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
            $graphics.DrawImage($sourceImage, (New-Object Drawing.Rectangle(0,0,$size,$size)), 0,0,$sourceImage.Width,$sourceImage.Height,[Drawing.GraphicsUnit]::Pixel,$attributes)
            $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
            $frames.Add($memory.ToArray())
        } finally { $attributes.Dispose(); $memory.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
    }
    $stream = [IO.File]::Create([IO.Path]::GetFullPath($Output))
    $writer = New-Object IO.BinaryWriter($stream)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
        $offset = [uint32](6 + 16 * $sizes.Count)
        for ($i=0; $i -lt $sizes.Count; $i++) {
            $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$frames[$i].Length); $writer.Write($offset)
            $offset += $frames[$i].Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
    } finally { $writer.Dispose(); $stream.Dispose() }
    Write-Output "Icon created: $Output"
} finally { $sourceImage.Dispose() }
