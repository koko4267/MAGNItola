// Audio player and track list

const audio = new Audio();
audio.volume = 1.0;
let shuffleEnabled = false;
let repeatMode = 'repeatAll';
const shuffleHistory = [];
const shufflePlayed = new Set();

function resetShuffle() {
  shuffleHistory.length = 0;
  shufflePlayed.clear();
}

function updatePlayerModes() {
  document.getElementById('btnShuffle').setAttribute('aria-pressed', String(shuffleEnabled));
  const repeat = document.getElementById('btnRepeat');
  repeat.title = window.L[repeatMode];
  repeat.setAttribute('aria-label', repeat.title);
  repeat.setAttribute('data-active', String(repeatMode !== 'repeatOff'));
  document.getElementById('repeatOneBadge').hidden = repeatMode !== 'repeatOne';
}

let libraryTracks = [];
let currentPlayingTrack = null;
let isDraggingSeek = false;
let isPointerDownOnSeek = false;

let selectedFolder = '';
let pendingScan = null;
let selectedIndex = 0;
const coverRequests = new Map();

function loadCover(path) {
  if (!coverRequests.has(path)) {
    const request = window.electronAPI
      .readTrackCover(path)
      .then((cover) => {
        if (cover) setArtworkCache(path, cover);
        return cover;
      })
      .finally(() => coverRequests.delete(path));
    coverRequests.set(path, request);
  }
  return coverRequests.get(path);
}

const artworkCache = new Map();
let cachedArtworkChars = 0;

function setArtworkCache(key, value) {
  const max = window.APP_CONFIG?.ARTWORK_CACHE_MAX || 200;
  const maxChars = window.APP_CONFIG?.ARTWORK_CACHE_MAX_CHARS || 32 * 1024 * 1024;
  if (artworkCache.has(key)) {
    cachedArtworkChars -= artworkCache.get(key).length;
    artworkCache.delete(key);
  }
  if (value.length > maxChars) return;
  while (artworkCache.size >= max || cachedArtworkChars + value.length > maxChars) {
    const oldestKey = artworkCache.keys().next().value;
    cachedArtworkChars -= artworkCache.get(oldestKey).length;
    artworkCache.delete(oldestKey);
  }
  artworkCache.set(key, value);
  cachedArtworkChars += value.length;
}

function getArtworkCache(key) {
  if (!artworkCache.has(key)) return null;
  const val = artworkCache.get(key);
  artworkCache.delete(key);
  artworkCache.set(key, val);
  return val;
}

function getMediaUrl(filePath) {
  return `media://local/${encodeURIComponent(filePath)}`;
}

function updatePlayerButtonsState() {
  const btnPlayerPrev = document.getElementById('btnPlayerPrev');
  const btnPlayerPlay = document.getElementById('btnPlayerPlay');
  const btnPlayerNext = document.getElementById('btnPlayerNext');

  const hasTracks = libraryTracks.length > 0;
  if (btnPlayerPrev) btnPlayerPrev.disabled = !hasTracks;
  if (btnPlayerPlay) btnPlayerPlay.disabled = !hasTracks && !currentPlayingTrack;
  if (btnPlayerNext) btnPlayerNext.disabled = !hasTracks;
}

function addTrackToPlayer(track, folder) {
  if (folder && selectedFolder && folder.toLowerCase() !== selectedFolder) return;
  const { artworkDataUrl, ...metadata } = track;
  const fileKey = metadata.filePath.toLowerCase();
  pendingScan?.added.set(fileKey, metadata);
  const existingIdx = libraryTracks.findIndex((t) => t.filePath.toLowerCase() === fileKey);
  if (existingIdx !== -1) {
    libraryTracks[existingIdx] = metadata;
  } else {
    if (libraryTracks.length) selectedIndex++;
    libraryTracks.unshift(metadata);
  }
  if (artworkDataUrl) {
    setArtworkCache(metadata.filePath, artworkDataUrl);
  }
  renderTrackList();
  updatePlayerButtonsState();
}

