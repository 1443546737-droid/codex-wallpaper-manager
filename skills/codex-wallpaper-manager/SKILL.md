---
name: codex-wallpaper-manager
description: Install, launch, inspect, adjust or remove Codex Wallpaper Manager on Windows using downloaded local Wallpaper Engine video and image assets. Use for this manager's transparent chat or file panels, framing, soundtrack and library filters; not for controlling the Windows desktop wallpaper.
---

# Codex Wallpaper Manager

For a user-authorized installation from this repository, read `README.md` and `INSTALL_FOR_CODEX.md` at the repository root. Check Windows, Node.js 22+, the installed Codex executable and local Wallpaper Engine media. Run `scripts/install.ps1` from a complete checkout or extracted release. Installation creates a dedicated runtime, adds one managed MCP entry and a standalone `Codex Wallpaper` shortcut. It does not close a running Codex session.

For an installed copy, locate `CodexWallpaperManager/installation.json` under the user's local application-data folder. Use its recorded runtime, state and service paths rather than inventing paths. Read status and enumerate local wallpaper ids before selecting a wallpaper.

The floating panel is the normal control surface while the independent wallpaper service owns the renderer. It supports image/video selection, ratings, framing, volume, opacity and glass surfaces. Do not start a second renderer owner. Do not delete saved settings or remove the layer when a chat finishes.

If the debug connection is unavailable, explain that the user must fully quit Codex and reopen it through `Codex Wallpaper` once. Keep the active conversation running; do not terminate Codex yourself. A later normal launch without the local debug flag cannot accept the wallpaper layer.

Connect only to targets whose URL is exactly `app://-/index.html`. Exclude login pages, embedded browsers and detached windows. Use only enumerated local project media. Never run a Scene/Web project as executable web content, modify wallpaper source files or control Wallpaper Engine desktop playback. Scene/Web projects use their preview images. Age filters reflect project metadata, and missing ratings remain unrated.

Wallpaper Engine and Steam need not remain running once local files have been downloaded. The local wallpaper service must stay running while Codex displays the skin. Video sound controls only that video's own audio track; keep it muted until the user enables sound. There is no startup animation component.

For removal, run the installed `scripts/uninstall.ps1` with the recorded installation root. It removes only managed entries and shortcuts. Settings remain unless the user explicitly requests `-Purge`.
