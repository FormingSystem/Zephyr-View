// Windows PowerShell loads this adapter against the host's Configuration Manager.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WindowsProbeDevices
{
    private const uint Present = 0x100;
    private const uint BufferSmall = 0x1A;
    private const uint HasProblem = 0x400;
    private const uint DeviceDescription = 1;
    private const uint FriendlyName = 13;

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_Device_ID_List_Size(out uint length, string filter, uint flags);

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_Device_ID_List(string filter, [Out] char[] ids, uint length, uint flags);

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Locate_DevNode(out uint node, string id, uint flags);

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_DevNode_Registry_Property(uint node, uint property, IntPtr type,
        [Out] byte[] value, ref uint bytes, uint flags);

    [DllImport("cfgmgr32.dll", ExactSpelling = true)]
    private static extern uint CM_Get_DevNode_Status(out uint status, out uint problem, uint node, uint flags);

    public class Device
    {
        public string Name { get; set; }
        public string PNPDeviceID { get; set; }
        public uint? ConfigManagerErrorCode { get; set; }
    }

    private static string[] PresentIds()
    {
        // A hot-plug between calls can enlarge the MULTI_SZ buffer.
        for (int attempt = 0; attempt < 3; attempt++)
        {
            uint length;
            uint result = CM_Get_Device_ID_List_Size(out length, null, Present);
            if (result != 0) throw new InvalidOperationException("CM_Get_Device_ID_List_Size: " + result);
            char[] ids = new char[length];
            result = CM_Get_Device_ID_List(null, ids, length, Present);
            if (result == 0) return new string(ids).Split(new char[] { '\0' }, StringSplitOptions.RemoveEmptyEntries);
            if (result != BufferSmall) throw new InvalidOperationException("CM_Get_Device_ID_List: " + result);
        }
        throw new InvalidOperationException("The list of connected devices changed. Refresh to try again.");
    }

    private static string ReadName(uint node, uint property)
    {
        uint size = 0;
        if (CM_Get_DevNode_Registry_Property(node, property, IntPtr.Zero, null, ref size, 0) != BufferSmall || size == 0)
            return null;
        byte[] buffer = new byte[size];
        if (CM_Get_DevNode_Registry_Property(node, property, IntPtr.Zero, buffer, ref size, 0) != 0)
            return null;
        return Encoding.Unicode.GetString(buffer, 0, (int)size).TrimEnd('\0');
    }

    public static IEnumerable<Device> Enumerate()
    {
        foreach (string id in PresentIds())
        {
            if (!(id.StartsWith("USB\\", StringComparison.OrdinalIgnoreCase) ||
                  id.StartsWith("HID\\", StringComparison.OrdinalIgnoreCase) ||
                  id.StartsWith("FTDIBUS\\", StringComparison.OrdinalIgnoreCase))) continue;
            uint node, status, problem;
            if (CM_Locate_DevNode(out node, id, 0) != 0) continue; // Unplugged after the snapshot.
            uint? code = null;
            if (CM_Get_DevNode_Status(out status, out problem, node, 0) == 0)
                code = (status & HasProblem) == 0 ? 0 : problem;
            yield return new Device {
                PNPDeviceID = id,
                Name = ReadName(node, FriendlyName) ?? ReadName(node, DeviceDescription) ?? id,
                ConfigManagerErrorCode = code
            };
        }
    }
}
