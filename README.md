# Paradox Command Center 1.0.0

A Windows desktop control panel for one Paradox Prime WordPress installation. It talks directly to WordPress over HTTPS through a small, capability-gated connector plugin. There is no third-party relay service.

## Included

- `desktop/` — Electron desktop app source (Windows x64 NSIS installer + portable EXE build configuration).
- `wordpress/paradox-command-center-connector/` — WordPress REST connector source.
- `connector/Paradox-Command-Center-Connector-1.0.0.zip` — installable WordPress plugin.
- `scripts/build-windows.bat` — build the Windows `.exe` installer and portable app.
- `docs/` — installation, security and test-limit notes.

## Important build status

This delivery contains the complete application source and the WordPress connector. It does **not** contain a compiled Windows `.exe`: this build environment is Linux and does not have the Windows packaging toolchain/Wine needed to produce and test the Windows installer. Build it on a Windows PC using the steps below.

## Build on Windows 10/11 (x64)

1. Install Node.js 22 or newer (LTS recommended) and Git only if you want to use version control.
2. Extract this project ZIP to a normal folder, for example `C:\ParadoxCommandCenter`.
3. Double-click `scripts\build-windows.bat`.
4. The script installs the pinned dependencies and builds the app.
5. Find outputs in `release\`:
   - `Paradox-Command-Center-1.0.0-x64.exe` (NSIS installer; exact artifact naming may include x64 in its name).
   - `Paradox-Command-Center-1.0.0-Portable-x64.exe` (portable build).

The app is not Authenticode-signed in this starter, so Windows SmartScreen may show an unknown-publisher warning. Do not distribute it publicly as a trusted release until it has been code-signed and reviewed.

## Connect your site

1. Back up the WordPress site with WPvivid (files and database).
2. In WordPress Admin → Plugins → Add New Plugin → Upload Plugin, install `connector/Paradox-Command-Center-Connector-1.0.0.zip` and activate it.
3. Use an administrator WordPress account with the necessary plugin/theme capabilities. A separate admin account dedicated to the app is preferable.
4. In WordPress → Users → Profile → Application Passwords, create an Application Password named `Paradox Command Center`.
5. Launch the Windows app. Enter the HTTPS site URL, WordPress username and the new Application Password.
6. Click **Connect securely**. The app verifies the WordPress account and connector before saving the credentials.

The Application Password is encrypted by Electron `safeStorage` on Windows (Windows credential protection/DPAPI). It is not exposed to the renderer UI and is removed from local storage when Disconnect is used. Do not share the app or the Windows account with other people.

## Scope and safeguards

- Plugin list, upload/install, activate, deactivate, update and delete.
- Theme list, upload/install, activate, update and delete.
- Live status refresh while the app is open; automatic reconnection attempts every 30 seconds.
- Up to 200 recent actions in the connector's activity log.
- HTTPS only; WordPress capability checks on each route.
- New plugin/theme uploads are installed but **not automatically activated**.
- Active plugins must be deactivated before deletion. Network-active plugins are not controlled by this single-site app.
- Active theme and active parent theme cannot be deleted.
- Plugin deletion does not erase that plugin's database data.

Not included in 1.0.0: unrestricted file manager, arbitrary SQL/database editing, user/password management, cPanel control, full-site backup/restore, or access while the desktop app is closed. Use WordPress/WPvivid/cPanel for those tasks. The app is a control client, not a replacement for a secure WordPress admin account.

## Security notes

- Only connect to a real HTTPS WordPress site. Do not disable TLS checks or use a self-signed certificate.
- Use an Application Password, not your normal WordPress password.
- Keep Windows updated, use a device PIN/password, and lock the PC when unattended.
- The app itself has full admin powers for the connected WordPress account. Anyone able to use the unlocked app can perform those actions.
- No remote code execution route is provided. The connector exposes only listed plugin/theme/status/activity operations.
- The activity log is bounded to the latest 200 connector actions. It is not a complete hosting or WordPress security log.

## Development checks

- Main process: `desktop/main.js`
- Preload allowlist: `desktop/preload.js`
- Renderer: `desktop/renderer.js`
- UI uses local files only and has a restrictive Content Security Policy.
- No credentials are stored in renderer localStorage/sessionStorage.
