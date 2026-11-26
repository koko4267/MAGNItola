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
| Build the Windows x64 NSIS installer in `dist/` | `npm.cmd run build` (`npm.cmd run build:installer` calls the same script) |

`npm run format` and `npm run lint:fix` run across the project. For a targeted change, apply formatting and lint fixes only to the files you edit. Follow `.prettierrc` and `eslint.config.mjs`. `lame.min.js` is a vendored library.

## Code map

| Files | Responsibilities |
| --- | --- |
| `main.js`, `preload.js` | Main owns the window, temporary session, directory authorization, IPC handlers and `media://`. Preload exposes scoped operations as `window.electronAPI`. |
| `track-files.cjs` | Shared target selection for existence checks and saves, SoundCloud identity matching, filename collisions, per-directory write serialization and temporary files. |
| `library.cjs`, `js/player.js` | The scanner enumerates audio files and reads ID3 metadata and covers. The player merges scan results, virtualizes the list, caches artwork and handles playback and seeking. |
| `js/soundcloud.js`, `js/utils.js` | URL resolution, client ID refresh through the bridge, playlist batches and likes pagination. Utilities handle fetch retries, backoff and name sanitization. |
| `js/downloader.js`, `js/download-track.js` | `startDownloadFlow()` owns the queue, job cancellation and status UI. `downloadTrack()` handles one track from stream selection through encoding, IPC save and player update. |
| `js/encoder-worker.js`, `js/id3.js` | MP3 encoding in a Web Worker and ID3v2.3 tag generation. |
| `index.html`, `css/styles.css`, `js/app.js`, `js/locales.js`, `js/config.js` | Markup and CSP, shared styles, event wiring, translations, and renderer settings. |

`main.js`, `preload.js`, `library.cjs` and `track-files.cjs` use CommonJS. The renderer loads classic scripts from `index.html` and shares APIs through `window`. Load each script after its dependencies. The encoder worker loads `lame.min.js` via `importScripts`. When adding or moving a runtime file, check its loading path and the `build.files` list in `package.json`.

## Project conventions

- **Electron.** Keep context isolation and sandboxing enabled and `nodeIntegration` disabled. For a new OS operation, expose a narrowly scoped method in `preload.js` and register its handler in `registerIpcHandlers()`. Check the sender with `isTrustedSender()` and validate arguments in the main process. Preserve the CSP and navigation restrictions.
- **Saving.** Use the same target-selection logic for `checkTrackFile()` and `saveTrackFile()`. A matching SoundCloud ID or legacy permalink tag can identify an existing track. A matching filename alone is insufficient. Preserve distinct same-name tracks, serialize saves in each directory, write to a unique `.part` file and recheck the destination before renaming. Add a newly saved track to the player using the actual path returned by `saveTrack`.
- **Playback.** Use `getMediaUrl()` in `js/player.js` for local audio. Main checks that a registered path still resolves inside its authorized root. Preserve HTTP Range responses for seeking. When adding an audio format, update the scanner extensions in `library.cjs` and the media MIME map in `main.js` together.
- **Downloads.** Pass the `AbortSignal` through the download pipeline, including request retries and encoding. Allow a new download after cancellation. Preserve playlist order and track positions when batch responses arrive out of order or contain repeated IDs. Skip existing files and keep a distinct status for DRM-protected streams. Pass compatible MP3 audio through without re-encoding and use 192 kbps by default when transcoding.
- **Library.** Keep scan depth and concurrency bounded. Load artwork on demand and cap the artwork cache. Only the latest scan may replace the track list. Merge tracks saved during that scan into the results exactly once.
- **Interface.** Add user-facing labels, tooltips, and status messages to both `ru` and `en` in `js/locales.js`. Use existing CSS variables, bundled JetBrains Mono, and square-cornered controls. Render track titles and error messages with `textContent`.

## Verification

- Run `npm.cmd test` and `npm.cmd run lint` after code changes. In `test/regressions.cjs`, use the existing `renderer()` helper to load the affected classic scripts with `node:vm` and stub network or IPC at the boundary. Use temporary directories for tests of real scans, metadata and saves.
- Launch the app to exercise the affected workflow after UI or IPC changes. For player changes, verify playback and seeking with local files. For UI changes, switch between Russian and English. For download queue lifecycle changes, verify that a download can be stopped and started again.
- For packaging or asset-path changes, build locally and check the affected files in `dist/win-unpacked/` (packaged app files are in `resources/app.asar`). Both local build commands use `--publish never`. The release workflow in `.github/workflows/build.yml` publishes on a `v*` tag push or manual dispatch.

`README.md` contains English and Russian user documentation. Use the code and configuration to verify commands, paths, and interfaces.
