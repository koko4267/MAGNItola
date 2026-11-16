// SoundCloud downloader and queue manager

window.isDownloading = false;
window.cancelRequested = false;
let currentWorker = null;

let downloadQueue = [];
let queueStatuses = []; // 'wait' | 'down' | 'done' | 'skip' | 'fail'

async function getActiveClientId(forceRefresh = false) {
  if (forceRefresh) {
    localStorage.removeItem('magnitola_sc_client_id');
  } else {
    const cached = localStorage.getItem('magnitola_sc_client_id');
    if (cached) return cached;
    if (window.APP_CONFIG?.SOUNDCLOUD_CLIENT_ID) return window.APP_CONFIG.SOUNDCLOUD_CLIENT_ID;
  }
  const api = window.electronAPI || null;
  if (api?.refreshSoundCloudClientId) {
    try {
      const fresh = await api.refreshSoundCloudClientId();
      if (fresh) {
        localStorage.setItem('magnitola_sc_client_id', fresh);
        if (window.APP_CONFIG) window.APP_CONFIG.SOUNDCLOUD_CLIENT_ID = fresh;
        return fresh;
      }
    } catch (err) {
      console.warn('Failed to refresh SoundCloud client_id:', err);
    }
  }
  return window.APP_CONFIG?.SOUNDCLOUD_CLIENT_ID || '5lnU5PEpImc23JXFHBdq8E6QDd39I2uT';
}

