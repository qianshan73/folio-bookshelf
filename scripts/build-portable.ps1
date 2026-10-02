param([string]$NodeVersion = 'v24.21.0')
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Join-Path $root 'release'
New-Item -ItemType Directory -Force -Path $release | Out-Null
$staging = Join-Path $release ('staging-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
if ($NodeVersion -notmatch '^v24\.\d+\.\d+$') { throw 'Choose an official Node.js 24 LTS version.' }
$distribution = "node-$NodeVersion-win-x64.zip"
$archive = Join-Path $release $distribution
$base = "https://nodejs.org/dist/$NodeVersion"
Write-Host 'Downloading the official Node.js distribution...'
if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -UseBasicParsing "$base/$distribution" -OutFile $archive }
$sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
if ($sums -is [byte[]]) { $sums = [System.Text.Encoding]::UTF8.GetString($sums) }
$line = ($sums -split "`n" | Where-Object { $_.Trim().EndsWith(" $distribution") } | Select-Object -First 1)
if (-not $line) { throw 'Official checksum was not found.' }
$expected = ($line.Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne $expected.ToLower()) { throw 'Node.js checksum verification failed.' }
$extracted = Join-Path $release ('node-' + [Guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $archive -DestinationPath $extracted
New-Item -ItemType Directory -Path (Join-Path $staging 'runtime') | Out-Null
$nodeDir = Join-Path $extracted "node-$NodeVersion-win-x64"
Copy-Item -LiteralPath (Join-Path $nodeDir 'node.exe') -Destination (Join-Path $staging 'runtime/node.exe')
Copy-Item -LiteralPath (Join-Path $nodeDir 'LICENSE') -Destination (Join-Path $staging 'runtime/NODE_LICENSE.txt')
foreach ($name in @('public','lib','server.mjs','start.cmd','launch.ps1','start.sh','package.json','package-lock.json','README.md','LICENSE','AI_USAGE.md')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination $staging -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $staging 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'scripts/file-picker.ps1') -Destination (Join-Path $staging 'scripts/file-picker.ps1')
New-Item -ItemType Directory -Path (Join-Path $staging 'docs/screenshots') -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $root 'docs') -File -Filter '*.md' | Copy-Item -Destination (Join-Path $staging 'docs')
foreach ($name in @('bookshelf.png','reader.png','dark.png','mobile.png','standalone-reader.png','file-organizer.png')) {
    Copy-Item -LiteralPath (Join-Path $root "docs/screenshots/$name") -Destination (Join-Path $staging 'docs/screenshots')
}
Push-Location $staging
try {
    & npm.cmd ci --omit=dev --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Runtime dependency installation failed.' }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Join-Path $staging 'OPEN_FIRST.txt'), "Folio Bookshelf`r`n`r`n1. Extract this entire ZIP into a writable folder.`r`n2. Double-click start.cmd. No installation or account is required.`r`n3. Keep the launch window open while using the bookshelf.`r`n4. Your private data is stored in the data folder created at first launch.`r`n`r`nMade with OpenAI Codex assistance. See AI_USAGE.md.`r`n", $utf8)
} finally { Pop-Location }
$output = Join-Path $release 'Folio-Windows-x64.zip'
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $output -Force
Write-Host "Portable package: $output"
Write-Host "Stage directory: $staging"
