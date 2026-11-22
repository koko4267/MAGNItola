const fs = require('node:fs/promises');
const path = require('node:path');

const ID3_HEADER_SIZE = 10;
const ID3_PREFIX_BYTES = 8192;
const MAX_ID3_FRAMES = 256;
const MAX_TEXT_BYTES = 8192;
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const metadataFrames = new Map([
  ['TIT2', MAX_TEXT_BYTES],
  ['TPE1', MAX_TEXT_BYTES],
  ['APIC', 0]
]);
const coverFrames = new Map([['APIC', MAX_COVER_BYTES]]);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readSynchsafeSize(bytes) {
  if (bytes.some((byte) => byte >= 128)) return -1;
  return bytes.reduce((size, byte) => size * 128 + byte, 0);
}

async function readId3Frames(filePath, limits, buffer = Buffer.alloc(ID3_PREFIX_BYTES)) {
  const frames = new Map();
  try {
    const file = await fs.open(filePath, 'r');
    try {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const prefix = buffer.subarray(0, bytesRead);
      const header = prefix.subarray(0, ID3_HEADER_SIZE);
      const version = header[3];
      const flags = header[5];
      if (
        header.length !== ID3_HEADER_SIZE ||
        header.toString('latin1', 0, 3) !== 'ID3' ||
        (version !== 3 && version !== 4) ||
        flags & 0x80
      ) {
        return frames;
      }

      const size = readSynchsafeSize(header.subarray(6));
      const end = ID3_HEADER_SIZE + size;
      if (size <= 0 || (end > prefix.length && end > (await file.stat()).size)) return frames;

      async function readBytes(offset, length) {
        if (offset + length <= prefix.length) return prefix.subarray(offset, offset + length);
        const data = Buffer.alloc(length);
        const { bytesRead } = await file.read(data, 0, length, offset);
        return bytesRead === length ? data : null;
      }

      let offset = ID3_HEADER_SIZE;
      if (flags & 0x40) {
        if (offset + 4 > end) return frames;
        const sizeField = await readBytes(offset, 4);
        if (!sizeField) return frames;
        const extendedSize = version === 3 ? sizeField.readUInt32BE(0) + 4 : readSynchsafeSize(sizeField);
        if (extendedSize < (version === 3 ? 10 : 6)) return frames;
        offset += extendedSize;
      }

      for (let count = 0; count < MAX_ID3_FRAMES && offset + ID3_HEADER_SIZE <= end; count++) {
        const frameHeader = await readBytes(offset, ID3_HEADER_SIZE);
        if (!frameHeader) break;
        const id = frameHeader.toString('latin1', 0, 4);
        const length = version === 3 ? frameHeader.readUInt32BE(4) : readSynchsafeSize(frameHeader.subarray(4, 8));
        offset += ID3_HEADER_SIZE;
        if (!/^[A-Z0-9]{4}$/.test(id) || length <= 0 || offset + length > end) break;

        const limit = limits.get(id);
        if (limit !== undefined && frameHeader[9] === 0 && !frames.has(id)) {
          if (limit === 0) {
            // The library only needs to know whether the frame is present.
            frames.set(id, true);
          } else if (length <= limit) {
            const data = await readBytes(offset, length);
            if (!data) break;
            frames.set(id, data);
          }
          if (frames.size === limits.size) break;
        }
        offset += length;
      }
    } finally {
      await file.close();
    }
  } catch {
    // Files can disappear or become unavailable between enumeration and reading.
  }
  return frames;
}

function decodeId3Text(frame) {
  if (!frame) return '';
  const encoding = frame[0];
  let text;
  if (encoding === 0) text = frame.toString('latin1', 1);
  else if (encoding === 1)
    text = new TextDecoder(frame[1] === 0xfe ? 'utf-16be' : 'utf-16le').decode(frame.subarray(1));
  else if (encoding === 2) text = new TextDecoder('utf-16be').decode(frame.subarray(1));
  else if (encoding === 3) text = new TextDecoder().decode(frame.subarray(1));
  return text?.replace(/\0+$/, '').trim() || '';
}

async function readTrackCover(filePath) {
  const frame = (await readId3Frames(filePath, coverFrames)).get('APIC');
  if (!frame) return null;
  const mimeEnd = frame.indexOf(0, 1);
  const descriptionStart = mimeEnd + 2;
  if (mimeEnd === -1 || descriptionStart >= frame.length || frame[0] > 3) return null;

  const terminatorSize = frame[0] === 1 || frame[0] === 2 ? 2 : 1;
  let offset = descriptionStart;
  while (offset + terminatorSize <= frame.length) {
    if (frame[offset] === 0 && (terminatorSize === 1 || frame[offset + 1] === 0)) break;
    offset += terminatorSize;
  }
  const image = frame.subarray(offset + terminatorSize);
  if (image.subarray(0, pngSignature.length).equals(pngSignature)) {
    return 'data:image/png;base64,' + image.toString('base64');
  }
  if (image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) {
    return 'data:image/jpeg;base64,' + image.toString('base64');
  }
  return null;
}

async function collectMediaFiles(dir, supported, currentDepth = 0, maxDepth = 4) {
  if (currentDepth > maxDepth) return [];
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (supported.has(ext)) {
          results.push(path.join(dir, entry.name));
        }
      } else if (entry.isDirectory()) {
        const dirName = entry.name.toLowerCase();
        if (
          dirName.startsWith('.') ||
          dirName === 'node_modules' ||
          dirName === 'appdata' ||
          dirName === '$recycle.bin'
        ) {
          continue;
        }
        const subFiles = await collectMediaFiles(path.join(dir, entry.name), supported, currentDepth + 1, maxDepth);
        results.push(...subFiles);
      }
    }
  } catch {}
  return results;
}

async function readMetadata(fullPath, buffer) {
  const fileName = path.basename(fullPath);
  const baseName = path.parse(fileName).name;
  let artist = 'MAGNItola';
  let title = baseName;

  if (baseName.includes(' - ')) {
    const parts = baseName.split(' - ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  }

  const frames = await readId3Frames(fullPath, metadataFrames, buffer);
  title = decodeId3Text(frames.get('TIT2')) || title;
  artist = decodeId3Text(frames.get('TPE1')) || artist;

  return {
    id: fullPath,
    filePath: fullPath,
    fileName,
    title,
    artist,
    hasCover: frames.has('APIC'),
    duration: 0
  };
}

async function scanLibrary(folder) {
  const supported = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus']);
  const files = await collectMediaFiles(folder, supported);
  const tracks = new Array(files.length);
  let next = 0;
  async function worker() {
    const buffer = Buffer.alloc(ID3_PREFIX_BYTES);
    while (next < files.length) {
      const index = next++;
      tracks[index] = await readMetadata(files[index], buffer);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
  return tracks;
}

module.exports = { scanLibrary, readTrackCover };
