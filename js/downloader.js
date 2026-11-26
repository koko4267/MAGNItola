let activeJob = null;
let outcome = null;
let stage = null;
let inputError = '';
let downloadQueue = [];
let completedCount = 0;

// Render download queue
function getQueueStatusInfo(status) {
  const L = window.L || {};
  const statusMap = {
    wait: { text: L.queueStatusWait || 'WAIT', title: '' },
    down: { text: L.queueStatusDown || 'DOWN', title: '' },
    done: { text: L.queueStatusDone || 'DONE', title: L.saved || 'Saved' },
    skip: { text: L.queueStatusSkip || 'SKIP', title: L.alreadyExists || 'Already exists' },
    fail: { text: L.queueStatusFail || 'FAIL', title: L.failed || 'Download failed' },
    drm: { text: L.queueStatusDrm || 'DRM', title: L.drmProtected || 'Protected by DRM (SoundCloud Go+)' }
  };
  return statusMap[status] || statusMap.wait;
}

function renderDownloadQueue() {
  const queueList = document.getElementById('queueListContainer');
  const queueCounter = document.getElementById('queueHeaderCount');
  if (!queueList) return;

  const total = downloadQueue.length;
  if (queueCounter) {
    queueCounter.textContent = `${completedCount}/${total}`;
  }

  queueList.replaceChildren();
  if (!total) return;
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < total; i++) {
    const { track, status, reason } = downloadQueue[i];

    const row = document.createElement('div');
    row.className = 'queue-item-row';
    row.id = `queueItem-${i}`;

    const statusBadge = document.createElement('span');
    statusBadge.className = `queue-item-status queue-status-${status}`;
    const statusInfo = getQueueStatusInfo(status);
    statusBadge.textContent = statusInfo.text;
    if (statusInfo.title) {
      statusBadge.title = statusInfo.title;
    }

    const titleEl = document.createElement('span');
    titleEl.className = 'queue-item-title';
    titleEl.textContent = track.title || window.L?.untitled || 'Untitled';

    const artistEl = document.createElement('span');
    artistEl.className = 'queue-item-artist';
    artistEl.textContent = track.user?.username || window.L?.defaultArtist || 'MAGNItola';

    row.appendChild(statusBadge);
    row.appendChild(titleEl);
    row.appendChild(artistEl);
    renderReason(row, status, reason);
    fragment.appendChild(row);
  }

  queueList.appendChild(fragment);

  // Auto scroll to active/downloading item
  const activeIdx = downloadQueue.findIndex(({ status }) => status === 'down');
  if (activeIdx !== -1) {
    const activeRow = document.getElementById(`queueItem-${activeIdx}`);
    if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
  }
}

