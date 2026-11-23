const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const directoryWrites = new Map();

function normalizeSoundCloudUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/+$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || host !== 'soundcloud.com' || !pathname) return null;
    return `https://${host}${pathname}`;
  } catch {
    return null;
  }
}

function getTrackRequest(payload) {
  const fileName = payload.fileName;
  if (
    typeof fileName !== 'string' ||
    /[<>:"/\\|?*]/.test(fileName) ||
    Array.from(fileName).some((character) => character.charCodeAt(0) < 32) ||
    path.extname(fileName) !== '.mp3'
  ) {
    throw new Error('Invalid MP3 file name');
  }

  const id = /^\d{1,32}$/.test(String(payload.soundCloudId)) ? String(payload.soundCloudId) : null;
  const url = normalizeSoundCloudUrl(payload.soundCloudUrl);
  if (!id && !url) throw new Error('trackIdentityMissing');
  const suffix = id || createHash('sha256').update(url).digest('hex').slice(0, 20);
  return { stem: path.basename(fileName, '.mp3'), id, url, suffix };
}

async function matchesTrack(filePath, fileSize, track) {
  const file = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(10);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    // Both the original WXXX tag and the new TXXX tag are written in ID3v2.3.
    if (bytesRead !== header.length || header.toString('ascii', 0, 3) !== 'ID3' || header[3] !== 3 || header[5]) {
      return false;
    }
    const size = header.subarray(6);
    if (size.some((byte) => byte >= 128)) return false;
    const end = 10 + size.reduce((total, byte) => total * 128 + byte, 0);
    if (end > fileSize) return false;

    let urlMatches = false;
    let offset = 10;
    for (let frame = 0; frame < 256 && offset + 10 <= end; frame++) {
      const read = await file.read(header, 0, header.length, offset);
      if (read.bytesRead !== header.length || header[0] === 0) break;
      const type = header.toString('ascii', 0, 4);
      const length = header.readUInt32BE(4);
      offset += 10;
      if (!length || offset + length > end) break;
      if ((type === 'TXXX' || type === 'WXXX') && length <= 4096 && header[9] === 0) {
        const data = Buffer.alloc(length);
        const result = await file.read(data, 0, length, offset);
        if (result.bytesRead !== length) break;
        const separator = data.indexOf(0, 1);
        if (data[0] === 0 && separator !== -1) {
          const description = data.toString('latin1', 1, separator);
          const value = data.toString('latin1', separator + 1).replace(/\0+$/, '');
          if (type === 'TXXX' && description === 'SoundCloud Track ID' && track.id) return value === track.id;
          if (type === 'WXXX' && !description && track.url === normalizeSoundCloudUrl(value)) {
            urlMatches = Boolean(track.url);
          }
        }
      }
      offset += length;
    }
    return urlMatches;
  } finally {
    await file.close();
  }
}

function trimStem(stem, maxLength) {
  const truncated = stem.slice(0, maxLength).replace(/[\uD800-\uDBFF]$/, '');
  return truncated.trimEnd();
}

async function inspectTarget(directory, fileName, track) {
  const filePath = path.join(directory, fileName);
  try {
    const stat = await fs.lstat(filePath);
    const exists = stat.isFile() && (await matchesTrack(filePath, stat.size, track));
    return { exists, occupied: true, filePath, fileName };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { exists: false, occupied: false, filePath, fileName };
  }
}

async function findTrackTarget(directory, track) {
  const base = await inspectTarget(directory, `${trimStem(track.stem, 251)}.mp3`, track);
  if (base.exists) return base;

  const marker = ` [${track.suffix}]`;
  const stem = trimStem(track.stem, 251 - marker.length - 12) + marker;
  const prefix = stem.toLowerCase();
  const entries = await fs.readdir(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return [];
  });
  const occupied = new Set();
  for (const entry of entries) {
    const name = entry.toLowerCase();
    if (!name.startsWith(prefix)) continue;
    const ending = /^(?: \(([2-9]|[1-9]\d{1,9})\))?\.mp3$/.exec(name.slice(prefix.length));
    if (!ending) continue;
    const number = Number(ending[1] || 1);
    occupied.add(number);
    const candidate = await inspectTarget(directory, entry, track);
    if (candidate.exists) return candidate;
  }

  if (!base.occupied) return base;
  let number = 1;
  while (occupied.has(number)) number++;
  const fileName = `${stem}${number === 1 ? '' : ` (${number})`}.mp3`;
  return { exists: false, filePath: path.join(directory, fileName), fileName };
}

async function checkTrackFile(directory, payload) {
  const { exists, filePath, fileName } = await findTrackTarget(directory, getTrackRequest(payload));
  return { exists, filePath, fileName };
}

async function saveTrackFile(directory, payload) {
  const track = getTrackRequest(payload);
  if (!(payload.buffer instanceof Uint8Array)) throw new Error('Invalid MP3 data');
  await fs.mkdir(directory, { recursive: true });
  const realDirectory = await fs.realpath(directory);
  const key = process.platform === 'win32' ? realDirectory.toLowerCase() : realDirectory;
  const previous = directoryWrites.get(key);
  const write = (async () => {
    await previous?.catch(() => {});
    let target = await findTrackTarget(directory, track);
    if (!target.exists) {
      const temporaryPath = path.join(directory, randomUUID() + '.part');
      try {
        await fs.writeFile(temporaryPath, payload.buffer, { flag: 'wx' });
        // Saves in this directory are serialized. Look up another name if this one became occupied.
        const current = await inspectTarget(directory, target.fileName, track);
        if (current.occupied) target = current.exists ? current : await findTrackTarget(directory, track);
        if (!target.exists) await fs.rename(temporaryPath, target.filePath);
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
      }
    }
    const { exists, filePath, fileName } = target;
    return { success: true, exists, filePath, fileName };
  })();
  directoryWrites.set(key, write);
  try {
    return await write;
  } finally {
    if (directoryWrites.get(key) === write) directoryWrites.delete(key);
  }
}

module.exports = { checkTrackFile, saveTrackFile };
