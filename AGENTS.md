# AGENTS.md

MAGNItola is a Windows x64 desktop app for downloading SoundCloud tracks, playlists, and likes and playing audio offline. It uses Electron with HTML, CSS, and vanilla JavaScript. These instructions apply throughout the repository.

## Commands

Run these commands from the repository root. Use Node.js 24 for local checks to match `.github/workflows/check.yml`. The commands below invoke `npm.cmd` directly in PowerShell.

| Task | Command |
| --- | --- |
| Install dependencies from the lockfile | `npm.cmd ci` |
| Launch the app | `npm.cmd start` |
| Run the offline regression tests | `npm.cmd test` |
| Lint JavaScript | `npm.cmd run lint` |
| Build the NSIS installer in `dist/` | `npm.cmd run build` |
| Build only the installer | `npm.cmd run build:installer` |

`npm run format` and `npm run lint:fix` run across the project. For a targeted change, apply formatting and lint fixes only to the files you edit. Follow `.prettierrc` and `eslint.config.mjs`. `lame.min.js` is a vendored library.

## Code map

| Files | Responsibilities |
| --- | --- |
| `main.js`, `preload.js` | Electron lifecycle, temporary session, IPC, file access, and the `media://` protocol. `preload.js` exposes `window.electronAPI`. |
| `library.cjs`, `js/player.js` | Asynchronous library scanning and metadata reads, playback queue, seeking, virtualized track list, and artwork cache. |
| `js/soundcloud.js`, `js/utils.js` | SoundCloud URL resolution and metadata, request retries, and shared utilities. |
| `js/downloader.js`, `js/download-track.js` | Download queue, progress, and cancellation. Fetching audio and artwork, encoding, and saving individual tracks. |
| `js/encoder-worker.js`, `js/id3.js` | MP3 encoding in a Web Worker and ID3v2.3 tag generation. |
| `index.html`, `css/styles.css`, `js/app.js`, `js/locales.js`, `js/config.js` | Markup and CSP, shared styles, event wiring, translations, and renderer settings. |

`main.js`, `preload.js`, and `library.cjs` use CommonJS. The renderer loads classic scripts from `index.html` and shares APIs through `window`. Add each script after its dependencies and before scripts that use it. When changing paths, check script order and `build.files` in `package.json`.

## Project conventions

- **Electron.** Keep context isolation and sandboxing enabled and `nodeIntegration` disabled. For a new OS operation, expose a narrowly scoped method in `preload.js` and register its handler in `registerIpcHandlers()`. Check the sender with `isTrustedSender()` and validate arguments in the main process. Preserve the CSP and navigation restrictions.
- **Files.** Use `getMediaUrl()` from `js/player.js` for local audio. Preserve HTTP Range support for seeking. When changing supported formats, keep scanner extensions and MIME types in `main.js` aligned. Save each track to a temporary `.part` file and rename it into place. Update the player only after `saveTrack` succeeds.
- **Downloads.** Pass the `AbortSignal` through the download pipeline, including request retries and encoding. Allow a new download after cancellation. Preserve playlist order and track positions when batch responses arrive out of order or contain repeated IDs. Skip existing files and keep a distinct status for DRM-protected streams. Pass compatible MP3 audio through without re-encoding and use 192 kbps by default when transcoding.
- **Library.** Keep scan depth and concurrency bounded. Load artwork on demand and cap the artwork cache. Only the latest scan may replace the track list. Merge tracks saved during that scan into the results exactly once.
- **Interface.** Add user-facing labels, tooltips, and status messages to both `ru` and `en` in `js/locales.js`. Use existing CSS variables, bundled JetBrains Mono, and square-cornered controls. Render track titles and error messages with `textContent`.

## Verification

- Run `npm.cmd test` and `npm.cmd run lint` after code changes. Follow the pattern in `test/regressions.cjs` for renderer regressions. It uses `node:test` and `vm` with network and IPC stubs.
- Launch the app to exercise the affected workflow after UI or IPC changes. For player changes, verify playback and seeking with local files. For UI changes, switch between Russian and English. For download queue lifecycle changes, verify that a download can be stopped and started again.
- Run the relevant Windows build when changing packaging or asset paths. Local build commands use `--publish never`. The workflow in `.github/workflows/build.yml` builds and publishes a GitHub release when a `v*` tag is pushed or the workflow is run manually.

`README.md` contains English and Russian user documentation. Use the code and configuration to verify commands, paths, and interfaces.