function encodeAudioBufferWithWorker(audioBuffer, bitrate = 192, onProgress = null) {
  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker('js/encoder-worker.js');
      currentWorker = worker;

      const channels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const leftChannel = audioBuffer.getChannelData(0);
      const rightChannel = channels > 1 ? audioBuffer.getChannelData(1) : leftChannel;

      worker.onmessage = function (e) {
        const msg = e.data;
        if (msg.type === 'progress') {
          if (onProgress) onProgress(msg.percent);
        } else if (msg.type === 'done') {
          worker.terminate();
          if (currentWorker === worker) currentWorker = null;
          resolve(msg.buffer);
        } else if (msg.type === 'cancelled') {
          worker.terminate();
          if (currentWorker === worker) currentWorker = null;
          reject(new Error('Encoding cancelled'));
        } else if (msg.type === 'error') {
          worker.terminate();
          if (currentWorker === worker) currentWorker = null;
          reject(new Error(msg.error || 'Worker encoding error'));
        }
      };

      worker.onerror = function (err) {
        worker.terminate();
        if (currentWorker === worker) currentWorker = null;
        reject(err);
      };

      worker.postMessage({
        type: 'encode',
        leftChannel,
        rightChannel,
        channels,
        sampleRate,
        bitrate
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Render download queue
function renderDownloadQueue() {
  const queueBox = document.getElementById('downloadQueueBox');
  const queueList = document.getElementById('queueListContainer');
  const queueCounter = document.getElementById('queueHeaderCount');
  if (!queueBox || !queueList) return;

  if (downloadQueue.length === 0) {
    queueBox.style.display = 'none';
    queueList.replaceChildren();
    return;
  }

  queueBox.style.display = 'flex';
  const total = downloadQueue.length;
  const doneCount = queueStatuses.filter((s) => s === 'done' || s === 'skip').length;
  if (queueCounter) {
    queueCounter.textContent = `${doneCount}/${total}`;
  }

  queueList.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < total; i++) {
    const item = downloadQueue[i];
    const status = queueStatuses[i] || 'wait';

    const row = document.createElement('div');
    row.className = 'queue-item-row';
    row.id = `queueItem-${i}`;

    const statusBadge = document.createElement('span');
    statusBadge.className = `queue-item-status queue-status-${status}`;
    let statusText = window.L?.queueStatusWait || 'WAIT';
    if (status === 'down') statusText = window.L?.queueStatusDown || 'DOWN';
    if (status === 'done') statusText = window.L?.queueStatusDone || 'DONE';
    if (status === 'skip') statusText = window.L?.queueStatusSkip || 'SKIP';
    if (status === 'fail') statusText = window.L?.queueStatusFail || 'FAIL';
    statusBadge.textContent = statusText;

    const titleEl = document.createElement('span');
    titleEl.className = 'queue-item-title';
    titleEl.textContent = item.title || 'Untitled';

    const artistEl = document.createElement('span');
    artistEl.className = 'queue-item-artist';
    artistEl.textContent = item.user?.username || 'MAGNItola';

    row.appendChild(statusBadge);
    row.appendChild(titleEl);
    row.appendChild(artistEl);
    fragment.appendChild(row);
  }

  queueList.appendChild(fragment);

  // Auto scroll to active/downloading item
  const activeIdx = queueStatuses.findIndex((s) => s === 'down');
  if (activeIdx !== -1) {
    const activeRow = document.getElementById(`queueItem-${activeIdx}`);
    if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
  }
}

function updateQueueItemStatus(index, status) {
  queueStatuses[index] = status;
  const row = document.getElementById(`queueItem-${index}`);
  if (row) {
    const badge = row.querySelector('.queue-item-status');
    if (badge) {
      badge.className = `queue-item-status queue-status-${status}`;
      let statusText = window.L?.queueStatusWait || 'WAIT';
      if (status === 'down') statusText = window.L?.queueStatusDown || 'DOWN';
      if (status === 'done') statusText = window.L?.queueStatusDone || 'DONE';
      if (status === 'skip') statusText = window.L?.queueStatusSkip || 'SKIP';
      if (status === 'fail') statusText = window.L?.queueStatusFail || 'FAIL';
      badge.textContent = statusText;
    }
    if (status === 'down') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  const queueCounter = document.getElementById('queueHeaderCount');
  if (queueCounter) {
    const doneCount = queueStatuses.filter((s) => s === 'done' || s === 'skip').length;
    queueCounter.textContent = `${doneCount}/${downloadQueue.length}`;
  }
}

async function resolveSoundCloudUrl(url) {
  let clientId = await getActiveClientId();
  let cleanUrl = url.trim();

  if (cleanUrl.includes('on.soundcloud.com')) {
    try {
      const resp = await window.fetchWithRetry(cleanUrl, { method: 'GET', redirect: 'follow' });
      if (resp.url && resp.url !== cleanUrl) {
        cleanUrl = resp.url;
      }
    } catch (e) {
      console.warn('Could not expand shortlink:', e);
    }
  }

  const resolveTarget = cleanUrl.replace(/\/likes\/?(\?.*)?$/i, '').replace(/\/+$/, '');
  let resolveApi = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(resolveTarget)}&client_id=${clientId}`;

  let resp = await window.fetchWithRetry(resolveApi);
  if (resp.status === 401) {
    console.warn('SoundCloud resolve returned 401, refreshing client_id...');
    clientId = await getActiveClientId(true);
    resolveApi = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(resolveTarget)}&client_id=${clientId}`;
    resp = await window.fetchWithRetry(resolveApi);
  }

  if (!resp.ok) {
    throw new Error(`SoundCloud resolve failed with status ${resp.status}`);
  }

  const data = await resp.json();
  const kind = data.kind;
  let trackQueue = [];
  let subFolder = null;

  if (kind === 'track') {
    trackQueue = [data];
  } else if (kind === 'playlist' || kind === 'system-playlist') {
    const title = (data.title || '').trim();
    subFolder = window.sanitizeFolderName(title) || (data.set_type === 'album' ? 'Album' : 'Playlist');
    const tracksElement = data.tracks || [];
    const trackIdsToFetch = [];

    for (const item of tracksElement) {
      if (item.media && item.media.transcodings) {
        trackQueue.push(item);
      } else if (item.id) {
        trackIdsToFetch.push(item.id);
      }
    }

    if (trackIdsToFetch.length > 0) {
      for (let i = 0; i < trackIdsToFetch.length; i += 50) {
        if (window.cancelRequested) break;
        const batch = trackIdsToFetch.slice(i, i + 50);
        let batchUrl = `https://api-v2.soundcloud.com/tracks?ids=${batch.join('%2C')}&client_id=${clientId}`;
        let bResp = await window.fetchWithRetry(batchUrl);
        if (bResp.status === 401) {
          clientId = await getActiveClientId(true);
          batchUrl = `https://api-v2.soundcloud.com/tracks?ids=${batch.join('%2C')}&client_id=${clientId}`;
          bResp = await window.fetchWithRetry(batchUrl);
        }
        if (bResp.ok) {
          const bTracks = await bResp.json();
          trackQueue.push(...bTracks);
        }
      }
    }
  } else if (kind === 'user') {
    subFolder = 'Likes';
    const userId = data.id;
    let likesUrl = `https://api-v2.soundcloud.com/users/${userId}/likes?client_id=${clientId}&limit=50`;

    while (likesUrl && !window.cancelRequested) {
      let lResp = await window.fetchWithRetry(likesUrl);
      if (lResp.status === 401) {
        clientId = await getActiveClientId(true);
        likesUrl = likesUrl.replace(/client_id=[a-zA-Z0-9]+/, `client_id=${clientId}`);
        lResp = await window.fetchWithRetry(likesUrl);
      }
      if (!lResp.ok) break;
      const lData = await lResp.json();

      for (const item of lData.collection || []) {
        if (item.track && item.track.media && item.track.media.transcodings) {
          trackQueue.push(item.track);
        } else if (item.playlist && item.playlist.tracks) {
          for (const ptr of item.playlist.tracks) {
            if (ptr && ptr.media && ptr.media.transcodings) {
              trackQueue.push(ptr);
            }
          }
        } else if (item.media && item.media.transcodings) {
          trackQueue.push(item);
        }
      }

      if (lData.next_href) {
        likesUrl = lData.next_href;
        if (!likesUrl.includes('client_id=')) {
          likesUrl += `&client_id=${clientId}`;
        }
      } else {
        likesUrl = null;
      }
    }
  } else {
    throw new Error(window.L.invalidUrlError);
  }

  return {
    tracks: trackQueue,
    subFolder,
    kind,
    title: data.title || null
  };
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

async function downloadTrack(track, index, total, subFolder = null, setMeta = {}) {
  const api = window.electronAPI || null;
  let clientId = await getActiveClientId();

  const title = track.title || 'Untitled';
  const artist = track.user ? track.user.username || 'Unknown Artist' : 'MAGNItola';
  const artwork = track.artwork_url || (track.user ? track.user.avatar_url : null);
  const fileName = `${window.sanitizeFileName(artist)} - ${window.sanitizeFileName(title)}.mp3`;

  const currentTrackTitle = document.getElementById('currentTrackTitle');
  const currentTrackArtist = document.getElementById('currentTrackArtist');
  const albumArtImg = document.getElementById('albumArtImg');
  const albumArtIcon = document.getElementById('albumArtIcon');
  const lblCurrentStatus = document.getElementById('lblCurrentStatus');
  const downloadSpeedStats = document.getElementById('downloadSpeedStats');
  const downloadSizeStats = document.getElementById('downloadSizeStats');

  setDownloadProgress(0);
  if (currentTrackTitle) currentTrackTitle.textContent = title;
  if (currentTrackArtist) currentTrackArtist.textContent = artist;

  const hiResArtwork = window.getCoverArtUrl(artwork);
  if (hiResArtwork && albumArtImg && albumArtIcon) {
    albumArtImg.src = hiResArtwork;
    albumArtImg.style.display = 'block';
    albumArtIcon.style.display = 'none';
  } else if (albumArtImg && albumArtIcon) {
    albumArtImg.style.display = 'none';
    albumArtIcon.style.display = 'block';
  }

  const downloadFolder = localStorage.getItem('magnitola_save_folder') || '';

  // Check if file exists on disk
  if (api?.checkFileExists) {
    const targetDir = downloadFolder || (await api.getDefaultDownloadsFolder());
    const check = await api.checkFileExists({ folder: targetDir, subFolder, fileName });
    if (check?.exists) {
      if (lblCurrentStatus) {
        lblCurrentStatus.textContent = `${window.L.currentStatus || 'Current download:'} ${window.L.alreadyExists || 'Already exists'}`;
      }
      setDownloadProgress(100);
      if (downloadSpeedStats) downloadSpeedStats.textContent = 'SKIP';
      if (downloadSizeStats) downloadSizeStats.textContent = '-- / -- MB';
      updateQueueItemStatus(index - 1, 'skip');
      await new Promise((r) => setTimeout(r, 120));
      return true;
    }
  }

  updateQueueItemStatus(index - 1, 'down');

  try {
    const transcodings = track.media && track.media.transcodings ? track.media.transcodings : [];
    if (transcodings.length === 0) {
      updateQueueItemStatus(index - 1, 'fail');
      return false;
    }

    const sorted = [...transcodings].sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;
      if (a.format?.protocol === 'progressive' && a.format?.mime_type === 'audio/mpeg') scoreA += 500;
      if (b.format?.protocol === 'progressive' && b.format?.mime_type === 'audio/mpeg') scoreB += 500;
      if (a.preset === 'aac_160k') scoreA += 300;
      if (b.preset === 'aac_160k') scoreB += 300;
      if (a.preset === 'aac_96k') scoreA += 200;
      if (b.preset === 'aac_96k') scoreB += 200;
      if (a.format?.mime_type?.includes('mp4') || a.format?.mime_type?.includes('aac')) scoreA += 100;
      if (b.format?.mime_type?.includes('mp4') || b.format?.mime_type?.includes('aac')) scoreB += 100;
      return scoreB - scoreA;
    });

    let audioBuffer = null;

    for (const selected of sorted) {
      if (window.cancelRequested) {
        updateQueueItemStatus(index - 1, 'wait');
        return false;
      }

      let streamInfoUrl = `${selected.url}?client_id=${clientId}`;
      if (track.track_authorization) {
        streamInfoUrl += `&track_authorization=${encodeURIComponent(track.track_authorization)}`;
      }

      let streamResp = await window.fetchWithRetry(streamInfoUrl);
      if (streamResp.status === 401) {
        clientId = await getActiveClientId(true);
        streamInfoUrl = `${selected.url}?client_id=${clientId}`;
        if (track.track_authorization) {
          streamInfoUrl += `&track_authorization=${encodeURIComponent(track.track_authorization)}`;
        }
        streamResp = await window.fetchWithRetry(streamInfoUrl);
      }
      if (!streamResp.ok) continue;

      const streamJson = await streamResp.json();
      const audioCdnUrl = streamJson.url;
      if (!audioCdnUrl) continue;

      if (selected.format?.protocol === 'progressive' || !audioCdnUrl.includes('.m3u8')) {
        const audioResp = await window.fetchWithRetry(audioCdnUrl);
        if (!audioResp.ok) continue;

        const contentLength = +audioResp.headers.get('Content-Length') || 0;
        const reader = audioResp.body.getReader();
        let receivedBytes = 0;
        const chunks = [];
        const startTime = Date.now();

        while (true) {
          if (window.cancelRequested) {
            await reader.cancel();
            updateQueueItemStatus(index - 1, 'wait');
            return false;
          }

          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          receivedBytes += value.length;

          const willEncode = !(
            selected.format?.protocol === 'progressive' && selected.format?.mime_type === 'audio/mpeg'
          );
          const rawPercent = contentLength > 0 ? (receivedBytes / contentLength) * 100 : 0;
          const displayPct = willEncode ? rawPercent * 0.7 : rawPercent;
          setDownloadProgress(displayPct);

          const curMb = (receivedBytes / 1024 / 1024).toFixed(2);
          const totalMb = contentLength > 0 ? (contentLength / 1024 / 1024).toFixed(2) : '?';
          if (downloadSizeStats) downloadSizeStats.textContent = `${curMb} / ${totalMb} MB`;

          const elapsedSec = (Date.now() - startTime) / 1000;
          if (elapsedSec > 0 && downloadSpeedStats) {
            const kbSec = (receivedBytes / 1024 / elapsedSec).toFixed(0);
            downloadSpeedStats.textContent = `${kbSec} KB/s`;
          }
        }

        audioBuffer = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const chunk of chunks) {
          audioBuffer.set(chunk, offset);
          offset += chunk.length;
        }
        break;
      } else {
        // HLS Stream
        const hlsResp = await window.fetchWithRetry(audioCdnUrl);
        if (!hlsResp.ok) continue;
        let m3u8Text = await hlsResp.text();

        let targetPlaylistUrl = audioCdnUrl;
        if (m3u8Text.includes('#EXT-X-STREAM-INF')) {
          const lines = m3u8Text.split('\n');
          for (let li = 0; li < lines.length; li++) {
            if (lines[li].startsWith('#EXT-X-STREAM-INF')) {
              const nextLine = lines[li + 1]?.trim();
              if (nextLine && !nextLine.startsWith('#')) {
                targetPlaylistUrl = new URL(nextLine, audioCdnUrl).href;
                break;
              }
            }
          }
          const varResp = await window.fetchWithRetry(targetPlaylistUrl);
          if (varResp.ok) m3u8Text = await varResp.text();
        }

        const mapMatch = /#EXT-X-MAP:URI="([^"]+)"/i.exec(m3u8Text);
        const initUrl = mapMatch ? new URL(mapMatch[1], targetPlaylistUrl).href : null;

        const segmentUrls = [];
        for (const line of m3u8Text.split('\n')) {
          const tr = line.trim();
          if (tr && !tr.startsWith('#')) {
            segmentUrls.push(new URL(tr, targetPlaylistUrl).href);
          }
        }

        if (segmentUrls.length === 0) continue;

        const totalSegments = segmentUrls.length;
        const segBuffers = new Array(totalSegments);
        let downloadedCount = 0;
        let receivedBytes = 0;
        const startTime = Date.now();

        let initBuf = null;
        if (initUrl) {
          try {
            const initResp = await window.fetchWithRetry(initUrl);
            if (initResp.ok) {
              initBuf = new Uint8Array(await initResp.arrayBuffer());
              receivedBytes += initBuf.length;
            }
          } catch (e) {
            console.warn('HLS init segment fetch error:', e);
          }
        }

        const concurrency = window.APP_CONFIG.HLS_CONCURRENCY || 6;
        let nextIndex = 0;
        let hasError = false;

        async function segmentWorker() {
          while (nextIndex < totalSegments && !window.cancelRequested && !hasError) {
            const sIdx = nextIndex++;
            try {
              const segResp = await window.fetchWithRetry(segmentUrls[sIdx]);
              if (!segResp.ok) throw new Error(`HTTP ${segResp.status}`);
              const segBuf = new Uint8Array(await segResp.arrayBuffer());
              segBuffers[sIdx] = segBuf;
              downloadedCount++;
              receivedBytes += segBuf.length;

              const rawPercent = (downloadedCount / totalSegments) * 100;
              const displayPct = rawPercent * 0.7;
              setDownloadProgress(displayPct);

              const curMb = (receivedBytes / 1024 / 1024).toFixed(2);
              if (downloadSizeStats) downloadSizeStats.textContent = `${curMb} MB`;

              const elapsedSec = (Date.now() - startTime) / 1000;
              if (elapsedSec > 0 && downloadSpeedStats) {
                const kbSec = (receivedBytes / 1024 / elapsedSec).toFixed(0);
                downloadSpeedStats.textContent = `${kbSec} KB/s`;
              }
            } catch (err) {
              console.warn(`Segment ${sIdx} fetch failed:`, err);
              hasError = true;
            }
          }
        }

        const poolWorkers = [];
        const workerCount = Math.min(concurrency, totalSegments);
        for (let w = 0; w < workerCount; w++) {
          poolWorkers.push(segmentWorker());
        }

        await Promise.all(poolWorkers);
        if (window.cancelRequested || hasError || downloadedCount < totalSegments) continue;

        const chunks = [];
        if (initBuf) chunks.push(initBuf);
        for (const b of segBuffers) {
          if (b) chunks.push(b);
        }

        let totalLen = 0;
        for (const c of chunks) totalLen += c.length;
        audioBuffer = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
          audioBuffer.set(chunk, offset);
          offset += chunk.length;
        }
        break;
      }
    }

    if (!audioBuffer) {
      updateQueueItemStatus(index - 1, 'fail');
      return false;
    }

    let artworkBuffer = null;
    let artworkBase64 = null;
    if (hiResArtwork) {
      try {
        const coverResp = await window.fetchWithRetry(hiResArtwork);
        if (coverResp.ok) {
          const cBuf = await coverResp.arrayBuffer();
          artworkBuffer = new Uint8Array(cBuf);
          artworkBase64 = window.bufferToDataUrl(artworkBuffer, 'image/jpeg');
        }
      } catch {}
    }

    let cleanMp3Audio = null;
    const isDirectMp3 =
      audioBuffer.length > 4 &&
      ((audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0) ||
        (audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33));

    if (isDirectMp3) {
      cleanMp3Audio = audioBuffer;
      setDownloadProgress(100);
    } else {
      if (lblCurrentStatus) {
        lblCurrentStatus.textContent = `${window.L.currentStatus || 'Current download:'} ${window.L.encoding || 'Encoding MP3...'}`;
      }
      setDownloadProgress(70);
      if (downloadSpeedStats) downloadSpeedStats.textContent = 'MP3 192k';

      const actx = new (window.AudioContext || window.webkitAudioContext)();
      try {
        const abCopy = audioBuffer.buffer.slice(
          audioBuffer.byteOffset,
          audioBuffer.byteOffset + audioBuffer.byteLength
        );
        const decodedPcm = await actx.decodeAudioData(abCopy);

        // Encode via Web Worker
        cleanMp3Audio = await encodeAudioBufferWithWorker(
          decodedPcm,
          window.APP_CONFIG.DEFAULT_MP3_BITRATE || 192,
          (ratio) => {
            const combinedPct = 70 + ratio * 30;
            setDownloadProgress(combinedPct);
          }
        );
      } finally {
        if (actx && actx.close) actx.close().catch(() => {});
      }
      setDownloadProgress(100);
    }

    if (!cleanMp3Audio) {
      updateQueueItemStatus(index - 1, 'fail');
      return false;
    }

    // Write ID3v2.3 tags
    const extraTags = {
      album: setMeta.title || track.publisher_metadata?.album_title || null,
      trackNumber: `${index}/${total}`,
      year: track.created_at ? new Date(track.created_at).getFullYear() : null,
      genre: track.genre || null,
      comment: track.description || null,
      url: track.permalink_url || null
    };

    const id3Tag = window.createId3v23Tag(title, artist, artworkBuffer, extraTags);
    const combined = new Uint8Array(id3Tag.length + cleanMp3Audio.length);
    combined.set(id3Tag, 0);
    combined.set(cleanMp3Audio, id3Tag.length);

    if (api?.saveTrack) {
      const targetDir = downloadFolder || (await api.getDefaultDownloadsFolder());
      const saveRes = await api.saveTrack({
        folder: targetDir,
        subFolder,
        fileName,
        buffer: combined
      });

      if (saveRes?.success) {
        window.addTrackToPlayer({
          id: saveRes.filePath,
          filePath: saveRes.filePath,
          fileName,
          title,
          artist,
          hasCover: !!artworkBuffer,
          artworkDataUrl: artworkBase64,
          duration: Math.round(track.duration ? track.duration / 1000 : 0)
        });
      }
    }

    setDownloadProgress(100);
    updateQueueItemStatus(index - 1, 'done');
    return true;
  } catch (err) {
    console.error('Download error for track:', err && err.message ? err.message : err, err);
    updateQueueItemStatus(index - 1, 'fail');
    return false;
  }
}