async function scanAndLoadLibrary(folder) {
  const api = window.electronAPI || null;
  if (!api?.scanLibrary || !folder) return;
  const scan = { added: new Map() };
  pendingScan = scan;
  if (selectedFolder !== folder.toLowerCase()) {
    selectedFolder = folder.toLowerCase();
    resetShuffle();
    libraryTracks = [];
    selectedIndex = 0;
    renderTrackList();
    updatePlayerButtonsState();
  }
  try {
    const tracks = await api.scanLibrary(folder);
    if (pendingScan !== scan) return;
    const previousPath = libraryTracks[selectedIndex]?.filePath;
    libraryTracks = [...scan.added.values()]
      .reverse()
      .concat((tracks || []).filter((track) => !scan.added.has(track.filePath.toLowerCase())));
    selectedIndex = Math.max(
      0,
      libraryTracks.findIndex((track) => track.filePath === previousPath)
    );
    renderTrackList();
    updatePlayerButtonsState();
  } catch (err) {
    console.error('Scan library error:', err);
  } finally {
    if (pendingScan === scan) pendingScan = null;
  }
}

function updatePlaybackButton() {
  const button = document.getElementById('btnPlayerPlay');
  if (!button) return;
  const playing = !audio.paused && !audio.ended && !audio.error;
  button.textContent = playing ? '❚❚' : '▶';
  if (currentPlayingTrack) button.title = playing ? window.L.playing : window.L.paused;
}

function startPlayback() {
  audio.play().catch((error) => {
    updatePlaybackButton();
    console.warn('Playback start warning:', error);
  });
}

