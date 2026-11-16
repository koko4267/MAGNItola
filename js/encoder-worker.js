// MP3 encoding worker (libmp3lame)
/* global lamejs */

importScripts('../lame.min.js');

let isCancelled = false;

self.onmessage = function (e) {
  const data = e.data;

  if (data.type === 'cancel') {
    isCancelled = true;
    return;
  }

  if (data.type === 'encode') {
    isCancelled = false;
    try {
      const { leftChannel, rightChannel, channels, sampleRate, bitrate } = data;

      if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
        throw new Error('libmp3lame not available in Web Worker');
      }

      const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitrate || 192);
      const numSamples = leftChannel.length;
      const sampleBlockSize = 1152;
      const mp3Chunks = [];
      let lastProgressReport = Date.now();

      for (let i = 0; i < numSamples; i += sampleBlockSize) {
        if (isCancelled) {
          self.postMessage({ type: 'cancelled' });
          return;
        }

        const blockSize = Math.min(sampleBlockSize, numSamples - i);
        const leftChunk = new Int16Array(blockSize);
        const rightChunk = channels > 1 ? new Int16Array(blockSize) : leftChunk;

        for (let j = 0; j < blockSize; j++) {
          let sL = Math.max(-1, Math.min(1, leftChannel[i + j]));
          leftChunk[j] = sL < 0 ? sL * 0x8000 : sL * 0x7fff;
          if (channels > 1) {
            let sR = Math.max(-1, Math.min(1, rightChannel[i + j]));
            rightChunk[j] = sR < 0 ? sR * 0x8000 : sR * 0x7fff;
          }
        }

        const mp3buf =
          channels === 1 ? mp3encoder.encodeBuffer(leftChunk) : mp3encoder.encodeBuffer(leftChunk, rightChunk);

        if (mp3buf && mp3buf.length > 0) {
          mp3Chunks.push(new Uint8Array(mp3buf));
        }

        if (Date.now() - lastProgressReport > 50) {
          self.postMessage({
            type: 'progress',
            percent: i / numSamples
          });
          lastProgressReport = Date.now();
        }
      }

      const finalChunk = mp3encoder.flush();
      if (finalChunk && finalChunk.length > 0) {
        mp3Chunks.push(new Uint8Array(finalChunk));
      }

      let totalLen = 0;
      for (const c of mp3Chunks) totalLen += c.length;
      const result = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of mp3Chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      self.postMessage({ type: 'progress', percent: 1.0 });
      self.postMessage(
        {
          type: 'done',
          buffer: result
        },
        [result.buffer]
      );
    } catch (err) {
      self.postMessage({
        type: 'error',
        error: err && err.message ? err.message : String(err)
      });
    }
  }
};
