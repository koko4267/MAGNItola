const fs = require('node:fs');
const path = require('node:path');

function extractId3Text(headerBuf, frameId) {
  try {
    const idx = headerBuf.indexOf(frameId);
    if (idx === -1 || idx + 10 > headerBuf.length) return null;
    const frameSize = headerBuf.readUInt32BE(idx + 4);
    if (frameSize <= 1 || idx + 10 + frameSize > headerBuf.length) return null;
    const frameData = headerBuf.subarray(idx + 10, idx + 10 + frameSize);
    const encoding = frameData[0];
    if (encoding === 0x01 && frameData.length > 3) {
      let textBytes = frameData.subarray(1);
      if (textBytes.length >= 2 && textBytes[0] === 0xff && textBytes[1] === 0xfe) {
        textBytes = textBytes.subarray(2);
      }
      return Buffer.from(textBytes).toString('utf16le').replace(/\0+$/, '').trim();
    } else if (encoding === 0x00) {
      return Buffer.from(frameData.subarray(1)).toString('latin1').replace(/\0+$/, '').trim();
    } else if (encoding === 0x03) {
      let textBuf = frameData.subarray(1);
      if (textBuf.length >= 3 && textBuf[0] === 0xef && textBuf[1] === 0xbb && textBuf[2] === 0xbf) {
        textBuf = textBuf.subarray(3);
      }
      return Buffer.from(textBuf).toString('utf8').replace(/\0+$/, '').trim();
    }
  } catch {}
  return null;
}

async function collectMediaFiles(dir, supported, currentDepth = 0, maxDepth = 4) {
  if (currentDepth > maxDepth) return [];
  const results = [];
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
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

  let hasCover = false;
  let fd = null;
  try {
    fd = await fs.promises.open(fullPath, 'r');
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    const headerBuf = buffer.subarray(0, bytesRead);

    if (bytesRead > 10 && headerBuf[0] === 0x49 && headerBuf[1] === 0x44 && headerBuf[2] === 0x33) {
      const id3Title = extractId3Text(headerBuf, 'TIT2');
      const id3Artist = extractId3Text(headerBuf, 'TPE1');
      if (id3Title) title = id3Title;
      if (id3Artist) artist = id3Artist;

      if (headerBuf.indexOf('APIC') !== -1) {
        hasCover = true;
      }
    }
  } catch {
  } finally {
    if (fd !== null) {
      try {
        await fd.close();
      } catch {}
    }
  }

  return {
    id: fullPath,
    filePath: fullPath,
    fileName,
    title,
    artist,
    hasCover,
    duration: 0
  };
}

async function scanLibrary(folder) {
  const supported = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus']);
  const files = await collectMediaFiles(folder, supported);
  const tracks = new Array(files.length);
  let next = 0;
  async function worker() {
    const buffer = Buffer.alloc(8192);
    while (next < files.length) {
      const index = next++;
      tracks[index] = await readMetadata(files[index], buffer);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
  return tracks;
}

module.exports = { scanLibrary };
