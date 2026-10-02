param(
    [ValidateSet('Choose','Desktop','StartMenu','Both','None')][string]$Destination = 'Choose',
    [ValidateSet('Create','Remove')][string]$Action = 'Create',
    [string]$DesktopDirectory = '',
    [string]$StartMenuDirectory = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
trap {
    $failure = $_.Exception.Message
    if ($Destination -eq 'Choose') {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [Windows.Forms.MessageBox]::Show($failure,'拾页书柜 · 快捷方式','OK','Error') | Out-Null
        } catch { [Console]::Error.WriteLine($failure) }
    } else { [Console]::Error.WriteLine($failure) }
    exit 1
}
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcher = Join-Path $root 'start.cmd'
$icon = Join-Path $root 'public/icons/folio.ico'
$result = @{ created = @(); removed = @(); skipped = @() }
if ($Destination -eq 'None') { $result | ConvertTo-Json -Compress; exit 0 }
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf) -or -not (Test-Path -LiteralPath $icon -PathType Leaf)) {
    throw '请完整解压拾页书柜，保留 start.cmd 和 public/icons/folio.ico。'
}
if (-not $DesktopDirectory) { $DesktopDirectory = [Environment]::GetFolderPath('Desktop') }
if (-not $StartMenuDirectory) { $StartMenuDirectory = [Environment]::GetFolderPath('Programs') }
$desktop = [IO.Path]::GetFullPath($DesktopDirectory)
$programs = [IO.Path]::GetFullPath($StartMenuDirectory)
. (Join-Path $PSScriptRoot 'shortcut-link.ps1')
$launcherIdentity = [Folio.ShortcutFile]::Canonical($launcher)

