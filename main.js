const { app, BrowserWindow, shell, ipcMain, dialog, protocol, session, clipboard, net } = require('electron');
const path = require('path');
const os = require('os');
const { scanLibrary, readTrackCover } = require('./library.cjs');
const { checkTrackFile, saveTrackFile } = require('./track-files.cjs');
const fs = require('fs');
const { Readable } = require('stream');
const { pathToFileURL } = require('node:url');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

const tempUserData = path.join(os.tmpdir(), `magnitola-session-${process.pid}`);
try {
  fs.mkdirSync(tempUserData, { recursive: true });
} catch {}
app.setPath('userData', tempUserData);

async function cleanStaleTempDirs() {
  try {
    const tmp = os.tmpdir();
    const entries = await fs.promises.readdir(tmp);
    for (const name of entries) {
      const match = /^magnitola-session-([1-9]\d*)$/.exec(name);
      const pid = match && Number(match[1]);
      if (pid && pid <= 0x7fffffff && pid !== process.pid) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (error.code === 'ESRCH') {
            await fs.promises.rm(path.join(tmp, name), { recursive: true, force: true }).catch(() => {});
          }
        }
      }
    }
  } catch {}
}

app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-software-rasterizer');

app.on('will-quit', () => {
  try {
    fs.rmSync(tempUserData, { recursive: true, force: true });
  } catch {}
});

const MEDIA_SCHEME = 'media';
const IN_MEMORY_PARTITION = 'in-memory';

const ALLOWED_MEDIA_MIMES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      stream: true
    }
  }
]);

app.setAppUserModelId('com.magnitola.downloader');

let mainWindow = null;
const appPageUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
const synclineUrl = 'https://sync-line.pages.dev/';
const selectedDirectories = new Map();
const mediaFiles = new Map();

async function authorizeDirectory(directory) {
  const resolved = path.resolve(directory);
  const canonical = await fs.promises.realpath(resolved).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return resolved;
  });
  selectedDirectories.set(resolved, canonical);
}

