/**
 * MAGNItola Localization Engine (RU / EN)
 */

window.LOCALES = {
  en: {
    stopped: 'Stopped',
    saved: 'Saved',
    errors: 'Errors',
    saveFailed: 'Could not save file',
    noStream: 'No playable stream',
    previous: 'Previous track',
    playPause: 'Play or pause',
    next: 'Next track',
    seek: 'Seek',
    library: 'Library',
    language: 'Switch language',
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
    noTracksInFolder: 'No audio files found in folder.',
    playing: 'Playing',
    paused: 'Paused',
    noArtwork: 'NO ARTWORK',
    untitled: 'Untitled',
    unknownArtist: 'Unknown Artist',
    defaultArtist: 'MAGNItola',
    encodingMp3Badge: 'MP3 192k',
    skipStatus: 'SKIP',
    naSize: '-- / -- MB',
    queueTitle: 'Download queue',
    queueStatusWait: 'WAIT',
    queueStatusDown: 'DOWN',
    queueStatusDone: 'SAVED',
    queueStatusSkip: 'SKIP',
    queueStatusFail: 'FAIL',
    queueStatusDrm: 'DRM',
    drmProtected: 'Protected by DRM (SoundCloud Go+)',
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
    stopped: 'Остановлено',
    saved: 'Сохранено',
    errors: 'Ошибок',
    saveFailed: 'Не удалось сохранить файл',
    noStream: 'Нет доступного аудиопотока',
    previous: 'Предыдущий трек',
    playPause: 'Воспроизведение или пауза',
    next: 'Следующий трек',
    seek: 'Перемотка',
    library: 'Библиотека',
    language: 'Сменить язык',
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
    noTracksInFolder: 'В папке нет аудиофайлов.',
    playing: 'Играет',
    paused: 'Пауза',
    noArtwork: 'НЕТ ОБЛОЖКИ',
    untitled: 'Без названия',
    unknownArtist: 'Неизвестный исполнитель',
    defaultArtist: 'MAGNItola',
    encodingMp3Badge: 'MP3 192k',
    skipStatus: 'ПРОПУСК',
    naSize: '-- / -- МБ',
    queueTitle: 'Очередь загрузки',
    queueStatusWait: 'ЖДЕТ',
    queueStatusDown: 'ЗАГР',
    queueStatusDone: 'СОХРАНЕНО',
    queueStatusSkip: 'ПРОПУСК',
    queueStatusFail: 'СБОЙ',
    queueStatusDrm: 'DRM',
    drmProtected: 'Защищено DRM (SoundCloud Go+)',
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
  document.documentElement.lang = lang;
  for (const [id, label] of Object.entries({
    btnPlayerPrev: L.previous,
    btnPlayerPlay: L.playPause,
    btnPlayerNext: L.next,
    playerSeekInput: L.seek,
    playerTrackList: L.library,
    btnToggleLang: L.language,
    btnBrowseFolder: L.browse,
    btnPaste: L.paste,
    btnStartDownload: L.startDownload,
    btnStopDownload: L.stopDownload
  })) {
    const control = document.getElementById(id);
    control.title = label;
    control.setAttribute('aria-label', label);
  }
  document.getElementById('saveFolderLabel').textContent = L.saveLocation;

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
  const playerLargeArtPlaceholderLabel = document.getElementById('playerLargeArtPlaceholderLabel');

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
  if (playerLargeArtPlaceholderLabel) playerLargeArtPlaceholderLabel.textContent = L.noArtwork;

  if (typeof window.renderDownloadQueue === 'function') {
    window.renderDownloadQueue();
  }

  if (typeof window.updateSavePathDisplay === 'function') {
    window.updateSavePathDisplay();
  }

  if (typeof window.isDownloading !== 'undefined' && !window.isDownloading && currentTrackTitle) {
    currentTrackTitle.textContent = L.waitingInput;
  }

  window.renderSummary?.();

  if (typeof window.renderTrackList === 'function') {
    window.renderTrackList();
  }

  if (quoteDisplay && quoteDisplay.style.display !== 'none' && typeof window.currentQuoteIndex !== 'undefined') {
    quoteDisplay.textContent = `💬 «${L.quotes[window.currentQuoteIndex]}»`;
  }
}

window.setLanguage = setLanguage;
window.L = L;
