function encodeAudioBufferWithWorker(audioBuffer, bitrate, onProgress, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker('js/encoder-worker.js');
    function cleanup() {
      signal.removeEventListener('abort', cancel);
      worker.terminate();
    }
    function cancel() {
      cleanup();
      reject(signal.reason);
    }
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        onProgress?.(data.percent);
        return;
      }
      cleanup();
      if (data.type === 'done') resolve(data.buffer);
      else reject(new Error(data.error || 'MP3 encoding failed'));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message));
    };
    try {
      const channels = audioBuffer.numberOfChannels;
      const leftChannel = audioBuffer.getChannelData(0);
      worker.postMessage({
        type: 'encode',
        bitrate,
        channels,
        sampleRate: audioBuffer.sampleRate,
        leftChannel,
        rightChannel: channels > 1 ? audioBuffer.getChannelData(1) : leftChannel
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

const MPEG1_LAYER3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_LAYER3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000];

function readLayer3Frame(audio, offset) {
  if (offset + 4 > audio.length || audio[offset] !== 0xff || (audio[offset + 1] & 0xe6) !== 0xe2) return null;
  const version = (audio[offset + 1] >> 3) & 3;
  if (version === 1 || (audio[offset + 3] & 3) === 2) return null;

  const bitrates = version === 3 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES;
  const bitrate = bitrates[audio[offset + 2] >> 4];
  const sampleRate = MPEG1_SAMPLE_RATES[(audio[offset + 2] >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  if (!bitrate || !sampleRate) return null;

  const padding = (audio[offset + 2] >> 1) & 1;
  const length = Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / sampleRate) + padding;
  if (offset + length > audio.length) return null;
  return { length, version, sampleRate };
}

function getLayer3Audio(audio) {
  let start = 0;
  while (audio[start] === 0x49 && audio[start + 1] === 0x44 && audio[start + 2] === 0x33) {
    if (start + 10 > audio.length) return null;
    const sizeBytes = audio.subarray(start + 6, start + 10);
    if (sizeBytes.some((byte) => byte >= 128)) return null;
    const size = sizeBytes.reduce((total, byte) => total * 128 + byte, 0);
    const footerSize = audio[start + 3] === 4 && audio[start + 5] & 0x10 ? 10 : 0;
    start += 10 + size + footerSize;
  }

  const first = readLayer3Frame(audio, start);
  if (!first) return null;
  const next = start + first.length;
  if (next === audio.length) return audio.subarray(start);
  const second = readLayer3Frame(audio, next);
  if (second?.version === first.version && second.sampleRate === first.sampleRate) return audio.subarray(start);
  return null;
}

function joinAudioChunks(chunks, length) {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function reportAudioProgress(report, bytes, startTime, progress, totalBytes) {
  const receivedMb = (bytes / 1024 / 1024).toFixed(2);
  let size = `${receivedMb} MB`;
  if (totalBytes !== undefined) {
    const totalMb = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(2) : '?';
    size = `${receivedMb} / ${totalMb} MB`;
  }
  const seconds = (Date.now() - startTime) / 1000;
  const speed = seconds > 0 ? `${(bytes / 1024 / seconds).toFixed(0)} KB/s` : undefined;
  report({ progress, size, speed });
}

async function downloadProgressiveAudio(url, request, signal, progressScale, report) {
  const response = await request(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) return null;

  const totalBytes = Number(response.headers.get('Content-Length'));
  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  const startTime = Date.now();

  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      const progress = totalBytes > 0 ? (receivedBytes / totalBytes) * progressScale : 0;
      reportAudioProgress(report, receivedBytes, startTime, progress, totalBytes);
    }
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return joinAudioChunks(chunks, receivedBytes);
}

async function downloadHlsAudio(url, request, signal, report) {
  const response = await request(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  url = response.url || url;
  const playlist = await response.text();
  if (!/^#EXT-X-STREAM-INF:/m.test(playlist)) return downloadHlsMedia(playlist, url, request, signal, report);

  const lines = playlist.split('\n').map((line) => line.trim());
  let lastError;
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const uri = lines[index + 1];
    if (!uri || uri.startsWith('#')) continue;
    signal.throwIfAborted();
    try {
      const variantUrl = new URL(uri, url).href;
      const variant = await request(variantUrl);
      if (!variant.ok) throw new Error(`HTTP ${variant.status}`);
      const audio = await downloadHlsMedia(await variant.text(), variant.url || variantUrl, request, signal, report);
      if (audio?.length) return audio;
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function downloadHlsMedia(playlist, url, request, signal, report) {
  if (/^#EXT-X-STREAM-INF:/m.test(playlist)) return null;
  if (
    /^\s*#EXT-X-BYTERANGE:/m.test(playlist) ||
    /^\s*#EXT-X-MAP:(?:(?:"[^"\r\n]*"|[^",\r\n])*,\s*)*BYTERANGE=/m.test(playlist)
  ) {
    throw new Error('hlsByteRangeUnsupported');
  }
  if (playlist.includes('METHOD=SAMPLE-AES') || playlist.includes('com.apple.streamingkeydelivery')) return null;
  const segmentUrls = playlist
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => new URL(line, url).href);
  if (segmentUrls.length === 0) return null;

  const startTime = Date.now();
  const chunks = new Array(segmentUrls.length);
  const initUri = /#EXT-X-MAP:URI="([^"]+)"/i.exec(playlist)?.[1];
  let initChunk;
  if (initUri) {
    const initResponse = await request(new URL(initUri, url).href);
    if (!initResponse.ok) throw new Error(`HTTP ${initResponse.status}`);
    initChunk = new Uint8Array(await initResponse.arrayBuffer());
  }

  let receivedBytes = initChunk?.length || 0;
  let nextIndex = 0;
  let completed = 0;
  let segmentError;
  async function downloadSegments() {
    while (nextIndex < segmentUrls.length && !signal.aborted && !segmentError) {
      const index = nextIndex++;
      try {
        const segment = await request(segmentUrls[index]);
        if (!segment.ok) throw new Error(`HTTP ${segment.status}`);
        const chunk = new Uint8Array(await segment.arrayBuffer());
        chunks[index] = chunk;
        receivedBytes += chunk.length;
        completed++;
        reportAudioProgress(report, receivedBytes, startTime, (completed / segmentUrls.length) * 70);
      } catch (error) {
        segmentError ??= error;
      }
    }
  }

  const concurrency = window.APP_CONFIG.HLS_CONCURRENCY || 6;
  await Promise.all(Array.from({ length: Math.min(concurrency, segmentUrls.length) }, downloadSegments));
  signal.throwIfAborted();
  if (segmentError) throw segmentError;
  if (initChunk) chunks.unshift(initChunk);
  return joinAudioChunks(chunks, receivedBytes);
}

async function downloadTrack(track, index, total, subFolder, setMeta, downloadFolder, signal, report) {
  const api = window.electronAPI || null;
  const request = (url) => window.fetchWithRetry(url, { signal });

  const title = track.title || window.L?.untitled || 'Untitled';
  const artist = track.user
    ? track.user.username || window.L?.unknownArtist || 'Unknown Artist'
    : window.L?.defaultArtist || 'MAGNItola';
  const artwork = track.artwork_url || (track.user ? track.user.avatar_url : null);
  const fileName = `${window.sanitizeFileName(artist)} - ${window.sanitizeFileName(title)}.mp3`;
  const fileRequest = {
    folder: downloadFolder,
    subFolder,
    fileName,
    soundCloudId: track.id,
    soundCloudUrl: track.permalink_url
  };

  const hiResArtwork = window.getCoverArtUrl(artwork);
  report({ title, artist, artwork: hiResArtwork, progress: 0, size: '', speed: '', stage: 'downloading' });

  signal.throwIfAborted();
  if (!track.id && !track.permalink_url) {
    report({ status: 'fail', reason: window.L.trackIdentityMissing });
    return false;
  }

  function reportExistingFile() {
    report({
      progress: 100,
      stage: 'alreadyExists',
      speed: window.L.skipStatus,
      size: window.L.naSize,
      status: 'skip'
    });
  }

  if (api?.checkFileExists) {
    const check = await api.checkFileExists(fileRequest);
    signal.throwIfAborted();
    if (check?.error) throw new Error(window.L[check.error] || check.error);
    if (check?.exists) {
      reportExistingFile();
      return true;
    }
  }

  report({ status: 'down' });

  try {
    const transcodings = track.media && track.media.transcodings ? track.media.transcodings : [];
    if (transcodings.length === 0) {
      report({ status: 'fail' });
      return false;
    }

    const isDrmProtocol = (protocol) => protocol === 'cbc-encrypted-hls' || protocol === 'ctr-encrypted-hls';

    const playable = transcodings.filter((stream) => !isDrmProtocol(stream.format?.protocol));
    if (playable.length === 0) {
      report({ progress: 0 });
      report({ stage: 'drmProtected', speed: window.L.queueStatusDrm });
      report({ size: window.L.naSize });
      report({ status: 'drm' });
      return false;
    }

    function scoreStream({ format, preset }) {
      let score = 0;
      if (format?.protocol === 'progressive' && format?.mime_type === 'audio/mpeg') score += 500;
      if (preset === 'aac_160k') score += 300;
      if (preset === 'aac_96k') score += 200;
      if (format?.mime_type?.includes('mp4') || format?.mime_type?.includes('aac')) score += 100;
      return score;
    }
    playable.sort((a, b) => scoreStream(b) - scoreStream(a));

    let audioBuffer = null;
    let lastSourceError;

    for (const selected of playable) {
      signal.throwIfAborted();

      try {
        const streamInfoUrl = new URL(selected.url);
        if (track.track_authorization) {
          streamInfoUrl.searchParams.set('track_authorization', track.track_authorization);
        }

        const streamResp = await window.requestSoundCloud(streamInfoUrl, signal);
        if (!streamResp.ok) throw new Error(`HTTP ${streamResp.status}`);

        const streamJson = await streamResp.json();
        const audioCdnUrl = streamJson.url;
        if (!audioCdnUrl) continue;

        const protocol = selected.format?.protocol;
        const isHls = protocol === 'hls' || (protocol !== 'progressive' && audioCdnUrl.includes('.m3u8'));
        if (!isHls) {
          const isMp3 = protocol === 'progressive' && selected.format?.mime_type === 'audio/mpeg';
          audioBuffer = await downloadProgressiveAudio(audioCdnUrl, request, signal, isMp3 ? 100 : 70, report);
        } else {
          audioBuffer = await downloadHlsAudio(audioCdnUrl, request, signal, report);
        }
      } catch (error) {
        signal.throwIfAborted();
        lastSourceError = error;
      }
      if (audioBuffer?.length) break;
    }

    signal.throwIfAborted();
    if (!audioBuffer?.length) {
      report({ status: 'fail', reason: lastSourceError?.message });
      return false;
    }

    let artworkBuffer = null;
    let artworkBase64 = null;
    if (hiResArtwork) {
      try {
        const coverResp = await request(hiResArtwork);
        if (coverResp.ok) {
          const cBuf = await coverResp.arrayBuffer();
          artworkBuffer = new Uint8Array(cBuf);
          artworkBase64 = window.bufferToDataUrl(artworkBuffer, 'image/jpeg');
        }
      } catch {}
    }

    let cleanMp3Audio = getLayer3Audio(audioBuffer);
    if (cleanMp3Audio) {
      report({ progress: 100 });
    } else {
      report({ progress: 70 });
      report({ stage: 'encoding', speed: window.L.encodingMp3Badge });

      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const cancelled = Promise.withResolvers();
      const cancelDecode = () => cancelled.reject(signal.reason);
      try {
        signal.throwIfAborted();
        const input =
          audioBuffer.byteOffset === 0 && audioBuffer.byteLength === audioBuffer.buffer.byteLength
            ? audioBuffer.buffer
            : audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength);
        const decoding = actx.decodeAudioData(input);
        signal.addEventListener('abort', cancelDecode, { once: true });
        const decodedPcm = await Promise.race([decoding, cancelled.promise]);
        // Encode via Web Worker
        cleanMp3Audio = await encodeAudioBufferWithWorker(
          decodedPcm,
          window.APP_CONFIG.DEFAULT_MP3_BITRATE || 192,
          (ratio) => {
            const combinedPct = 70 + ratio * 30;
            report({ progress: combinedPct });
          },
          signal
        );
      } finally {
        signal.removeEventListener('abort', cancelDecode);
        if (actx && actx.close) actx.close().catch(() => {});
      }
      report({ progress: 100 });
    }

    if (!cleanMp3Audio) {
      report({ status: 'fail' });
      return false;
    }

    // Write ID3v2.3 tags
    const extraTags = {
      album: setMeta.title || track.publisher_metadata?.album_title || null,
      trackNumber: `${index}/${total}`,
      year: track.created_at ? new Date(track.created_at).getFullYear() : null,
      genre: track.genre || null,
      comment: track.description || null,
      url: track.permalink_url || null,
      soundCloudId: track.id
    };

    const id3Tag = window.createId3v23Tag(title, artist, artworkBuffer, extraTags);
    const combined = new Uint8Array(id3Tag.length + cleanMp3Audio.length);
    combined.set(id3Tag, 0);
    combined.set(cleanMp3Audio, id3Tag.length);

    signal.throwIfAborted();
    const saveRes = await api?.saveTrack?.({ ...fileRequest, buffer: combined });

    if (!saveRes?.success) throw new Error(window.L[saveRes?.error] || saveRes?.error || window.L.saveFailed);
    if (saveRes.exists) {
      reportExistingFile();
      return true;
    }
    window.addTrackToPlayer(
      {
        id: saveRes.filePath,
        filePath: saveRes.filePath,
        fileName: saveRes.fileName || fileName,
        title,
        artist,
        hasCover: !!artworkBuffer,
        artworkDataUrl: artworkBase64,
        duration: Math.round(track.duration ? track.duration / 1000 : 0)
      },
      downloadFolder
    );

    report({ progress: 100 });
    report({ status: 'done' });
    return true;
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    console.error('Download error for track:', err && err.message ? err.message : err, err);
    report({ status: 'fail', reason: err.message });
    return false;
  }
}

window.downloadTrack = downloadTrack;
