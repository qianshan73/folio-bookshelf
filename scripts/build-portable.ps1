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
foreach ($name in @('public','lib','server.mjs','start.cmd','创建快捷方式.cmd','launch.ps1','start.sh','package.json','package-lock.json','README.md','LICENSE','AI_USAGE.md')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination $staging -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $staging 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'scripts/file-picker.ps1') -Destination (Join-Path $staging 'scripts/file-picker.ps1')
Copy-Item -LiteralPath (Join-Path $root 'scripts/shortcuts.ps1') -Destination (Join-Path $staging 'scripts/shortcuts.ps1')
Copy-Item -LiteralPath (Join-Path $root 'scripts/shortcut-link.ps1') -Destination (Join-Path $staging 'scripts/shortcut-link.ps1')
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
    [System.IO.File]::WriteAllText((Join-Path $staging 'OPEN_FIRST.txt'), "拾页 Folio｜本地文件与网络资料管理书柜`r`n`r`n1. 完整解压到一个可写入的文件夹。`r`n2. 双击 start.cmd 即可打开；无需安装或注册账号。`r`n3. 可选：双击「创建快捷方式.cmd」，选择桌面、开始菜单或暂不创建。`r`n4. 启动窗口保持运行（可最小化），关闭它会停止书柜。`r`n5. 个人书柜数据在首次启动生成的 data 文件夹。`r`n6. 升级前退出旧版，把旧版 data 文件夹复制到新版目录。`r`n`r`n不会自动创建快捷方式或设置开机自启。`r`n由 OpenAI Codex 辅助设计、开发、测试，图标使用 AI 绘图。见 AI_USAGE.md。`r`n", $utf8)
} finally { Pop-Location }
$output = Join-Path $release 'Folio-Windows-x64.zip'
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $output -Force
Write-Host "Portable package: $output"
Write-Host "Stage directory: $staging"
