# macOS runtime ownership and recovery — 2026-10-11

## Incident and recovery

A legacy user LaunchAgent started the development checkout on HTTPS port 443. The installed system daemon then repeatedly failed to bind that port. The checkout had separate, empty provider settings; the installed credential files were still present. The legacy agent was stopped and disabled, and the installed daemon recovered. Read-only provider checks confirmed configured keys and successful model catalog responses from OpenAI, DeepSeek, Gemini and AICredits. No credentials were printed, moved, reset or replaced.

## Hardening prepared

- macOS launchd owns IPv4 and IPv6 loopback HTTPS listening sockets. Server processes inherit them through launch_activate_socket instead of binding port 443 themselves. launchd retains listeners across crashes and restarts.
- Installed macOS service starts at boot and restarts on exit. A health monitor checks both local HTTPS listeners and its own process identity. Three consecutive failed checks trigger process recovery while launchd holds the sockets. Checks do not call any provider or use API keys.
- TLS negotiation runs in individual request threads with an inactivity timeout. A client that opens TCP but sends no TLS handshake no longer blocks the accept loop.
- Development startup on port 443 is rejected when a separate installed Orbit exists. Other development ports remain usable.
- The full updater migrates the existing launchd plist, retains its other settings, restores its previous configuration if bootstrap fails, and checks both HTTPS listeners before announcing completion. The web-only update deliberately does not perform this service migration.
- The installer/updater disables the legacy user agent. Fresh installs receive managed sockets automatically. The friend ZIP is rebuilt.

## Validation

- Python suite: 139 tests ran successfully, with 14 skipped (125 passed).
- After adding the updater migration regression, the focused recovery suite passed all 6 tests.
- Actual isolated macOS LaunchAgent on an ephemeral port: two forced SIGKILL crashes; a new process recovered each time; competing IPv4 and IPv6 binds remained rejected throughout the restart windows.
- Actual silent TCP client: concurrent IPv4 and IPv6 HTTPS health requests succeeded.
- Watchdog counter reset, repeated failures, wrong service/PID detection, development guard, strict activation failure and updater plist preservation checks passed.
- Packaged installer smoke checks passed fresh installation, reinstallation, full asset parity, resolver conflict handling, incomplete asset handling, certificate recovery and live HTTPS serving over IPv4/IPv6, including denial of private-key HTTP access.
- Bash syntax validation passed for installer and updater.

## Deployment and limits

The production service remains on its existing configuration until the user runs the full updater with their Mac password. Noninteractive sudo was unavailable. No protected system changes for socket activation were claimed as installed.

This hardening is for macOS. Windows retains its existing scheduled-task watchdog. It does not promise uninterrupted service through OS sleep, power loss, administrator removal/disablement of the service, a conflict already present before first installation, or arbitrary OS failure. It does not kill unrelated processes. Provider outages remain separate from local runtime availability.
