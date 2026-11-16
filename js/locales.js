/**
 * MAGNItola Localization Engine (RU / EN)
 */

window.LOCALES = {
  en: {
    urlPrompt: 'Paste link:',
    placeholder: 'Link to profile, track, playlist, album',
    currentStatus: 'Current download:',
    saveLocation: 'Save folder: ',
    saveFolderDefault: 'Downloads',
    paste: 'Paste',
    startDownload: 'Download',
    stopDownload: 'Stop',
    waitingInput: 'pls faster',
    ready: 'Ready to download',
    resolvingUrl: 'Resolving link...',
    downloading: 'Downloading track...',
    encoding: 'Encoding MP3...',
    alreadyExists: 'Already exists',
    finished: 'Download finished!',
    failed: 'Download failed',
    emptyUrlError: 'Error: No link provided.',
    invalidUrlError: 'Unsupported link. Please provide a profile, track, playlist, or album link.',
    noTracksFound: 'No tracks found for download.',
    trackPrefix: 'Track',
    fromWord: 'of',
    browse: 'Browse...',
    noTracksInFolder: 'No MP3 files found in folder.',
    playing: 'Playing',
    paused: 'Paused',
    queueTitle: 'Download queue',
    queueStatusWait: 'WAIT',
    queueStatusDown: 'DOWN',
    queueStatusDone: 'DONE',
    queueStatusSkip: 'SKIP',
    queueStatusFail: 'FAIL',
    updateBanner: '✦ New version available: ',
    updateDownload: 'Get update',
    updateDismiss: '✕',
    quotes: [
      'God invented computers',
      'Do you want to play a horror game?',
      'If I support ******* if I respect ******* then what am I? ****** or something?',
      'my mac my mac is rendering dota right now',
      'I learned a .NET framework',
      'wheel of death'
    ]
  },
  ru: {
    urlPrompt: 'Вставьте ссылку:',
    placeholder: 'Ссылка на профиль, трек, плейлист, альбом',
    currentStatus: 'Текущая загрузка:',
    saveLocation: 'Папка сохранения: ',
    saveFolderDefault: 'Загрузки',
    paste: 'Вставить',
    startDownload: 'Скачать',
    stopDownload: 'Стоп',
    waitingInput: 'пж быстрее',
    ready: 'Готов к загрузке',
    resolvingUrl: 'Определение ссылки...',
    downloading: 'Скачивание трека...',
    encoding: 'Кодирование MP3...',
    alreadyExists: 'Уже существует',
    finished: 'Загрузка завершена!',
    failed: 'Ошибка скачивания',
    emptyUrlError: 'Ошибка: ссылка не указана.',
    invalidUrlError: 'Неподдерживаемая ссылка. Укажите профиль, трек, плейлист или альбом.',
    noTracksFound: 'Треки для скачивания не найдены.',
    trackPrefix: 'Трек',
    fromWord: 'из',
    browse: 'Обзор...',
    noTracksInFolder: 'В папке не найдены MP3 треки.',
    playing: 'Играет',
    paused: 'Пауза',
    queueTitle: 'Очередь загрузки',
    queueStatusWait: 'ЖДЕТ',
    queueStatusDown: 'ЗАГР',
    queueStatusDone: 'ГОТОВО',
    queueStatusSkip: 'ПРОПУСК',
    queueStatusFail: 'СБОЙ',
    updateBanner: '✦ Доступна новая версия: ',
    updateDownload: 'Обновить',
    updateDismiss: '✕',
    quotes: [
      'Компьютеры придумал господь Бог',
      'Хочешь поиграть в хоррор?',
      'Если я поддерживаю ******* если я уважаю ******* то я что? ****** чтоли?',
      'мой мак мой мак сейчас монтирует доту',
      'я выучил фреймворк по дотнету',
      'колесо смерти'
    ]
  }
};

let currentLang = localStorage.getItem('magnitola_lang') || 'en';
if (!window.LOCALES[currentLang]) currentLang = 'en';
let L = window.LOCALES[currentLang];

function setLanguage(lang) {
  if (!window.LOCALES[lang]) return;
  currentLang = lang;
  localStorage.setItem('magnitola_lang', lang);
  L = window.LOCALES[lang];
  window.L = L;

  const langLabel = document.getElementById('langLabel');
  const flagImg = document.getElementById('flagImg');
  const lblUrlPrompt = document.getElementById('lblUrlPrompt');
  const inputUrl = document.getElementById('inputUrl');
  const lblCurrentStatus = document.getElementById('lblCurrentStatus');
  const btnPaste = document.getElementById('btnPaste');
  const btnStartDownload = document.getElementById('btnStartDownload');
  const btnStopDownload = document.getElementById('btnStopDownload');
  const btnBrowseFolder = document.getElementById('btnBrowseFolder');
  const currentTrackTitle = document.getElementById('currentTrackTitle');
  const quoteDisplay = document.getElementById('quoteDisplay');
  const queueHeaderTitle = document.getElementById('queueHeaderTitle');
  const btnUpdateDownload = document.getElementById('btnUpdateDownload');

  if (langLabel) langLabel.textContent = lang.toUpperCase();
  if (flagImg) flagImg.src = lang === 'ru' ? 'ru.png' : 'us.png';
  if (lblUrlPrompt) lblUrlPrompt.textContent = L.urlPrompt;
  if (inputUrl) inputUrl.placeholder = L.placeholder;
  if (lblCurrentStatus) lblCurrentStatus.textContent = L.currentStatus;
  if (btnPaste) btnPaste.textContent = L.paste;
  if (btnStartDownload) btnStartDownload.textContent = L.startDownload;
  if (btnStopDownload) btnStopDownload.textContent = L.stopDownload;
  if (btnBrowseFolder) btnBrowseFolder.textContent = L.browse;
  if (queueHeaderTitle) queueHeaderTitle.textContent = L.queueTitle;
  if (btnUpdateDownload) btnUpdateDownload.textContent = L.updateDownload;

  if (typeof window.updateSavePathDisplay === 'function') {
    window.updateSavePathDisplay();
  }

  if (typeof window.isDownloading !== 'undefined' && !window.isDownloading && currentTrackTitle) {
    currentTrackTitle.textContent = L.waitingInput;
  }

  if (typeof window.renderTrackList === 'function') {
    window.renderTrackList();
  }

  if (quoteDisplay && quoteDisplay.style.display !== 'none' && typeof window.currentQuoteIndex !== 'undefined') {
    quoteDisplay.textContent = `💬 «${L.quotes[window.currentQuoteIndex]}»`;
  }
}

window.setLanguage = setLanguage;
window.L = L;