function Test-OwnedShortcut([string]$File) {
    try {
        $target = [Folio.ShortcutFile]::Read($File).Target
        if (-not $target -or -not [IO.Path]::IsPathRooted($target) -or -not (Test-Path -LiteralPath $target -PathType Leaf)) { return $false }
        # Compare physical Windows file names, including 8.3 path aliases.
        return [Folio.ShortcutFile]::Canonical($target) -eq $launcherIdentity
    } catch { return $false }
}
function Get-OwnedShortcuts([string]$Directory) {
    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $Directory -File -Filter '*.lnk' | Where-Object {
        $_.Name -match '^拾页书柜(?: \(\d+\))?\.lnk$' -and (Test-OwnedShortcut $_.FullName)
    } | Sort-Object Name)
}
function Invoke-Shortcuts([string]$Choice, [string]$Operation) {
    $answer = @{ created = @(); removed = @(); skipped = @() }
    $directories = switch ($Choice) {
        'Desktop' { @($desktop) }
        'StartMenu' { @($programs) }
        'Both' { @($desktop,$programs) }
        default { @() }
    }
    foreach ($directory in ($directories | Select-Object -Unique)) {
        $owned = @(Get-OwnedShortcuts $directory)
        if ($Operation -eq 'Remove') {
            foreach ($file in $owned) {
                # Remove only this project's exact .lnk, never a target or a folder.
                $full = [IO.Path]::GetFullPath($file.FullName)
                if ([Folio.ShortcutFile]::Canonical([IO.Path]::GetDirectoryName($full)) -ne [Folio.ShortcutFile]::Canonical($directory) -or -not (Test-OwnedShortcut $full)) {
                    throw '快捷方式位置发生变化，未执行移除。'
                }
                Remove-Item -LiteralPath $full
                [Folio.ShortcutFile]::NotifyRemoved($full)
                $answer.removed += $full
            }
            if (-not $owned.Count) { $answer.skipped += $directory }
            continue
        }
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            [IO.Directory]::CreateDirectory($directory) | Out-Null
        }
        if ($owned.Count) { $shortcutPath = $owned[0].FullName }
        else {
            $shortcutPath = Join-Path $directory '拾页书柜.lnk'
            $n = 2
            while (Test-Path -LiteralPath $shortcutPath) {
                if ($n -gt 100) { throw '快捷方式重名太多，请先整理此位置。' }
                $shortcutPath = Join-Path $directory ("拾页书柜 ($n).lnk")
                $n++
            }
        }
        [Folio.ShortcutFile]::Create($shortcutPath,$launcher,$root,$icon,0,'拾页 Folio｜本地文件与网络资料管理书柜：双击启动，已运行时直接打开现有页面。',7)
        if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf) -or -not (Test-OwnedShortcut $shortcutPath)) {
            throw '快捷方式未能正确保存，请检查此位置是否可写。'
        }
        $answer.created += $shortcutPath
    }
    return $answer
}
try {
    if ($Destination -ne 'Choose') {
        Invoke-Shortcuts $Destination $Action | ConvertTo-Json -Compress
        exit 0
    }
    # This chooser runs only when the optional CMD is explicitly opened.
    # Normal startup never creates shortcuts or opens this window.
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()
    $form = New-Object Windows.Forms.Form
    $form.Text = '拾页书柜 · 可选快捷方式'
    $form.ClientSize = New-Object Drawing.Size(520,430)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.Font = New-Object Drawing.Font('Microsoft YaHei UI',10)
    $form.BackColor = [Drawing.ColorTranslator]::FromHtml('#f7f7f2')
    $form.Icon = New-Object Drawing.Icon($icon)
    $picture = New-Object Windows.Forms.PictureBox
    $picture.Location = New-Object Drawing.Point(28,25)
    $picture.Size = New-Object Drawing.Size(76,76)
    $picture.SizeMode = 'Zoom'
    $picture.Image = [Drawing.Image]::FromFile((Join-Path $root 'public/icons/folio.png'))
    $form.Controls.Add($picture)
    $heading = New-Object Windows.Forms.Label
    $heading.Location = New-Object Drawing.Point(122,30)
    $heading.Size = New-Object Drawing.Size(365,65)
    $heading.Text = "给书柜留一个快捷入口`r`n你可以选择创建，也可以暂不创建。"
    $form.Controls.Add($heading)
    $desktopCheck = New-Object Windows.Forms.CheckBox
    $desktopCheck.Location = New-Object Drawing.Point(32,119)
    $desktopCheck.Size = New-Object Drawing.Size(450,30)
    $desktopCheck.Text = '桌面：双击「拾页书柜」直接打开'
    $desktopCheck.Checked = $true
    $form.Controls.Add($desktopCheck)
    $menuCheck = New-Object Windows.Forms.CheckBox
    $menuCheck.Location = New-Object Drawing.Point(32,160)
    $menuCheck.Size = New-Object Drawing.Size(450,30)
    $menuCheck.Text = '开始菜单：搜索「拾页书柜」打开'
    $form.Controls.Add($menuCheck)
    $notice = New-Object Windows.Forms.Label
    $notice.Location = New-Object Drawing.Point(32,210)
    $notice.Size = New-Object Drawing.Size(455,55)
    $notice.Text = "只创建启动入口，不复制你的文件，不设置开机自启。`r`n移动整个项目文件夹后，请重新运行这个工具。"
    $form.Controls.Add($notice)
    $status = New-Object Windows.Forms.Label
    $status.Location = New-Object Drawing.Point(32,280)
    $status.Size = New-Object Drawing.Size(455,44)
    $status.ForeColor = [Drawing.ColorTranslator]::FromHtml('#345447')
    $form.Controls.Add($status)
    $create = New-Object Windows.Forms.Button
    $create.Text = '创建所选快捷方式'
    $create.Location = New-Object Drawing.Point(32,343)
    $create.Size = New-Object Drawing.Size(172,40)
    $create.BackColor = [Drawing.ColorTranslator]::FromHtml('#345447')
    $create.ForeColor = [Drawing.Color]::White
    $create.FlatStyle = 'Flat'
    $form.Controls.Add($create)
    $skip = New-Object Windows.Forms.Button
    $skip.Text = '暂不创建 / 关闭'
    $skip.Location = New-Object Drawing.Point(331,343)
    $skip.Size = New-Object Drawing.Size(155,40)
    $skip.DialogResult = 'Cancel'
    $form.CancelButton = $skip
    $form.Controls.Add($skip)
    $remove = New-Object Windows.Forms.Button
    $remove.Text = '移除所选入口'
    $remove.Location = New-Object Drawing.Point(212,343)
    $remove.Size = New-Object Drawing.Size(111,40)
    $form.Controls.Add($remove)
    $run = {
        param([string]$operation)
        $choice = if ($desktopCheck.Checked -and $menuCheck.Checked) { 'Both' } elseif ($desktopCheck.Checked) { 'Desktop' } elseif ($menuCheck.Checked) { 'StartMenu' } else { 'None' }
        if ($choice -eq 'None') { $status.Text = '请勾选一个位置，或点击「暂不创建 / 关闭」。'; return }
        try {
            $answer = Invoke-Shortcuts $choice $operation
            if ($operation -eq 'Create') { $status.Text = '已创建！关闭窗口后，即可从所选位置打开书柜。' }
            else { $status.Text = "已移除 $($answer.removed.Count) 个本项目入口，书柜和文件仍保留。" }
        } catch { $status.Text = $_.Exception.Message }
    }
    $create.Add_Click({ & $run 'Create' })
    $remove.Add_Click({ & $run 'Remove' })
    $form.AcceptButton = $create
    try { $form.ShowDialog() | Out-Null }
    finally { $picture.Image.Dispose(); $form.Icon.Dispose(); $form.Dispose() }
} catch { throw }
