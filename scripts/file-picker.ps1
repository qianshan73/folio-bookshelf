param(
    [ValidateSet('files','folder')][string]$Kind = 'files',
    [Parameter(Mandatory=$true)][string]$SignalPath,
    [int]$ParentPid = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FolioPickerWindow {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
    public static IntPtr Find(uint wantedPid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (pid == wantedPid && IsWindowVisible(h)) {
                var name = new StringBuilder(128);
                GetClassName(h, name, name.Capacity);
                if (name.ToString() == "#32770") { found = h; return false; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static void Raise(IntPtr h) {
        if (h == IntPtr.Zero) return;
        ShowWindow(h, 9);
        SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0043);
        uint ignored;
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint currentThread = GetCurrentThreadId();
        bool attached = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
        try { BringWindowToTop(h); SetForegroundWindow(h); }
        finally { if (attached) AttachThreadInput(currentThread, foregroundThread, false); }
    }
    public static void Close(IntPtr h) {
        if (h != IntPtr.Zero) PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
    }
}
'@

# An explicit, transparent, topmost owner prevents an ownerless dialog opening
# behind the browser. windowsHide hides only the console, not this modal picker.
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'FolioPickerOwner'
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0
$owner.StartPosition = 'Manual'
$owner.Size = New-Object System.Drawing.Size(1,1)
$work = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
$owner.Location = New-Object System.Drawing.Point(($work.Left + $work.Width / 2),($work.Top + $work.Height / 2))
$title = if ($env:FOLIO_PICKER_TITLE) { $env:FOLIO_PICKER_TITLE } else { 'Folio - Select' }
if ($Kind -eq 'folder') {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $title
    $dialog.ShowNewFolderButton = $true
} else {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Multiselect = $true
    $dialog.Title = $title
    $dialog.CheckFileExists = $true
    $dialog.RestoreDirectory = $true
}
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 120
$script:lastSignal = ''
$script:raiseUntil = $null
$timer.Add_Tick({
    if ($ParentPid -gt 0) {
        try { $parentProcess = [Diagnostics.Process]::GetProcessById($ParentPid); $parentProcess.Dispose() }
        catch { [Environment]::Exit(0) }
    }
    $handle = [FolioPickerWindow]::Find([uint32]$PID)
    if ($handle -eq [IntPtr]::Zero) { return }
    if ($null -eq $script:raiseUntil) { $script:raiseUntil = [DateTime]::UtcNow.AddSeconds(1.5) }
    # The modern Explorer dialog initializes in several stages. Retry during
    # its first frames instead of treating the first visible frame as active.
    if ([DateTime]::UtcNow -lt $script:raiseUntil) { [FolioPickerWindow]::Raise($handle) }
    try { $signal = [IO.File]::ReadAllText($SignalPath) } catch { return }
    if ($signal -eq $script:lastSignal) { return }
    $script:lastSignal = $signal
    if ($signal.StartsWith('focus:')) { [FolioPickerWindow]::Raise($handle) }
    elseif ($signal.StartsWith('cancel:')) { [FolioPickerWindow]::Close($handle) }
})
try {
    $owner.Show()
    $timer.Start()
    $result = $dialog.ShowDialog($owner)
    $paths = @()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        if ($Kind -eq 'folder') { $paths = @($dialog.SelectedPath) }
        else { $paths = @($dialog.FileNames) }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject $paths))
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    $timer.Stop()
    $timer.Dispose()
    $dialog.Dispose()
    $owner.Close()
    $owner.Dispose()
}
