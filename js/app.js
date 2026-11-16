/**
 * Application Entry Point & Event Coordinator
 */

let quoteInterval = null;
window.currentQuoteIndex = 0;

function updateSavePathDisplay() {
  const saveFolderPath = document.getElementById('saveFolderPath');
  const saveLocationInfo = document.getElementById('saveLocationInfo');
  const downloadFolder = localStorage.getItem('magnitola_save_folder') || '';
  const display = downloadFolder || window.L?.saveFolderDefault || 'Downloads';

  if (saveFolderPath) saveFolderPath.textContent = display;
  if (saveLocationInfo) saveLocationInfo.title = display;
}

function checkQuoteVisibility() {
  const inputUrl = document.getElementById('inputUrl');
  const quoteDisplay = document.getElementById('quoteDisplay');
  if (!inputUrl || !quoteDisplay) return;

  if (inputUrl.value.trim().length > 0 || window.isDownloading) {
    quoteDisplay.style.display = 'block';
    const quoteList = window.L?.quotes || [];
    const q = quoteList[window.currentQuoteIndex] || 'God invented computers';
    quoteDisplay.textContent = `💬 «${q}»`;
  } else {
    quoteDisplay.style.display = 'none';
  }
}

function startQuoteRotation() {
  stopQuoteRotation();
  const quoteDisplay = document.getElementById('quoteDisplay');
  if (!quoteDisplay) return;

  quoteDisplay.style.display = 'block';
  const quoteList = window.L?.quotes || [];
  const q = quoteList[window.currentQuoteIndex] || 'God invented computers';
  quoteDisplay.textContent = `💬 «${q}»`;

  quoteInterval = setInterval(() => {
    const list = window.L?.quotes || [];
    if (list.length > 0) {
      window.currentQuoteIndex = (window.currentQuoteIndex + 1) % list.length;
      quoteDisplay.textContent = `💬 «${list[window.currentQuoteIndex]}»`;
    }
  }, window.APP_CONFIG?.QUOTE_ROTATION_INTERVAL_MS || 2000);
}

function stopQuoteRotation() {
  if (quoteInterval) {
    clearInterval(quoteInterval);
    quoteInterval = null;
  }
}

function showUpdateBanner(updateInfo) {
  const banner = document.getElementById('updateBanner');
  const bannerText = document.getElementById('updateBannerText');
  const btnUpdateDownload = document.getElementById('btnUpdateDownload');
  const btnUpdateDismiss = document.getElementById('btnUpdateDismiss');
  if (!banner || !bannerText) return;

  bannerText.textContent = `${window.L?.updateBanner || '✦ New version available: '} ${updateInfo.latestVersion}`;
  banner.style.display = 'flex';

  if (btnUpdateDownload) {
    btnUpdateDownload.onclick = () => {
      window.open(updateInfo.releaseUrl, '_blank');
    };
  }

  if (btnUpdateDismiss) {
    btnUpdateDismiss.onclick = () => {
      banner.style.display = 'none';
    };
  }
}

window.updateSavePathDisplay = updateSavePathDisplay;
window.checkQuoteVisibility = checkQuoteVisibility;
window.startQuoteRotation = startQuoteRotation;
window.stopQuoteRotation = stopQuoteRotation;

window.addEventListener('DOMContentLoaded', async () => {
  const api = window.electronAPI || null;

  if (typeof window.initPlayerListeners === 'function') {
    window.initPlayerListeners();
  }
  if (typeof window.setLanguage === 'function') {
    const savedLang = localStorage.getItem('magnitola_lang') || 'en';
    window.setLanguage(savedLang);
  }

  // Initialize download folder
  let downloadFolder = localStorage.getItem('magnitola_save_folder') || '';
  if (!downloadFolder && api?.getDefaultDownloadsFolder) {
    try {
      const defPath = await api.getDefaultDownloadsFolder();
      if (defPath && !downloadFolder) {
        downloadFolder = defPath;
        updateSavePathDisplay();
        if (typeof window.scanAndLoadLibrary === 'function') {
          window.scanAndLoadLibrary(downloadFolder);
        }
      }
    } catch {}
  } else if (downloadFolder && typeof window.scanAndLoadLibrary === 'function') {
    updateSavePathDisplay();
    window.scanAndLoadLibrary(downloadFolder);
  }

  checkQuoteVisibility();

  // Language toggle
  const btnToggleLang = document.getElementById('btnToggleLang');
  if (btnToggleLang) {
    btnToggleLang.addEventListener('click', () => {
      const cur = localStorage.getItem('magnitola_lang') || 'en';
      if (typeof window.setLanguage === 'function') {
        window.setLanguage(cur === 'ru' ? 'en' : 'ru');
      }
    });
  }

  // Browse folder
  const btnBrowseFolder = document.getElementById('btnBrowseFolder');
  if (btnBrowseFolder) {
    btnBrowseFolder.addEventListener('click', async () => {
      if (!api?.selectFolder) return;
      try {
        const selected = await api.selectFolder();
        if (selected) {
          localStorage.setItem('magnitola_save_folder', selected);
          updateSavePathDisplay();
          if (typeof window.scanAndLoadLibrary === 'function') {
            window.scanAndLoadLibrary(selected);
          }
        }
      } catch (err) {
        console.error('Folder picker error:', err);
      }
    });
  }

  // Paste button
  const btnPaste = document.getElementById('btnPaste');
  const inputUrl = document.getElementById('inputUrl');
  if (btnPaste && inputUrl) {
    btnPaste.addEventListener('click', async () => {
      try {
        const text = api?.readClipboard ? await api.readClipboard() : '';
        if (text) {
          inputUrl.value = text;
          checkQuoteVisibility();
        }
      } catch {
        inputUrl.focus();
      }
    });
  }

  if (inputUrl) {
    inputUrl.addEventListener('input', () => {
      checkQuoteVisibility();
    });

    inputUrl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (typeof window.startDownloadFlow === 'function') {
          window.startDownloadFlow();
        }
      }
    });
  }

  // Start & Stop download buttons
  const btnStartDownload = document.getElementById('btnStartDownload');
  const btnStopDownload = document.getElementById('btnStopDownload');

  if (btnStartDownload) {
    btnStartDownload.addEventListener('click', () => {
      if (typeof window.startDownloadFlow === 'function') {
        window.startDownloadFlow();
      }
    });
  }

  if (btnStopDownload) {
    btnStopDownload.addEventListener('click', () => {
      window.cancelRequested = true;
      btnStopDownload.disabled = true;
    });
  }

  // Check for updates
  if (api?.onUpdateAvailable) {
    api.onUpdateAvailable((info) => {
      if (info && info.hasUpdate) {
        showUpdateBanner(info);
      }
    });
  }

  if (api?.checkForUpdates) {
    try {
      const updateInfo = await api.checkForUpdates();
      if (updateInfo && updateInfo.hasUpdate) {
        showUpdateBanner(updateInfo);
      }
    } catch {}
  }
});
