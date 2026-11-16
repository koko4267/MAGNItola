// Audio player and track list

const audio = new Audio();
audio.volume = 1.0;

let libraryTracks = [];
let currentPlayingTrack = null;
let isPlaying = false;
let isDraggingSeek = false;
let isPointerDownOnSeek = false;

const artworkCache = new Map();

function getMediaUrl(filePath) {
  return `media://local/${encodeURIComponent(filePath)}`;
}

function updatePlayerButtonsState() {
  const btnPlayerPrev = document.getElementById('btnPlayerPrev');
  const btnPlayerPlay = document.getElementById('btnPlayerPlay');
  const btnPlayerNext = document.getElementById('btnPlayerNext');

  const hasTracks = libraryTracks.length > 0;
  if (btnPlayerPrev) btnPlayerPrev.disabled = !hasTracks;
  if (btnPlayerPlay) btnPlayerPlay.disabled = !hasTracks;
  if (btnPlayerNext) btnPlayerNext.disabled = !hasTracks;
}

function addTrackToPlayer(track) {
  const existingIdx = libraryTracks.findIndex((t) => t.filePath.toLowerCase() === track.filePath.toLowerCase());
  if (existingIdx !== -1) {
    libraryTracks[existingIdx] = track;
  } else {
    libraryTracks.unshift(track);
  }
  if (track.artworkDataUrl) {
    artworkCache.set(track.filePath, track.artworkDataUrl);
  }
  renderTrackList();
  updatePlayerButtonsState();
}

async function scanAndLoadLibrary(folder) {
  const api = window.electronAPI || null;
  if (!api?.scanLibrary || !folder) return;
  try {
    const tracks = await api.scanLibrary(folder);
    libraryTracks = tracks || [];
    renderTrackList();
    updatePlayerButtonsState();
  } catch (err) {
    console.error('Scan library error:', err);
  }
}

// Track row element
function createTrackItemElement(tr, index, topPx) {
  const isActive = currentPlayingTrack && currentPlayingTrack.filePath === tr.filePath;

  const row = document.createElement('div');
  row.className = `track-item-row ${isActive ? 'active' : ''}`;
  row.style.position = 'absolute';
  row.style.top = `${topPx}px`;
  row.style.left = '6px';
  row.style.right = '6px';
  row.setAttribute('data-index', String(index));

  const artBox = document.createElement('div');
  artBox.className = 'track-item-art';

  const img = document.createElement('img');
  img.alt = 'Cover';
  img.style.display = 'none';

  const icon = document.createElement('span');
  icon.className = 'track-item-icon';
  icon.textContent = '♫';

  artBox.appendChild(img);
  artBox.appendChild(icon);

  // Lazy load cover
  const cached = tr.artworkDataUrl || artworkCache.get(tr.filePath);
  if (cached) {
    img.src = cached;
    img.style.display = 'block';
    icon.style.display = 'none';
  } else if (tr.hasCover) {
    const api = window.electronAPI || null;
    if (api?.readTrackCover) {
      api
        .readTrackCover(tr.filePath)
        .then((coverDataUrl) => {
          if (coverDataUrl) {
            artworkCache.set(tr.filePath, coverDataUrl);
            img.src = coverDataUrl;
            img.style.display = 'block';
            icon.style.display = 'none';
          }
        })
        .catch(() => {});
    }
  }

  const metaBox = document.createElement('div');
  metaBox.className = 'track-item-meta';

  const titleEl = document.createElement('div');
  titleEl.className = 'track-item-title';
  titleEl.textContent = tr.title || 'Untitled';

  const artistEl = document.createElement('div');
  artistEl.className = 'track-item-artist';
  artistEl.textContent = tr.artist || 'Unknown';

  metaBox.appendChild(titleEl);
  metaBox.appendChild(artistEl);

  row.appendChild(artBox);
  row.appendChild(metaBox);

  row.addEventListener('click', () => {
    playTrack(libraryTracks[index]);
  });

  return row;
}

