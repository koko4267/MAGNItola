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
    likesPageFailed: 'Could not load all SoundCloud likes. Try again.',
    playlistPageFailed: 'Could not load all SoundCloud playlist tracks. Try again.',
    trackIdentityMissing: 'This track has no SoundCloud ID or permalink.',
    previous: 'Previous track',
    playPause: 'Play or pause',
    next: 'Next track',
    seek: 'Seek',
    volume: 'Volume',
    shuffle: 'Shuffle',
    repeatAll: 'Repeat all',
    repeatOne: 'Repeat one track',
    repeatOff: 'Repeat off',
    library: 'Library',
    language: 'Switch language',
    urlPrompt: 'Paste link:',
    placeholder: 'Link to profile, track, playlist, album',
    currentStatus: 'Current download:',
    saveLocation: 'Folder:',
    saveFolderDefault: 'Downloads',
    paste: 'Paste',
    startDownload: 'Download',
    stopDownload: 'Stop',
    waitingInput: 'pls faster',
    resolvingUrl: 'Resolving link...',
    downloading: 'Downloading track...',
    encoding: 'Encoding MP3...',
    alreadyExists: 'Already exists',
    finished: 'Download finished!',
    failed: 'Download failed',
    emptyUrlError: 'Error: No link provided.',
    invalidUrlError: 'Enter a SoundCloud profile, track, playlist, or album link.',
    hlsByteRangeUnsupported: 'HLS streams with byte ranges are unsupported.',
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
    queueStatusDone: 'DONE',
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
    likesPageFailed: 'Не удалось получить все лайки SoundCloud. Попробуйте ещё раз.',
    playlistPageFailed: 'Не удалось получить все треки плейлиста SoundCloud. Попробуйте ещё раз.',
    trackIdentityMissing: 'У трека нет ID или постоянной ссылки SoundCloud.',
    previous: 'Предыдущий трек',
    playPause: 'Воспроизведение или пауза',
    next: 'Следующий трек',
    seek: 'Перемотка',
    volume: 'Громкость',
    shuffle: 'Случайный порядок',
    repeatAll: 'Повтор всех треков',
    repeatOne: 'Повтор одного трека',
    repeatOff: 'Повтор выключен',
    library: 'Библиотека',
    language: 'Сменить язык',
    urlPrompt: 'Вставьте ссылку:',
    placeholder: 'Ссылка на профиль, трек, плейлист, альбом',
    currentStatus: 'Текущая загрузка:',
    saveLocation: 'Папка:',
    saveFolderDefault: 'Загрузки',
    paste: 'Вставить',
    startDownload: 'Скачать',
    stopDownload: 'Стоп',
    waitingInput: 'пж быстрее',
    resolvingUrl: 'Определение ссылки...',
    downloading: 'Скачивание трека...',
    encoding: 'Кодирование MP3...',
    alreadyExists: 'Уже существует',
    finished: 'Загрузка завершена!',
    failed: 'Ошибка скачивания',
    emptyUrlError: 'Ошибка: ссылка не указана.',
    invalidUrlError: 'Укажите ссылку на профиль, трек, плейлист или альбом в SoundCloud.',
    hlsByteRangeUnsupported: 'Потоки HLS с диапазонами байтов не поддерживаются.',
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
    queueStatusDone: 'СОХР',
    queueStatusSkip: 'ПРОП',
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
    playerVolume: L.volume,
    btnShuffle: L.shuffle,
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
  document.getElementById('volumeLabel').textContent = L.volume;
  window.updatePlayerModes?.();
  window.updatePlaybackButton?.();

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
  if (flagImg) flagImg.src = lang === 'ru' ? 'assets/images/ru.png' : 'assets/images/us.png';
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

  if (!window.isDownloading() && currentTrackTitle) {
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
