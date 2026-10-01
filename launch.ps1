$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
    $node = Join-Path $PSScriptRoot 'runtime/node.exe'
    if (-not (Test-Path -LiteralPath $node)) {
        $installed = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $installed) { throw 'Node.js 24+ is required for the source package. Download the Windows portable ZIP from the GitHub Releases page, or install Node.js from https://nodejs.org/' }
        $node = $installed.Source
    }
    $version = & $node -p "process.versions.node.split('.')[0]"
    if ([int]$version -lt 24) { throw 'Please use Node.js 24 or newer, or download the Windows portable release.' }
    if (-not (Test-Path -LiteralPath 'node_modules/marked')) {
        $npm = Join-Path (Split-Path $node) 'npm.cmd'
        if (-not (Test-Path -LiteralPath $npm)) { throw 'Dependencies are missing. Please extract the complete portable ZIP, or run npm ci in the source directory.' }
        & $npm ci --omit=dev
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your internet connection and try again.' }
    }
    $port = if ($env:PORT) { [int]$env:PORT } else { 4173 }
    $address = "http://127.0.0.1:$port"
    try { $health = Invoke-RestMethod "$address/api/health" -TimeoutSec 2 } catch { $health = $null }
    if ($health.app -eq 'folio-bookshelf') {
        if ($env:FOLIO_OPEN -ne '0') { Start-Process $address }
        exit 0
    }
    if ($env:FOLIO_OPEN -ne '0') { $env:FOLIO_OPEN = '1' }
    Write-Host 'Folio is starting. Keep this window open. Close it to stop the bookshelf.'
    & $node server.mjs
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