// Virtualized track list
function renderTrackList() {
  const container = document.getElementById('playerTrackList');
  if (!container) return;

  if (libraryTracks.length === 0) {
    container.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'track-list-empty';
    empty.id = 'playerTrackListEmpty';
    const p = document.createElement('p');
    p.textContent = window.L?.noTracksInFolder || 'No MP3 files found in folder.';
    empty.appendChild(p);
    container.appendChild(empty);
    return;
  }

  const rowHeight = window.APP_CONFIG?.TRACK_ROW_HEIGHT_PX || 58;
  const overscan = window.APP_CONFIG?.VIRTUAL_OVERSCAN_COUNT || 4;
  const totalHeight = libraryTracks.length * rowHeight;

  let spacer = container.querySelector('.virtual-scroll-spacer');
  if (!spacer) {
    container.replaceChildren();
    spacer = document.createElement('div');
    spacer.className = 'virtual-scroll-spacer';
    container.appendChild(spacer);
  }

  spacer.style.height = `${totalHeight}px`;

  const scrollTop = container.scrollTop;
  const clientHeight = container.clientHeight || 500;

  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIdx = Math.min(libraryTracks.length, Math.ceil((scrollTop + clientHeight) / rowHeight) + overscan);

  spacer.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (let i = startIdx; i < endIdx; i++) {
    const rowEl = createTrackItemElement(libraryTracks[i], i, i * rowHeight);
    fragment.appendChild(rowEl);
  }

  spacer.appendChild(fragment);
}

function playTrack(track) {
  if (!track) return;
  currentPlayingTrack = track;

  const playerLargeArtContainer = document.getElementById('playerLargeArtContainer');
  const playerLargeArtTitle = document.getElementById('playerLargeArtTitle');
  const playerLargeArtArtist = document.getElementById('playerLargeArtArtist');
  const playerLargeArtImg = document.getElementById('playerLargeArtImg');
  const playerLargeArtPlaceholder = document.getElementById('playerLargeArtPlaceholder');
  const btnPlayerPlay = document.getElementById('btnPlayerPlay');
  const playerSeekInput = document.getElementById('playerSeekInput');
  const playerSeekFill = document.getElementById('playerSeekFill');
  const playerCurrentTime = document.getElementById('playerCurrentTime');
  const playerTotalTime = document.getElementById('playerTotalTime');

  if (playerLargeArtContainer) playerLargeArtContainer.style.display = 'flex';
  if (playerLargeArtTitle) playerLargeArtTitle.textContent = track.title;
  if (playerLargeArtArtist) playerLargeArtArtist.textContent = track.artist;

  const coverUrl = track.artworkDataUrl || artworkCache.get(track.filePath);
  if (coverUrl) {
    if (playerLargeArtImg) {
      playerLargeArtImg.src = coverUrl;
      playerLargeArtImg.style.display = 'block';
    }
    if (playerLargeArtPlaceholder) playerLargeArtPlaceholder.style.display = 'none';
  } else if (track.hasCover && window.electronAPI?.readTrackCover) {
    if (playerLargeArtImg) playerLargeArtImg.style.display = 'none';
    if (playerLargeArtPlaceholder) playerLargeArtPlaceholder.style.display = 'flex';

    window.electronAPI
      .readTrackCover(track.filePath)
      .then((dataUrl) => {
        if (dataUrl) {
          artworkCache.set(track.filePath, dataUrl);
          if (currentPlayingTrack && currentPlayingTrack.filePath === track.filePath) {
            if (playerLargeArtImg) {
              playerLargeArtImg.src = dataUrl;
              playerLargeArtImg.style.display = 'block';
            }
            if (playerLargeArtPlaceholder) playerLargeArtPlaceholder.style.display = 'none';
          }
        }
      })
      .catch(() => {});
  } else {
    if (playerLargeArtImg) playerLargeArtImg.style.display = 'none';
    if (playerLargeArtPlaceholder) playerLargeArtPlaceholder.style.display = 'flex';
  }

  audio.src = getMediaUrl(track.filePath);
  audio.play().catch((e) => console.warn('Playback start warning:', e));
  isPlaying = true;

  if (btnPlayerPlay) {
    btnPlayerPlay.textContent = '❚❚';
    btnPlayerPlay.title = window.L?.paused || 'Paused';
  }
  if (playerSeekInput) {
    playerSeekInput.disabled = false;
    if (track.duration && track.duration > 0) {
      playerSeekInput.max = track.duration;
    }
  }
  if (playerSeekFill) playerSeekFill.style.width = '0%';
  if (playerCurrentTime) playerCurrentTime.textContent = '0:00';
  if (playerTotalTime) {
    playerTotalTime.textContent = track.duration && track.duration > 0 ? window.formatTime(track.duration) : '0:00';
  }

  renderTrackList();
}