// Track row element
function createTrackItemElement(tr, index, topPx) {
  const row = document.createElement('div');
  row.className = 'track-item-row';
  row.id = 'library-track-' + index;
  row.setAttribute('role', 'option');
  row.style.top = `${topPx}px`;

  row.setAttribute('data-index', String(index));

  const artBox = document.createElement('div');
  artBox.className = 'track-item-art';

  const img = document.createElement('img');
  img.alt = '';
  img.style.display = 'none';

  const icon = document.createElement('span');
  icon.className = 'track-item-icon';
  icon.textContent = '♫';

  artBox.appendChild(img);
  artBox.appendChild(icon);

  // Lazy load cover
  const cached = getArtworkCache(tr.filePath);
  if (cached) {
    img.src = cached;
    img.style.display = 'block';
    icon.style.display = 'none';
  } else if (tr.hasCover) {
    const api = window.electronAPI || null;
    if (api?.readTrackCover) {
      loadCover(tr.filePath)
        .then((coverDataUrl) => {
          if (coverDataUrl) {
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
  titleEl.textContent = tr.title || window.L?.untitled || 'Untitled';

  const artistEl = document.createElement('div');
  artistEl.className = 'track-item-artist';
  artistEl.textContent = tr.artist || window.L?.unknownArtist || 'Unknown';

  metaBox.appendChild(titleEl);
  metaBox.appendChild(artistEl);

  row.appendChild(artBox);
  row.appendChild(metaBox);

  row.addEventListener('click', () => {
    selectedIndex = index;
    playTrack(tr);
  });

  return row;
}

// Virtualized track list
function renderTrackList() {
  const container = document.getElementById('playerTrackList');
  if (!container) return;

  if (libraryTracks.length === 0) {
    container.removeAttribute('aria-activedescendant');
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

  const keep = new Set();
  for (let i = startIdx; i < endIdx; i++) keep.add(i);
  if (selectedIndex >= 0 && document.activeElement === container) keep.add(selectedIndex);
  const rows = new Map(Array.from(spacer.children, (row) => [Number(row.dataset.index), row]));
  for (const [index, row] of rows) {
    if (!keep.has(index) || row.track !== libraryTracks[index]) {
      row.remove();
      rows.delete(index);
    }
  }
  container.removeAttribute('aria-activedescendant');
  let previous = null;
  for (const index of [...keep].sort((a, b) => a - b)) {
    const track = libraryTracks[index];
    let row = rows.get(index);
    if (!row) {
      row = createTrackItemElement(track, index, index * rowHeight);
      row.track = track;
      spacer.insertBefore(row, previous ? previous.nextElementSibling : spacer.firstElementChild);
    }
    previous = row;
    row.setAttribute('aria-posinset', String(index + 1));
    row.setAttribute('aria-setsize', String(libraryTracks.length));
    row.setAttribute('aria-selected', String(index === selectedIndex));
    row.classList.toggle('active', track.filePath === currentPlayingTrack?.filePath);
    if (index === selectedIndex) container.setAttribute('aria-activedescendant', row.id);
  }
}

function revealTrack(index) {
  const container = document.getElementById('playerTrackList');
  if (index < 0 || !container?.clientHeight) return;
  const height = window.APP_CONFIG?.TRACK_ROW_HEIGHT_PX || 58;
  const spacer = container.querySelector('.virtual-scroll-spacer');
  const top = (spacer?.offsetTop || 0) + index * height;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (top + height > container.scrollTop + container.clientHeight) {
    container.scrollTop = top + height - container.clientHeight;
  }
}

function playTrack(track, rememberPrevious = true) {
  if (!track) return;
  if (shuffleEnabled) {
    if (rememberPrevious && currentPlayingTrack && currentPlayingTrack.filePath !== track.filePath) {
      shuffleHistory.push(currentPlayingTrack.filePath);
    }
    shufflePlayed.add(track.filePath);
  }
  currentPlayingTrack = track;

  const playerLargeArtContainer = document.getElementById('playerLargeArtContainer');
  const playerLargeArtTitle = document.getElementById('playerLargeArtTitle');
  const playerLargeArtArtist = document.getElementById('playerLargeArtArtist');
  const playerLargeArtImg = document.getElementById('playerLargeArtImg');
  const playerLargeArtPlaceholder = document.getElementById('playerLargeArtPlaceholder');
  const playerSeekInput = document.getElementById('playerSeekInput');
  const playerSeekFill = document.getElementById('playerSeekFill');
  const playerCurrentTime = document.getElementById('playerCurrentTime');
  const playerTotalTime = document.getElementById('playerTotalTime');

  if (playerLargeArtContainer) playerLargeArtContainer.style.display = 'flex';
  if (playerLargeArtTitle) playerLargeArtTitle.textContent = track.title;
  if (playerLargeArtArtist) playerLargeArtArtist.textContent = track.artist;

  const coverUrl = getArtworkCache(track.filePath);
  if (coverUrl) {
    if (playerLargeArtImg) {
      playerLargeArtImg.src = coverUrl;
      playerLargeArtImg.style.display = 'block';
    }
    if (playerLargeArtPlaceholder) playerLargeArtPlaceholder.style.display = 'none';
  } else if (track.hasCover && window.electronAPI?.readTrackCover) {
    if (playerLargeArtImg) playerLargeArtImg.style.display = 'none';
    if (playerLargeArtPlaceholder) playerLargeArtPlaceholder.style.display = 'flex';

    loadCover(track.filePath)
      .then((dataUrl) => {
        if (dataUrl) {
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
  startPlayback();
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

  revealTrack(libraryTracks.indexOf(track));
  renderTrackList();
}

function togglePlay() {
  if (!currentPlayingTrack && libraryTracks.length > 0) {
    nextTrack();
    return;
  }
  if (!currentPlayingTrack) return;

  if (audio.ended && repeatMode === 'repeatOff') {
    if (shuffleEnabled) return nextTrack();
    if (libraryTracks.length) return playTrack(libraryTracks[0]);
  }
  if (audio.paused) startPlayback();
  else audio.pause();
}

function prevTrack() {
  if (libraryTracks.length === 0) return;
  if (shuffleEnabled) {
    while (shuffleHistory.length) {
      const path = shuffleHistory.pop();
      const track = libraryTracks.find((item) => item.filePath === path);
      if (track) {
        shufflePlayed.delete(currentPlayingTrack?.filePath);
        return playTrack(track, false);
      }
    }
    if (currentPlayingTrack) return playTrack(currentPlayingTrack);
    return nextTrack();
  }
  if (!currentPlayingTrack) {
    playTrack(libraryTracks[0]);
    return;
  }
  const idx = libraryTracks.findIndex((t) => t.filePath === currentPlayingTrack.filePath);
  const nextIdx = idx > 0 ? idx - 1 : libraryTracks.length - 1;
  playTrack(libraryTracks[nextIdx]);
}

function nextTrack(automatic = false) {
  if (libraryTracks.length === 0) return;
  const idx = libraryTracks.findIndex((t) => t.filePath === currentPlayingTrack?.filePath);
  if (shuffleEnabled) {
    let candidates = libraryTracks.filter((track) => !shufflePlayed.has(track.filePath));
    if (!candidates.length) {
      if (automatic && repeatMode === 'repeatOff') return;
      resetShuffle();
      candidates = libraryTracks.filter((_, index) => index !== idx);
      if (!candidates.length) candidates = libraryTracks;
    }
    playTrack(candidates[Math.floor(Math.random() * candidates.length)]);
    return;
  }
  if (automatic && repeatMode === 'repeatOff' && idx === libraryTracks.length - 1) return;
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

function updatePointerSeekPosition(ratio, commit = false) {
  const dur = audio.duration;
  const validDur = dur && Number.isFinite(dur) && dur > 0 ? dur : currentPlayingTrack?.duration || 0;
  if (commit && validDur <= 0) return;

  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const playerSeekFill = document.getElementById('playerSeekFill');
  if (playerSeekFill) playerSeekFill.style.width = `${clampedRatio * 100}%`;
  if (validDur <= 0) return;
  const targetSec = clampedRatio * validDur;
  const playerSeekInput = document.getElementById('playerSeekInput');
  const playerCurrentTime = document.getElementById('playerCurrentTime');
  if (playerSeekInput) playerSeekInput.value = targetSec;
  if (playerCurrentTime) playerCurrentTime.textContent = window.formatTime(targetSec);

  if (commit) {
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
  if (btnPlayerNext) btnPlayerNext.addEventListener('click', () => nextTrack());
  document.getElementById('btnShuffle').addEventListener('click', () => {
    shuffleEnabled = !shuffleEnabled;
    resetShuffle();
    if (shuffleEnabled && currentPlayingTrack) shufflePlayed.add(currentPlayingTrack.filePath);
    updatePlayerModes();
  });
  document.getElementById('btnRepeat').addEventListener('click', () => {
    repeatMode = { repeatAll: 'repeatOne', repeatOne: 'repeatOff', repeatOff: 'repeatAll' }[repeatMode];
    audio.loop = repeatMode === 'repeatOne';
    updatePlayerModes();
  });
  const volume = document.getElementById('playerVolume');
  volume.addEventListener('input', () => {
    audio.volume = Number(volume.value) / 100;
    const level = volume.value + '%';
    volume.style.setProperty('--level', level);
    volume.setAttribute('aria-valuetext', level);
    document.getElementById('volumeValue').textContent = level;
  });

  if (playerTrackList) {
    playerTrackList.addEventListener('focus', renderTrackList);
    playerTrackList.addEventListener('keydown', (event) => {
      if (!libraryTracks.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      let index = selectedIndex;
      if (event.key === 'Enter') return playTrack(libraryTracks[index]);
      index = Math.min(libraryTracks.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
      selectedIndex = index;
      revealTrack(index);
      renderTrackList();
    });
    let scrollRafId = null;
    playerTrackList.addEventListener(
      'scroll',
      () => {
        if (scrollRafId) return;
        scrollRafId = requestAnimationFrame(() => {
          renderTrackList();
          scrollRafId = null;
        });
      },
      { passive: true }
    );
  }

  audio.addEventListener('play', updatePlaybackButton);
  const animation = document.getElementById('playbackAnimation');
  const gif = document.getElementById('playbackGif');
  const idleGif = document.getElementById('idleGif');
  const animations = window.electronAPI?.listAnimations?.().catch(() => []);
  let animationTrackPath = null;
  let currentAnimation = null;
  let playbackEvent = 0;
  let decoder = null;
  let nextFrame = 0;

  async function playGif(eventId) {
    if (!decoder) {
      const data = await window.electronAPI.readAnimationGif(currentAnimation);
      if (eventId !== playbackEvent) return;
      decoder = new ImageDecoder({ type: 'image/gif', data });
    }
    await decoder.tracks.ready;
    const context = gif.getContext('2d');
    while (eventId === playbackEvent) {
      const { image } = await decoder.decode({ frameIndex: nextFrame });
      const duration = image.duration / 1000;
      try {
        if (eventId !== playbackEvent) return;
        if (gif.width !== image.displayWidth) gif.width = image.displayWidth;
        if (gif.height !== image.displayHeight) gif.height = image.displayHeight;
        context.clearRect(0, 0, gif.width, gif.height);
        context.drawImage(image, 0, 0);
        const frames = decoder.tracks.selectedTrack.frameCount;
        if (frames === 1) return;
        nextFrame = (nextFrame + 1) % frames;
      } finally {
        image.close();
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(10, duration)));
    }
  }

  audio.addEventListener('playing', async () => {
    const eventId = ++playbackEvent;
    const files = await animations;
    if (
      eventId !== playbackEvent ||
      !files?.length ||
      !currentPlayingTrack ||
      audio.paused ||
      audio.ended ||
      audio.error
    )
      return;
    if (animationTrackPath !== currentPlayingTrack.filePath) {
      const choices = files.length > 1 ? files.filter((name) => name !== currentAnimation) : files;
      currentAnimation = choices[Math.floor(Math.random() * choices.length)];
      animationTrackPath = currentPlayingTrack.filePath;
      decoder?.close();
      decoder = null;
      nextFrame = 0;
      if (/\.gif$/i.test(currentAnimation)) gif.getContext('2d').clearRect(0, 0, gif.width, gif.height);
      else animation.src = 'assets/animations/' + encodeURIComponent(currentAnimation);
    }
    idleGif.hidden = true;
    animation.hidden = /\.gif$/i.test(currentAnimation);
    gif.hidden = !animation.hidden;
    const playback = animation.hidden ? playGif(eventId) : animation.play();
    playback.catch((error) => {
      if (eventId === playbackEvent && error.name !== 'AbortError') console.warn('Animation playback failed:', error);
    });
  });
  audio.addEventListener('pause', () => {
    playbackEvent++;
    if (animation.paused === false) animation.pause();
    updatePlaybackButton();
  });
  for (const event of ['waiting', 'emptied', 'error', 'ended']) {
    audio.addEventListener(event, () => {
      if (event === 'waiting' && audio.paused) return;
      playbackEvent++;
      idleGif.hidden = false;
      animation.hidden = true;
      gif.hidden = true;
      if (animation.paused === false) animation.pause();
    });
  }
  audio.addEventListener('error', updatePlaybackButton);

  audio.addEventListener('ended', () => {
    updatePlaybackButton();
    nextTrack(true);
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
      updatePointerSeekPosition(ratio);
    });

    playerSeekWrapper.addEventListener('pointermove', (e) => {
      if (!isPointerDownOnSeek) return;
      const ratio = getSeekRatioFromEvent(e);
      updatePointerSeekPosition(ratio);
    });

    const finishSeekPointer = (e) => {
      if (!isPointerDownOnSeek) return;
      isPointerDownOnSeek = false;
      isDraggingSeek = false;
      const ratio = getSeekRatioFromEvent(e);
      updatePointerSeekPosition(ratio, true);
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
window.updatePlaybackButton = updatePlaybackButton;
window.initPlayerListeners = initPlayerListeners;
