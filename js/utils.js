// Utility functions

function sanitizeFileName(name) {
  return (name || 'Track')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .trim()
    .replace(/\.+$/, '');
}

function sanitizeFolderName(name) {
  if (!name || typeof name !== 'string') return '';
  let clean = name
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .trim()
    .replace(/\.+$/, '');
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reserved.test(clean)) clean += '_';
  return clean;
}

function getCoverArtUrl(url) {
  return url ? url.replace('-large', '-t500x500') : null;
}

function bufferToDataUrl(buf, mimeType = 'image/jpeg') {
  let binary = '';
  const len = buf.byteLength;
  const chunkSize = 0x4000;
  for (let i = 0; i < len; i += chunkSize) {
    const sub = buf.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, sub);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Fetch with exponential backoff and jitter
async function fetchWithRetry(
  url,
  options = {},
  retries = window.APP_CONFIG?.MAX_FETCH_RETRIES || 3,
  baseDelayMs = window.APP_CONFIG?.RETRY_BASE_DELAY_MS || 800
) {
  let lastError = null;
  const maxJitter = window.APP_CONFIG?.RETRY_JITTER_MS || 200;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, options);
      if (resp.ok) return resp;
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt < retries) {
          const jitter = Math.floor(Math.random() * maxJitter);
          const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      return resp;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const jitter = Math.floor(Math.random() * maxJitter);
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error(`Fetch failed after ${retries} attempts: ${url}`);
}

window.sanitizeFileName = sanitizeFileName;
window.sanitizeFolderName = sanitizeFolderName;
window.getCoverArtUrl = getCoverArtUrl;
window.bufferToDataUrl = bufferToDataUrl;
window.formatTime = formatTime;
window.fetchWithRetry = fetchWithRetry;
