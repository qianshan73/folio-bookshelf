# Native wide-character shell links work with Chinese names on non-Chinese Windows.
if (-not ('Folio.ShortcutFile' -as [type])) {
    Add-Type @'
using System;
using System.IO;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using Microsoft.Win32.SafeHandles;
using FILETIME = System.Runtime.InteropServices.ComTypes.FILETIME;
namespace Folio {
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    internal class ShellLinkObject { }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    internal struct FindData {
        public uint Attributes;
        public FILETIME CreationTime, AccessTime, WriteTime;
        public uint SizeHigh, SizeLow, Reserved0, Reserved1;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=14)] public string AlternateName;
    }
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellLinkW {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, out FindData data, uint flags);
        void GetIDList(out IntPtr list);
        void SetIDList(IntPtr list);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
        void GetHotkey(out short value);
        void SetHotkey(short value);
        void GetShowCmd(out int value);
        void SetShowCmd(int value);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string value, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string value, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string value);
    }
    public class ShortcutInfo {
        public string Target, WorkingDirectory, Icon, Description;
        public int WindowStyle;
    }
    public static class ShortcutFile {
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern SafeFileHandle CreateFile(string file, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
        [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
        static extern void SHChangeNotify(uint change, uint flags, string path, IntPtr unused);
        public static string Canonical(string file) {
            using (var handle=CreateFile(file,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                var text=new StringBuilder(32768);
                uint length=GetFinalPathNameByHandle(handle,text,(uint)text.Capacity,0);
                if (length==0 || length>=text.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
                return text.ToString();
            }
        }
        public static void Create(string file,string target,string working,string icon,int iconIndex,string description,int style) {
            var link=(IShellLinkW)new ShellLinkObject();
            try {
                link.SetPath(target);
                link.SetWorkingDirectory(working);
                link.SetIconLocation(icon,iconIndex);
                link.SetDescription(description);
                link.SetShowCmd(style);
                ((IPersistFile)link).Save(file,true);
                SHChangeNotify(0x2000,5,file,IntPtr.Zero);
            } finally { Marshal.FinalReleaseComObject(link); }
        }
        public static ShortcutInfo Read(string file) {
            var link=(IShellLinkW)new ShellLinkObject();
            try {
                ((IPersistFile)link).Load(file,0);
                var target=new StringBuilder(32768); FindData data;
                link.GetPath(target,target.Capacity,out data,4);
                var working=new StringBuilder(32768); link.GetWorkingDirectory(working,working.Capacity);
                var icon=new StringBuilder(32768); int index; link.GetIconLocation(icon,icon.Capacity,out index);
                var description=new StringBuilder(1024); link.GetDescription(description,description.Capacity);
                int style; link.GetShowCmd(out style);
                return new ShortcutInfo { Target=target.ToString(),WorkingDirectory=working.ToString(),Icon=icon.ToString()+","+index,Description=description.ToString(),WindowStyle=style };
            } finally { Marshal.FinalReleaseComObject(link); }
        }
        public static void NotifyRemoved(string file) { SHChangeNotify(4,5,file,IntPtr.Zero); }
    }
}
'@
}