function togglePlay() {
  const btnPlayerPlay = document.getElementById('btnPlayerPlay');
  if (!currentPlayingTrack && libraryTracks.length > 0) {
    playTrack(libraryTracks[0]);
    return;
  }
  if (!currentPlayingTrack) return;

  if (isPlaying) {
    audio.pause();
    isPlaying = false;
    if (btnPlayerPlay) {
      btnPlayerPlay.textContent = '▶';
      btnPlayerPlay.title = window.L?.playing || 'Playing';
    }
  } else {
    audio.play().catch((e) => console.warn(e));
    isPlaying = true;
    if (btnPlayerPlay) {
      btnPlayerPlay.textContent = '❚❚';
      btnPlayerPlay.title = window.L?.paused || 'Paused';
    }
  }
  renderTrackList();
}

function prevTrack() {
  if (libraryTracks.length === 0) return;
  if (!currentPlayingTrack) {
    playTrack(libraryTracks[0]);
    return;
  }
  const idx = libraryTracks.findIndex((t) => t.filePath === currentPlayingTrack.filePath);
  const nextIdx = idx > 0 ? idx - 1 : libraryTracks.length - 1;
  playTrack(libraryTracks[nextIdx]);
}

function nextTrack() {
  if (libraryTracks.length === 0) return;
  if (!currentPlayingTrack) {
    playTrack(libraryTracks[0]);
    return;
  }
  const idx = libraryTracks.findIndex((t) => t.filePath === currentPlayingTrack.filePath);
  const nextIdx = (idx + 1) % libraryTracks.length;
  playTrack(libraryTracks[nextIdx]);
}

function updateDurationDisplay() {
  const playerSeekInput = document.getElementById('playerSeekInput');
  const playerTotalTime = document.getElementById('playerTotalTime');
  const dur = audio.duration;
  if (dur && Number.isFinite(dur) && dur > 0) {
    if (playerSeekInput) playerSeekInput.max = dur;
    if (playerTotalTime) playerTotalTime.textContent = window.formatTime(dur);
  }
}

function getSeekRatioFromEvent(e) {
  const playerSeekWrapper = document.getElementById('playerSeekWrapper');
  if (!playerSeekWrapper) return 0;
  const rect = playerSeekWrapper.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
}

function previewSeekPosition(ratio) {
  const playerSeekFill = document.getElementById('playerSeekFill');
  const playerSeekInput = document.getElementById('playerSeekInput');
  const playerCurrentTime = document.getElementById('playerCurrentTime');

  const dur = audio.duration;
  const validDur = dur && Number.isFinite(dur) && dur > 0 ? dur : currentPlayingTrack?.duration || 0;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  if (playerSeekFill) playerSeekFill.style.width = `${clampedRatio * 100}%`;
  if (validDur > 0) {
    const targetSec = clampedRatio * validDur;
    if (playerSeekInput) playerSeekInput.value = targetSec;
    if (playerCurrentTime) playerCurrentTime.textContent = window.formatTime(targetSec);
  }
}

function applySeekPosition(ratio) {
  const playerSeekFill = document.getElementById('playerSeekFill');
  const playerSeekInput = document.getElementById('playerSeekInput');
  const playerCurrentTime = document.getElementById('playerCurrentTime');

  const dur = audio.duration;
  const validDur = dur && Number.isFinite(dur) && dur > 0 ? dur : currentPlayingTrack?.duration || 0;
  if (validDur > 0) {
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const targetSec = clampedRatio * validDur;
    if (playerSeekFill) playerSeekFill.style.width = `${clampedRatio * 100}%`;
    if (playerSeekInput) playerSeekInput.value = targetSec;
    if (playerCurrentTime) playerCurrentTime.textContent = window.formatTime(targetSec);
    try {
      audio.currentTime = targetSec;
    } catch (err) {
      console.warn('Seek error:', err);
    }
  }
}

