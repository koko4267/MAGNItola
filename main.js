const { app, BrowserWindow, shell, ipcMain, dialog, protocol, session, clipboard, net } = require('electron');
const path = require('path');
const os = require('os');
const { scanLibrary, readTrackCover } = require('./library.cjs');
const { checkTrackFile, saveTrackFile } = require('./track-files.cjs');
const fs = require('fs');
const { Readable } = require('stream');

const tempUserData = path.join(os.tmpdir(), `magnitola-session-${process.pid}`);
try {
  fs.mkdirSync(tempUserData, { recursive: true });
} catch {}
app.setPath('userData', tempUserData);

async function cleanStaleTempDirs() {
  try {
    const tmp = os.tmpdir();
    const entries = await fs.promises.readdir(tmp);
    const prefix = 'magnitola-session-';
    const currentName = `magnitola-session-${process.pid}`;
    for (const name of entries) {
      if (name.startsWith(prefix) && name !== currentName) {
        try {
          await fs.promises.rm(path.join(tmp, name), { recursive: true, force: true });
        } catch {}
      }
    }
  } catch {}
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
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
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

app.setAppUserModelId('com.magnitola.downloader');

let mainWindow = null;

function isTrustedSender(event) {
  if (!mainWindow || !event.senderFrame) return false;
  return event.senderFrame === mainWindow.webContents.mainFrame;
}

function resolveTargetDirectory(folder, subFolder) {
  let resolved =
    typeof folder === 'string' && folder.trim() && !folder.includes('\0')
      ? path.resolve(folder)
      : app.getPath('downloads');

  if (typeof subFolder === 'string' && subFolder.trim() && !subFolder.includes('\0')) {
    const safe = path.basename(subFolder.trim().replace(/[<>:"/\\|?*]+/g, '_'));
    if (safe && safe !== '.' && safe !== '..') {
      resolved = path.join(resolved, safe);
    }
  }
  return resolved;
}

function parseMediaPath(requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${MEDIA_SCHEME}:`) return null;

    let rawPath = decodeURIComponent(url.pathname);
    if (rawPath.startsWith('/local/')) {
      rawPath = rawPath.slice(7);
    } else if (rawPath.startsWith('/')) {
      rawPath = rawPath.slice(1);
    }

    if (/^\/[a-zA-Z]:/.test(rawPath)) {
      rawPath = rawPath.slice(1);
    }

    if (rawPath.includes('\0')) return null;
    return path.resolve(path.normalize(rawPath));
  } catch {
    return null;
  }
}

async function handleMediaRequest(requestUrl, rangeHeader) {
  try {
    const resolvedPath = parseMediaPath(requestUrl);
    if (!resolvedPath) {
      return new Response('Malformed request URL', { status: 400 });
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType = ALLOWED_MEDIA_MIMES[ext];
    if (!mimeType) {
      return new Response('Forbidden file type', { status: 403 });
    }

    if (!fs.existsSync(resolvedPath)) {
      return new Response('File not found', { status: 404 });
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
    const scriptRegex = /https:\/\/[^"'\s]+sndcdn\.com\/[^"'\s]+\.js/g;
    const scripts = Array.from(new Set(html.match(scriptRegex) || []));
    const reversed = scripts.reverse().slice(0, 5);

    for (const scriptUrl of reversed) {
      try {
        const sResp = await net.fetch(scriptUrl, {
          signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (!sResp.ok) continue;
        const js = await sResp.text();
        const m = js.match(/["']?client_id["']?\s*[:=]\s*["']([a-zA-Z0-9]{32})["']/);
        if (m && m[1]) {
          return m[1];
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[findSoundCloudClientId]', err);
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
      return result.filePaths[0];
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
    const resolvedFolder = resolveTargetDirectory(payload.folder, payload.subFolder);
    try {
      return await checkTrackFile(resolvedFolder, payload);
    } catch (err) {
      return { exists: false, error: err.message };
    }
  });

  ipcMain.handle('save-track', async (event, payload) => {
    if (!isTrustedSender(event) || !payload || typeof payload !== 'object') {
      return { success: false, error: 'Unauthorized or invalid payload' };
    }
    const resolvedFolder = resolveTargetDirectory(payload.folder, payload.subFolder);
    try {
      return await saveTrackFile(resolvedFolder, payload);
    } catch (err) {
      console.error('[save-track]', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('scan-library', async (event, folder) => {
    if (!isTrustedSender(event)) return [];
    if (typeof folder !== 'string' || !folder.trim() || folder.includes('\0')) return [];

    const resolvedFolder = path.resolve(folder);
    try {
      return await scanLibrary(resolvedFolder);
    } catch (err) {
      console.error('[scan-library]', err);
      return [];
    }
  });

  ipcMain.handle('read-track-cover', async (event, filePath) => {
    if (!isTrustedSender(event)) return null;
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) return null;
    return readTrackCover(filePath);
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
  const iconPath = path.join(__dirname, 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 950,
    height: 600,
    minWidth: 950,
    minHeight: 600,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
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
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') {
        shell.openExternal(parsed.href);
      }
    } catch {}
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') {
        shell.openExternal(parsed.href);
      }
    } catch {}
  });

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

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const mediaHandler = async (request) => {
    return handleMediaRequest(request.url, request.headers.get('range'));
  };
  protocol.handle(MEDIA_SCHEME, mediaHandler);
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
