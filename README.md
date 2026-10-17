# HWMon downloads

The current release is [HWMon 2.2.0](https://github.com/adamgva/hwmon-download/releases/tag/v2.2.0). All four hosts and both consoles are available below.

| Product | Download |
| --- | --- |
| Windows LAN host | [Windows x64](https://github.com/adamgva/hwmon-download/releases/download/v2.2.0/HWMon-Windows-LAN-2.2.0.exe) |
| Windows Online host | [Windows x64](https://github.com/adamgva/hwmon-download/releases/download/v2.2.0/HWMon-Windows-Online-2.2.0.exe) |
| Mac LAN host | [Apple silicon](https://github.com/adamgva/hwmon-download/releases/download/v2.2.0/HWMon-Mac-LAN-2.2.0.zip) |
| Mac Online host | [Apple silicon](https://github.com/adamgva/hwmon-download/releases/download/v2.2.0/HWMon-Mac-Online-2.2.0.zip) |
| Mac console | [Native Mac app](https://github.com/adamgva/hwmon-download/releases/download/v2.2.0/HWMon-Console-Mac-2.2.0.zip) |
| Web console | [Mac app with bundled gateway and Node runtime](https://github.com/adamgva/hwmon-download/releases/download/v2.2.0/HWMon-Console-Web-2.2.0.zip) |

Mac builds require Apple silicon and macOS 14.5 or newer. Windows hosts run as a standard user. LAN and Online are alternative host builds, so use one per computer. Online hosts retain their existing enrollment, and both consoles use the existing authorized viewer identity. New online hosts need private enrollment setup.

Windows includes cancellation-safe HTTPS polling, bounded video recovery and a watchdog that restarts a stalled online loop. Mac hosts include the authenticated HTTPS session fix, signed LAN updates and a fix for simultaneous identity creation during startup.

Both consoles support taking over a host held by another viewer. The web console adds shared reverse LAN listeners, multiple pinned hosts, connection fallback and isolated relay memory for each tab. Its app includes the local gateway, LAN connector, Node runtime and Node license. The native console's encrypted installation portal also contains the current 2.2.0 hosts.

The release includes SHA-256 checksums, a source revision manifest, the Mac LAN update manifest and installation scripts. Mac apps are signed with the existing Apple Development identity and are not notarized. Use macOS Open Anyway when opening a downloaded app for the first time if Gatekeeper requests it.

Validation covers Rust and Swift tests, Windows installer fixtures, web browser tests, native QUIC integration, the Windows x64 cross-build and Mac signatures. Installation and interactive desktop sessions on actual remote hosts have not been verified for this release.

The generic HWMon.exe, HWMon.bin and HWMon.b64.txt assets retain the deployed 2.1.53 recovery feed for older recovery scripts. Use the named 2.2.0 downloads above for the current hosts. Posting this release does not advance deployed update feeds.