function initPlayerListeners() {
  const btnPlayerPlay = document.getElementById('btnPlayerPlay');
  const btnPlayerPrev = document.getElementById('btnPlayerPrev');
  const btnPlayerNext = document.getElementById('btnPlayerNext');
  const playerTrackList = document.getElementById('playerTrackList');
  const playerSeekWrapper = document.getElementById('playerSeekWrapper');
  const playerSeekInput = document.getElementById('playerSeekInput');

  if (btnPlayerPlay) btnPlayerPlay.addEventListener('click', togglePlay);
  if (btnPlayerPrev) btnPlayerPrev.addEventListener('click', prevTrack);
  if (btnPlayerNext) btnPlayerNext.addEventListener('click', nextTrack);

  if (playerTrackList) {
    playerTrackList.addEventListener('scroll', () => {
      renderTrackList();
    });
  }

  audio.addEventListener('play', () => {
    isPlaying = true;
    if (btnPlayerPlay) btnPlayerPlay.textContent = '❚❚';
    renderTrackList();
  });

  audio.addEventListener('pause', () => {
    isPlaying = false;
    if (btnPlayerPlay) btnPlayerPlay.textContent = '▶';
    renderTrackList();
  });

  audio.addEventListener('ended', () => {
    nextTrack();
  });

  audio.addEventListener('loadedmetadata', updateDurationDisplay);
  audio.addEventListener('durationchange', updateDurationDisplay);
  audio.addEventListener('canplay', updateDurationDisplay);

  audio.addEventListener('timeupdate', () => {
    if (!isDraggingSeek) {
      const cur = audio.currentTime;
      const dur = audio.duration;
      const playerSeekFill = document.getElementById('playerSeekFill');
      const playerCurrentTime = document.getElementById('playerCurrentTime');
      const playerTotalTime = document.getElementById('playerTotalTime');

      if (dur && Number.isFinite(dur) && dur > 0) {
        if (playerSeekInput) {
          playerSeekInput.max = dur;
          playerSeekInput.value = cur;
        }
        const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
        if (playerSeekFill) playerSeekFill.style.width = `${pct}%`;
        if (playerCurrentTime) playerCurrentTime.textContent = window.formatTime(cur);
        if (playerTotalTime) playerTotalTime.textContent = window.formatTime(dur);
      } else if (playerCurrentTime) {
        playerCurrentTime.textContent = window.formatTime(cur);
      }
    }
  });

  if (playerSeekWrapper) {
    playerSeekWrapper.addEventListener('pointerdown', (e) => {
      if (!playerSeekInput || playerSeekInput.disabled || !currentPlayingTrack) return;
      isDraggingSeek = true;
      isPointerDownOnSeek = true;
      try {
        playerSeekWrapper.setPointerCapture(e.pointerId);
      } catch {}
      const ratio = getSeekRatioFromEvent(e);
      previewSeekPosition(ratio);
    });

    playerSeekWrapper.addEventListener('pointermove', (e) => {
      if (!isPointerDownOnSeek) return;
      const ratio = getSeekRatioFromEvent(e);
      previewSeekPosition(ratio);
    });

    const finishSeekPointer = (e) => {
      if (!isPointerDownOnSeek) return;
      isPointerDownOnSeek = false;
      isDraggingSeek = false;
      const ratio = getSeekRatioFromEvent(e);
      applySeekPosition(ratio);
    };

    playerSeekWrapper.addEventListener('pointerup', finishSeekPointer);
    playerSeekWrapper.addEventListener('pointercancel', finishSeekPointer);
  }

  if (playerSeekInput) {
    playerSeekInput.addEventListener('input', (e) => {
      isDraggingSeek = true;
      const val = parseFloat(e.target.value);
      const dur = audio.duration || 1;
      const pct = (val / dur) * 100;
      const playerSeekFill = document.getElementById('playerSeekFill');
      const playerCurrentTime = document.getElementById('playerCurrentTime');
      if (playerSeekFill) playerSeekFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      if (playerCurrentTime) playerCurrentTime.textContent = window.formatTime(val);
    });

    playerSeekInput.addEventListener('change', (e) => {
      isDraggingSeek = false;
      const val = parseFloat(e.target.value);
      if (Number.isFinite(val) && audio.duration) {
        audio.currentTime = val;
      }
    });
  }
}

window.addTrackToPlayer = addTrackToPlayer;
window.scanAndLoadLibrary = scanAndLoadLibrary;
window.renderTrackList = renderTrackList;
window.playTrack = playTrack;
window.togglePlay = togglePlay;
window.prevTrack = prevTrack;
window.nextTrack = nextTrack;
window.initPlayerListeners = initPlayerListeners;