function isWithinDirectory(directory, filePath) {
  const relative = path.relative(directory, filePath);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function getAuthorizedMediaPath(filePath) {
  const root = mediaFiles.get(filePath);
  if (!root) return null;
  const canonical = await fs.promises.realpath(filePath);
  return isWithinDirectory(root, canonical) ? canonical : null;
}

function isTrustedSender(event) {
  if (!mainWindow || !event.senderFrame) return false;
  return event.senderFrame === mainWindow.webContents.mainFrame && event.senderFrame.url === appPageUrl;
}

async function resolveTargetDirectory(folder, subFolder) {
  const resolved = path.resolve(folder || app.getPath('downloads'));
  const root = selectedDirectories.get(resolved);
  if (!root) throw new Error('Unauthorized download folder');

  let target = root;
  if (typeof subFolder === 'string' && subFolder.trim() && !subFolder.includes('\0')) {
    const safe = path.basename(subFolder.trim().replace(/[<>:"/\\|?*]+/g, '_'));
    if (safe && safe !== '.' && safe !== '..') {
      target = path.join(root, safe);
    }
  }
  const canonical = await fs.promises.realpath(target).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return target;
  });
  if (!isWithinDirectory(root, canonical)) throw new Error('Unauthorized download folder');
  return { directory: canonical, root, resolved };
}

function parseMediaPath(requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${MEDIA_SCHEME}:` || url.host !== 'local') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const filePath = decodeURIComponent(url.pathname.slice(1));
    return path.isAbsolute(filePath) && !filePath.includes('\0') ? filePath : null;
  } catch {
    return null;
  }
}

async function handleMediaRequest(requestUrl, rangeHeader) {
  try {
    const filePath = parseMediaPath(requestUrl);
    if (!filePath) {
      return new Response('Malformed request URL', { status: 400 });
    }

    const resolvedPath = await getAuthorizedMediaPath(filePath);
    if (!resolvedPath) return new Response('Forbidden file', { status: 403 });

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ALLOWED_MEDIA_MIMES[ext];
    if (!mimeType) {
      return new Response('Forbidden file type', { status: 403 });
    }

    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isFile()) {
      return new Response('Target is not a file', { status: 403 });
    }

    const fileSize = stat.size;

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!match) {
        return new Response('Malformed Range header', { status: 400 });
      }

      let start;
      let end;

      if (match[1] === '' && match[2] !== '') {
        const suffix = parseInt(match[2], 10);
        start = Math.max(0, fileSize - suffix);
        end = fileSize - 1;
      } else if (match[1] !== '' && match[2] === '') {
        start = parseInt(match[1], 10);
        end = fileSize - 1;
      } else if (match[1] !== '' && match[2] !== '') {
        start = parseInt(match[1], 10);
        end = parseInt(match[2], 10);
      } else {
        return new Response('Malformed Range header', { status: 400 });
      }

      if (start >= fileSize || end < start || start < 0) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: {
            'Content-Range': `bytes */${fileSize}`
          }
        });
      }

      end = Math.min(end, fileSize - 1);
      const chunkSize = end - start + 1;

      const fileStream = fs.createReadStream(resolvedPath, { start, end });
      const webStream = Readable.toWeb(fileStream);

      return new Response(webStream, {
        status: 206,
        statusText: 'Partial Content',
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': mimeType
        }
      });
    } else {
      const fileStream = fs.createReadStream(resolvedPath);
      const webStream = Readable.toWeb(fileStream);

      return new Response(webStream, {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(fileSize),
          'Content-Type': mimeType
        }
      });
    }
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return new Response('File not found', { status: 404 });
    console.error('[mediaProtocol]', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}

function configureAppSession() {
  const appSession = session.fromPartition(IN_MEMORY_PARTITION);

  appSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });
  appSession.setPermissionCheckHandler(() => false);

  appSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://*.soundcloud.com/*',
        'https://soundcloud.com/*',
        'https://*.sndcdn.com/*',
        'https://*.soundcloud.cloud/*'
      ]
    },
    (details, callback) => {
      details.requestHeaders['Origin'] = 'https://soundcloud.com';
      details.requestHeaders['Referer'] = 'https://soundcloud.com/';
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  appSession.webRequest.onHeadersReceived(
    {
      urls: [
        'https://*.soundcloud.com/*',
        'https://soundcloud.com/*',
        'https://*.sndcdn.com/*',
        'https://*.soundcloud.cloud/*'
      ]
    },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      responseHeaders['access-control-allow-origin'] = ['*'];
      responseHeaders['access-control-allow-methods'] = ['GET, OPTIONS'];
      responseHeaders['access-control-allow-headers'] = ['*'];
      callback({ responseHeaders });
    }
  );
}

async function findSoundCloudClientId(signal) {
  try {
    const resp = await net.fetch('https://soundcloud.com', {
      signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const scriptRegex = /https:\/\/(?:[a-z\d-]+\.)*sndcdn\.com\/[^"'\s]+\.js/gi;
    const scripts = [...new Set(html.match(scriptRegex))].slice(-5).reverse();

    for (const scriptUrl of scripts) {
      try {
        signal.throwIfAborted();
        const sResp = await net.fetch(scriptUrl, {
          signal,
          redirect: 'error',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (!sResp.ok) continue;
        const js = await sResp.text();
        const m = js.match(/["']?client_id["']?\s*[:=]\s*["']([a-zA-Z0-9]{32})["']/);
        if (m && m[1]) {
          return m[1];
        }
      } catch {
        if (signal.aborted) return null;
      }
    }
  } catch (err) {
    if (!signal.aborted) console.warn('[findSoundCloudClientId]', err);
  }
  return null;
}

function registerIpcHandlers() {
  ipcMain.handle('get-default-downloads', (event) => {
    if (!isTrustedSender(event)) return null;
    return app.getPath('downloads');
  });

  ipcMain.handle('select-folder', async (event) => {
    if (!isTrustedSender(event) || !mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      const directory = result.filePaths[0];
      await authorizeDirectory(directory);
      return directory;
    }
    return null;
  });

  ipcMain.handle('read-clipboard', (event) => {
    if (!isTrustedSender(event)) return '';
    return clipboard.readText();
  });

  ipcMain.handle('check-file-exists', async (event, payload) => {
    if (!isTrustedSender(event) || !payload || typeof payload !== 'object') {
      return { exists: false };
    }
    try {
      const { directory } = await resolveTargetDirectory(payload.folder, payload.subFolder);
      return await checkTrackFile(directory, payload);
    } catch (err) {
      return { exists: false, error: err.message };
    }
  });

  ipcMain.handle('save-track', async (event, payload) => {
    if (!isTrustedSender(event) || !payload || typeof payload !== 'object') {
      return { success: false, error: 'Unauthorized or invalid payload' };
    }
    try {
      const { directory, root, resolved } = await resolveTargetDirectory(payload.folder, payload.subFolder);
      const result = await saveTrackFile(directory, payload);
      const filePath = path.join(resolved, path.relative(root, result.filePath));
      mediaFiles.set(filePath, root);
      return { ...result, filePath };
    } catch (err) {
      console.error('[save-track]', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('scan-library', async (event, folder) => {
    if (!isTrustedSender(event)) return [];
    if (typeof folder !== 'string' || !folder.trim() || folder.includes('\0')) return [];

    const resolvedFolder = path.resolve(folder);
    const root = selectedDirectories.get(resolvedFolder);
    if (!root) return [];
    try {
      if ((await fs.promises.realpath(resolvedFolder)) !== root) return [];
      const tracks = await scanLibrary(resolvedFolder);
      for (const track of tracks) mediaFiles.set(track.filePath, root);
      return tracks;
    } catch (err) {
      console.error('[scan-library]', err);
      return [];
    }
  });

  ipcMain.handle('read-track-cover', async (event, filePath) => {
    if (!isTrustedSender(event)) return null;
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) return null;
    try {
      const authorizedPath = await getAuthorizedMediaPath(filePath);
      return authorizedPath ? await readTrackCover(authorizedPath) : null;
    } catch {
      return null;
    }
  });

  let refreshController;
  ipcMain.on('cancel-client-refresh', (event) => {
    if (isTrustedSender(event)) refreshController?.abort();
  });
  ipcMain.handle('refresh-soundcloud-client-id', async (event) => {
    if (!isTrustedSender(event)) return null;
    refreshController?.abort();
    const controller = new AbortController();
    refreshController = controller;
    try {
      return await findSoundCloudClientId(controller.signal);
    } finally {
      if (controller === refreshController) refreshController = null;
    }
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'images', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 950,
    height: 600,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'MAGNItola',
    icon: iconPath,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#4c5844',
    webPreferences: {
      partition: IN_MEMORY_PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      navigateOnDragDrop: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === synclineUrl) shell.openExternal(synclineUrl).catch(console.error);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-frame-navigate', (event) => event.preventDefault());

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  if (app.isPackaged) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' || (input.control && input.shift && (input.key === 'I' || input.key === 'i'))) {
        event.preventDefault();
      }
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setTimeout(cleanStaleTempDirs, 1000);
  });

  mainWindow.loadURL(appPageUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await authorizeDirectory(app.getPath('downloads')).catch(console.error);
  const mediaHandler = async (request) => {
    return handleMediaRequest(request.url, request.headers.get('range'));
  };
  session.fromPartition(IN_MEMORY_PARTITION).protocol.handle(MEDIA_SCHEME, mediaHandler);

  configureAppSession();
  registerIpcHandlers();
  createWindow();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
