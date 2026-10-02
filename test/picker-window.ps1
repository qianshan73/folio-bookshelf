param([Parameter(Mandatory=$true)][int]$TargetPid, [ValidateSet('inspect','lower','close')][string]$Action='inspect')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PickerTest {
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int i);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int height,uint f);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 public static IntPtr Find(uint target) {
  IntPtr result=IntPtr.Zero;
  EnumWindows(delegate(IntPtr h,IntPtr l) { uint p; GetWindowThreadProcessId(h,out p); var name=new StringBuilder(128); GetClassName(h,name,128); if(p==target&&IsWindowVisible(h)&&name.ToString()=="#32770"){result=h;return false;}return true;},IntPtr.Zero);
  return result;
 }
}
'@
$h=[PickerTest]::Find([uint32]$TargetPid)
if($h -ne [IntPtr]::Zero){
 if($Action -eq 'lower'){
  $owner=[PickerTest]::GetWindow($h,4)
  if($owner -ne [IntPtr]::Zero){[void][PickerTest]::SetWindowPos($owner,[IntPtr](-2),0,0,0,0,0x0013)}
  [void][PickerTest]::SetWindowPos($h,[IntPtr](-2),0,0,0,0,0x0013)
 }
 elseif($Action -eq 'close'){[void][PickerTest]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)}
}
$foregroundWindow=[PickerTest]::GetForegroundWindow()
$foregroundPid=[uint32]0
[void][PickerTest]::GetWindowThreadProcessId($foregroundWindow,[ref]$foregroundPid)
$foregroundTitle=New-Object Text.StringBuilder(512)
[void][PickerTest]::GetWindowText($foregroundWindow,$foregroundTitle,512)
$title=New-Object Text.StringBuilder(512)
[void][PickerTest]::GetWindowText($h,$title,512)
@{visible=($h -ne [IntPtr]::Zero);topmost=($h -ne [IntPtr]::Zero -and (([PickerTest]::GetWindowLong($h,-20) -band 8) -ne 0));foreground=($h -ne [IntPtr]::Zero -and $foregroundWindow -eq $h);foregroundPid=$foregroundPid;title=$title.ToString();foregroundTitle=$foregroundTitle.ToString()} | ConvertTo-Json -Compress