async function startDownloadFlow() {
  const inputUrl = document.getElementById('inputUrl');
  const btnStartDownload = document.getElementById('btnStartDownload');
  const btnStopDownload = document.getElementById('btnStopDownload');
  const currentTrackTitle = document.getElementById('currentTrackTitle');
  const currentTrackArtist = document.getElementById('currentTrackArtist');
  const lblCurrentStatus = document.getElementById('lblCurrentStatus');
  const downloadCounterStats = document.getElementById('downloadCounterStats');

  const rawUrl = inputUrl ? inputUrl.value.trim() : '';
  if (!rawUrl) {
    alert(window.L.emptyUrlError);
    return;
  }

  window.isDownloading = true;
  window.cancelRequested = false;
  if (btnStartDownload) btnStartDownload.disabled = true;
  if (btnStopDownload) btnStopDownload.disabled = false;

  if (typeof window.startQuoteRotation === 'function') {
    window.startQuoteRotation();
  }

  if (currentTrackTitle) currentTrackTitle.textContent = window.L.resolvingUrl;
  if (currentTrackArtist) currentTrackArtist.textContent = 'MAGNItola';

  try {
    const result = await resolveSoundCloudUrl(rawUrl);
    const queue = result ? result.tracks : [];
    const subFolder = result ? result.subFolder : null;

    if (!queue || queue.length === 0) {
      alert(window.L.noTracksFound);
      return;
    }

    downloadQueue = queue;
    queueStatuses = new Array(queue.length).fill('wait');
    renderDownloadQueue();

    const api = window.electronAPI || null;
    const downloadFolder = localStorage.getItem('magnitola_save_folder') || '';
    const targetDir = downloadFolder || (api?.getDefaultDownloadsFolder ? await api.getDefaultDownloadsFolder() : null);

    if (subFolder && api?.ensureFolder && targetDir) {
      await api.ensureFolder({ folder: targetDir, subFolder });
      if (lblCurrentStatus) {
        lblCurrentStatus.textContent = `${window.L.currentStatus || 'Current download:'} [${subFolder}]`;
      }
    }

    const total = queue.length;
    let completed = 0;

    for (let i = 0; i < total; i++) {
      if (window.cancelRequested) break;
      if (downloadCounterStats) {
        downloadCounterStats.textContent = `${window.L.trackPrefix} ${i + 1} ${window.L.fromWord} ${total}`;
      }
      const ok = await downloadTrack(queue[i], i + 1, total, subFolder, { title: result.title });
      if (ok) completed++;
    }

    if (currentTrackTitle) {
      currentTrackTitle.textContent = `${window.L.finished} (${completed}/${total})`;
    }
  } catch (err) {
    console.error(err);
    alert(err.message || window.L.failed);
  } finally {
    window.isDownloading = false;
    if (btnStartDownload) btnStartDownload.disabled = false;
    if (btnStopDownload) btnStopDownload.disabled = true;
    if (lblCurrentStatus) lblCurrentStatus.textContent = window.L.currentStatus;
    if (typeof window.stopQuoteRotation === 'function') window.stopQuoteRotation();
    if (typeof window.checkQuoteVisibility === 'function') window.checkQuoteVisibility();
    if (currentWorker) {
      currentWorker.terminate();
      currentWorker = null;
    }
  }
}

window.resolveSoundCloudUrl = resolveSoundCloudUrl;
window.downloadTrack = downloadTrack;
window.startDownloadFlow = startDownloadFlow;
