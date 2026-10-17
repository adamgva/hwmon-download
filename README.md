# HWMon downloads

The current release is [HWMon 2.2.1](https://github.com/adamgva/hwmon-download/releases/tag/v2.2.1). All four hosts and both consoles are available below.

| Product | Download |
| --- | --- |
| Windows LAN host | [Windows x64](https://github.com/adamgva/hwmon-download/releases/download/v2.2.1/HWMon-Windows-LAN-2.2.1.exe) |
| Windows Online host | [Windows x64](https://github.com/adamgva/hwmon-download/releases/download/v2.2.1/HWMon-Windows-Online-2.2.1.exe) |
| Mac LAN host | [Apple silicon](https://github.com/adamgva/hwmon-download/releases/download/v2.2.1/HWMon-Mac-LAN-2.2.1.zip) |
| Mac Online host | [Apple silicon](https://github.com/adamgva/hwmon-download/releases/download/v2.2.1/HWMon-Mac-Online-2.2.1.zip) |
| Mac console | [Native Mac app](https://github.com/adamgva/hwmon-download/releases/download/v2.2.1/HWMon-Console-Mac-2.2.1.zip) |
| Web console | [Mac app with bundled gateway and Node runtime](https://github.com/adamgva/hwmon-download/releases/download/v2.2.1/HWMon-Console-Web-2.2.1.zip) |

Control messages now retain partial packet data when a receive is canceled. Previously, a video or desktop event could interrupt a fragmented read and cause the next valid message to be rejected.

The web console reserves a LAN update before staging files, so simultaneous requests cannot overwrite each other's transfer state. Update timeouts release the affected session without stopping the shared listener or another host's session. Mac hosts also bound incoming update transfers and stop stalled stream reads, including a sender that never finishes its upload.

The web console also opens correctly when its app is stored inside a hidden parent directory.

New-computer provisioning now uses the current enrollment key, verified against all three production origins. Older signed baselines keep their original key for validation, and existing computer identities remain unchanged.

The audit compared the earlier branches, saved uncommitted snapshots and release modes. The earlier reconnect, HTTPS polling, watchdog, capture recovery, identity preservation, signed update and rollback work remains included. The native console's encrypted installation portal contains 2.2.1 Windows and Mac hosts.

Mac builds require Apple silicon and macOS 14.5 or newer. Windows hosts run as a standard user. LAN and Online are alternative host builds. Online hosts retain their existing enrollment, and both consoles use the existing authorized viewer identity. New online hosts need private enrollment setup.

Mac apps are signed with the existing Apple Development identity and are not notarized. Use macOS Open Anyway when opening a downloaded app for the first time if Gatekeeper requests it. SHA256SUMS.txt and release.json identify the published files and source revision.

Validation includes regression tests that reproduce the canceled packet read, simultaneous update requests and stalled transfers, plus the platform and console suites. Actual remote host installation and interactive desktop sessions have not been verified for this release.

The generic HWMon.exe, HWMon.bin and HWMon.b64.txt assets retain the deployed 2.1.53 recovery feed for older scripts. Use the named 2.2.1 downloads above for the current hosts. Deployed update feeds and installed applications are unchanged, and 2.2.0 remains available for rollback.