function updateQueueItemStatus(index, status, reason = '') {
  const item = downloadQueue[index];
  const isComplete = (value) => value !== 'wait' && value !== 'down';
  completedCount += Number(isComplete(status)) - Number(isComplete(item.status));
  item.status = status;
  item.reason = reason;
  const row = document.getElementById(`queueItem-${index}`);
  if (row) {
    const badge = row.querySelector('.queue-item-status');
    if (badge) {
      badge.className = `queue-item-status queue-status-${status}`;
      const statusInfo = getQueueStatusInfo(status);
      badge.textContent = statusInfo.text;
      badge.title = statusInfo.title || '';
    }
    renderReason(row, status, reason);
    if (status === 'down') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  const queueCounter = document.getElementById('queueHeaderCount');
  if (queueCounter) {
    queueCounter.textContent = `${completedCount}/${downloadQueue.length}`;
  }
}

function setDownloadProgress(pct) {
  const trackProgressFill = document.getElementById('trackProgressFill');
  const trackProgressText = document.getElementById('trackProgressText');
  const progressTrackElement = document.querySelector('.progress-track');
  if (!trackProgressFill || !trackProgressText) return;

  const clamped = Math.max(0, Math.min(100, pct));
  trackProgressText.textContent = `${Math.round(clamped)}%`;

  if (clamped <= 0) {
    trackProgressFill.style.width = '0px';
    return;
  }
  if (clamped >= 100) {
    trackProgressFill.style.width = '100%';
    return;
  }

  const trackWidth = progressTrackElement ? progressTrackElement.clientWidth : 0;
  const step = 9;
  if (trackWidth > step) {
    const totalCells = Math.floor(trackWidth / step);
    const filledCells = Math.max(1, Math.floor((clamped / 100) * totalCells));
    trackProgressFill.style.width = `${filledCells * step}px`;
  } else {
    trackProgressFill.style.width = `${clamped}%`;
  }
}

function renderReason(row, status, reasonText) {
  row.querySelector('.queue-reason')?.remove();
  if (status !== 'fail') return;
  const reason = document.createElement('span');
  reason.className = 'queue-reason';
  reason.textContent = Object.hasOwn(window.L, reasonText) ? window.L[reasonText] : reasonText || window.L.noStream;
  row.appendChild(reason);
}

function showInputError(message) {
  inputError = message;
  message = window.L[message] || message;
  document.getElementById('inputError').textContent = message;
  document.getElementById('inputUrl').setAttribute('aria-invalid', String(Boolean(message)));
}

function renderSummary() {
  showInputError(inputError);
  if (stage && activeJob) document.getElementById('lblCurrentStatus').textContent = window.L[stage];
  if (!outcome) return;
  const counts = { done: 0, skip: 0, fail: 0, drm: 0, wait: 0, down: 0 };
  for (const { status } of downloadQueue) counts[status]++;
  document.getElementById('currentTrackTitle').textContent = window.L[outcome];
  document.getElementById('downloadSizeStats').textContent = '';
  document.getElementById('downloadSpeedStats').textContent = '';
  document.getElementById('downloadCounterStats').textContent = [
    window.L.saved + ' ' + counts.done,
    window.L.alreadyExists + ' ' + counts.skip,
    window.L.errors + ' ' + (counts.fail + counts.drm)
  ].join(' · ');
}

function reportTrack(index, update) {
  if (update.status) updateQueueItemStatus(index, update.status, update.reason);
  if (update.progress !== undefined) setDownloadProgress(update.progress);
  if (update.stage) {
    stage = update.stage;
    document.getElementById('lblCurrentStatus').textContent = window.L[stage];
  }
  for (const [key, id] of Object.entries({
    title: 'currentTrackTitle',
    artist: 'currentTrackArtist',
    speed: 'downloadSpeedStats',
    size: 'downloadSizeStats'
  })) {
    if (update[key] !== undefined) document.getElementById(id).textContent = update[key];
  }
  if ('artwork' in update) setDownloadArtwork(update.artwork);
}

function setDownloadArtwork(artwork) {
  const img = document.getElementById('albumArtImg');
  const logo = document.getElementById('albumArtIcon');
  img.hidden = true;
  logo.hidden = false;
  img.onload = null;
  if (artwork) {
    img.onload = () => {
      img.hidden = false;
      logo.hidden = true;
    };
    img.src = artwork;
  } else {
    img.removeAttribute('src');
  }
}

function stopDownload() {
  activeJob?.abort();
}

function isDownloading() {
  return activeJob !== null;
}

async function startDownloadFlow() {
  if (activeJob) return;
  const inputUrl = document.getElementById('inputUrl');
  const btnStartDownload = document.getElementById('btnStartDownload');
  const btnStopDownload = document.getElementById('btnStopDownload');
  const currentTrackTitle = document.getElementById('currentTrackTitle');
  const currentTrackArtist = document.getElementById('currentTrackArtist');
  const lblCurrentStatus = document.getElementById('lblCurrentStatus');
  const downloadCounterStats = document.getElementById('downloadCounterStats');

  const downloadFolder = localStorage.getItem('magnitola_save_folder') || '';
  const rawUrl = inputUrl ? inputUrl.value.trim() : '';
  if (!rawUrl) {
    showInputError('emptyUrlError');
    inputUrl.focus();
    return;
  }

  const controller = new AbortController();
  activeJob = controller;
  const { signal } = controller;
  outcome = null;
  stage = 'resolvingUrl';
  completedCount = 0;
  downloadQueue = [];
  renderDownloadQueue();
  showInputError('');
  setDownloadProgress(0);
  if (btnStartDownload) btnStartDownload.disabled = true;
  if (btnStopDownload) btnStopDownload.disabled = false;

  if (typeof window.startQuoteRotation === 'function') {
    window.startQuoteRotation();
  }

  if (currentTrackTitle) currentTrackTitle.textContent = window.L.resolvingUrl;
  if (currentTrackArtist) currentTrackArtist.textContent = 'MAGNItola';

  try {
    const result = await window.resolveSoundCloudUrl(rawUrl, signal);
    signal.throwIfAborted();
    const queue = result ? result.tracks : [];
    const subFolder = result ? result.subFolder : null;

    if (!queue || queue.length === 0) {
      showInputError('noTracksFound');
      outcome = 'failed';
      return;
    }

    downloadQueue = queue.map((track) => ({ track, status: 'wait', reason: '' }));
    renderDownloadQueue();

    const api = window.electronAPI || null;
    const targetDir = downloadFolder || (api?.getDefaultDownloadsFolder ? await api.getDefaultDownloadsFolder() : null);

    const total = queue.length;

    for (let i = 0; i < total; i++) {
      signal.throwIfAborted();
      if (downloadCounterStats) {
        downloadCounterStats.textContent = `${window.L.trackPrefix} ${i + 1} ${window.L.fromWord} ${total}`;
      }
      try {
        await window.downloadTrack(
          queue[i],
          i + 1,
          total,
          subFolder,
          { title: result.title },
          targetDir,
          signal,
          (update) => reportTrack(i, update)
        );
      } catch (error) {
        if (signal.aborted) throw error;
        updateQueueItemStatus(i, 'fail', error.message);
      }
    }

    outcome = 'finished';
  } catch (err) {
    outcome = 'failed';
    if (!signal.aborted) showInputError(err.message || window.L.failed);
  } finally {
    if (signal.aborted) {
      outcome = 'stopped';
      const index = downloadQueue.findIndex(({ status }) => status === 'down');
      if (index >= 0) updateQueueItemStatus(index, 'wait');
    }
    stage = null;
    activeJob = null;
    setDownloadArtwork(null);
    renderSummary();
    if (btnStartDownload) btnStartDownload.disabled = false;
    if (btnStopDownload) btnStopDownload.disabled = true;
    if (lblCurrentStatus) lblCurrentStatus.textContent = window.L.currentStatus;
    if (typeof window.stopQuoteRotation === 'function') window.stopQuoteRotation();
    if (typeof window.checkQuoteVisibility === 'function') window.checkQuoteVisibility();
  }
}

Object.assign(window, {
  startDownloadFlow,
  stopDownload,
  isDownloading,
  renderDownloadQueue,
  renderSummary,
  showInputError
});
