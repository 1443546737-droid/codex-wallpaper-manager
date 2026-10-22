# Working on this repository

This project distributes only the Codex wallpaper manager. Keep changes scoped to wallpaper discovery, media rendering, the floating manager, transparent Codex surfaces, installation and documentation.

For a user asking to install the project, follow INSTALL_FOR_CODEX.md. Do not publish a repository, terminate Codex, replace unrelated shortcuts or modify desktop wallpaper settings merely because this file exists. Those actions need authorization from the user.

Keep all machine paths discovered at runtime. Never commit local state, full screenshots of user desktops, third-party wallpaper media, credentials, logs or thumbnail/transcode caches. Preserve LICENSE and NOTICE.md.

Run `npm run verify` for changes to the manager or backend. Windows installation tests run in an isolated temporary directory and do not launch Codex. Browser tests need Playwright and either its Chromium browser, Windows Edge or an explicit CODEX_WALLPAPER_TEST_BROWSER path.
