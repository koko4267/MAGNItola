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

async function downloadTrack(track, index, total, subFolder, setMeta, downloadFolder, signal, report) {
  const api = window.electronAPI || null;
  const request = (url) => window.fetchWithRetry(url, { signal });
  let clientId = await window.getActiveClientId(false, signal);

  const title = track.title || window.L?.untitled || 'Untitled';
  const artist = track.user
    ? track.user.username || window.L?.unknownArtist || 'Unknown Artist'
    : window.L?.defaultArtist || 'MAGNItola';
  const artwork = track.artwork_url || (track.user ? track.user.avatar_url : null);
  const fileName = `${window.sanitizeFileName(artist)} - ${window.sanitizeFileName(title)}.mp3`;

  const hiResArtwork = window.getCoverArtUrl(artwork);
  report({ title, artist, artwork: hiResArtwork, progress: 0, size: '', speed: '', stage: 'downloading' });

  signal.throwIfAborted();

  // Check if file exists on disk
  if (api?.checkFileExists) {
    const check = await api.checkFileExists({ folder: downloadFolder, subFolder, fileName });
    if (check?.exists) {
      report({ progress: 100 });
      report({ stage: 'alreadyExists', speed: window.L.skipStatus });
      report({ size: window.L.naSize });
      report({ status: 'skip' });
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

    const hasUnencrypted = transcodings.some((t) => !isDrmProtocol(t.format?.protocol));
    if (!hasUnencrypted) {
      report({ progress: 0 });
      report({ stage: 'drmProtected', speed: window.L.queueStatusDrm });
      report({ size: window.L.naSize });
      report({ status: 'drm' });
      return false;
    }

    const sorted = [...transcodings].sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;
      const isDrmA = isDrmProtocol(a.format?.protocol);
      const isDrmB = isDrmProtocol(b.format?.protocol);
      if (!isDrmA) scoreA += 10000;
      if (!isDrmB) scoreB += 10000;

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
      if (signal.aborted) {
        report({ status: 'wait' });
        return false;
      }

      let streamInfoUrl = `${selected.url}?client_id=${clientId}`;
      if (track.track_authorization) {
        streamInfoUrl += `&track_authorization=${encodeURIComponent(track.track_authorization)}`;
      }

      let streamResp = await request(streamInfoUrl);
      if (streamResp.status === 401) {
        clientId = await window.getActiveClientId(true, signal);
        streamInfoUrl = `${selected.url}?client_id=${clientId}`;
        if (track.track_authorization) {
          streamInfoUrl += `&track_authorization=${encodeURIComponent(track.track_authorization)}`;
        }
        streamResp = await request(streamInfoUrl);
      }
      if (!streamResp.ok) continue;

      const streamJson = await streamResp.json();
      const audioCdnUrl = streamJson.url;
      if (!audioCdnUrl) continue;

      if (selected.format?.protocol === 'progressive' || !audioCdnUrl.includes('.m3u8')) {
        const audioResp = await request(audioCdnUrl);
        if (!audioResp.ok) continue;

        const contentLength = +audioResp.headers.get('Content-Length') || 0;
        const reader = audioResp.body.getReader();
        let receivedBytes = 0;
        const chunks = [];
        const startTime = Date.now();

        while (true) {
          if (signal.aborted) {
            await reader.cancel();
            report({ status: 'wait' });
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
          report({ progress: displayPct });

          const curMb = (receivedBytes / 1024 / 1024).toFixed(2);
          const totalMb = contentLength > 0 ? (contentLength / 1024 / 1024).toFixed(2) : '?';
          report({ size: `${curMb} / ${totalMb} MB` });

          const elapsedSec = (Date.now() - startTime) / 1000;
          if (elapsedSec > 0) {
            const kbSec = (receivedBytes / 1024 / elapsedSec).toFixed(0);
            report({ speed: `${kbSec} KB/s` });
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
        const hlsResp = await request(audioCdnUrl);
        if (!hlsResp.ok) continue;
        let m3u8Text = await hlsResp.text();

        // Skip DRM-encrypted HLS streams
        if (m3u8Text.includes('METHOD=SAMPLE-AES') || m3u8Text.includes('com.apple.streamingkeydelivery')) {
          continue;
        }

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
          const varResp = await request(targetPlaylistUrl);
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
            const initResp = await request(initUrl);
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
          while (nextIndex < totalSegments && !signal.aborted && !hasError) {
            const sIdx = nextIndex++;
            try {
              const segResp = await request(segmentUrls[sIdx]);
              if (!segResp.ok) throw new Error(`HTTP ${segResp.status}`);
              const segBuf = new Uint8Array(await segResp.arrayBuffer());
              segBuffers[sIdx] = segBuf;
              downloadedCount++;
              receivedBytes += segBuf.length;

              const rawPercent = (downloadedCount / totalSegments) * 100;
              const displayPct = rawPercent * 0.7;
              report({ progress: displayPct });

              const curMb = (receivedBytes / 1024 / 1024).toFixed(2);
              report({ size: `${curMb} MB` });

              const elapsedSec = (Date.now() - startTime) / 1000;
              if (elapsedSec > 0) {
                const kbSec = (receivedBytes / 1024 / elapsedSec).toFixed(0);
                report({ speed: `${kbSec} KB/s` });
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
        if (signal.aborted || hasError || downloadedCount < totalSegments) continue;

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

    signal.throwIfAborted();
    if (!audioBuffer) {
      const isAllDrm = transcodings.every((t) => isDrmProtocol(t.format?.protocol));
      report({ status: isAllDrm ? 'drm' : 'fail' });
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

    let cleanMp3Audio = null;
    const isDirectMp3 =
      audioBuffer.length > 4 &&
      ((audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0) ||
        (audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33));

    if (isDirectMp3) {
      cleanMp3Audio = audioBuffer;
      report({ progress: 100 });
    } else {
      report({ progress: 70 });
      report({ stage: 'encoding', speed: window.L.encodingMp3Badge });

      const actx = new (window.AudioContext || window.webkitAudioContext)();
      try {
        const abCopy = audioBuffer.buffer.slice(
          audioBuffer.byteOffset,
          audioBuffer.byteOffset + audioBuffer.byteLength
        );
        const decodedPcm = await actx.decodeAudioData(abCopy);

        if (signal.aborted) {
          report({ status: 'wait' });
          return false;
        }

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
      url: track.permalink_url || null
    };

    const id3Tag = window.createId3v23Tag(title, artist, artworkBuffer, extraTags);
    const combined = new Uint8Array(id3Tag.length + cleanMp3Audio.length);
    combined.set(id3Tag, 0);
    combined.set(cleanMp3Audio, id3Tag.length);

    signal.throwIfAborted();
    const saveRes = await api?.saveTrack?.({
      folder: downloadFolder,
      subFolder,
      fileName,
      buffer: combined
    });

    if (!saveRes?.success) throw new Error(saveRes?.error || window.L.saveFailed);
    window.addTrackToPlayer(
      {
        id: saveRes.filePath,
        filePath: saveRes.filePath,
        fileName,
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
