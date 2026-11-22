// ID3v2.3 tag writer
// Header size is syncsafe; frame sizes are UInt32BE.

function createId3v23Tag(title, artist, artworkBuffer, extra = {}) {
  function packFrame(frameId, body) {
    if (!body || body.length === 0) return null;
    const frame = new Uint8Array(10 + body.length);
    for (let i = 0; i < 4; i++) frame[i] = frameId.charCodeAt(i);

    const sz = body.length;
    frame[4] = (sz >> 24) & 0xff;
    frame[5] = (sz >> 16) & 0xff;
    frame[6] = (sz >> 8) & 0xff;
    frame[7] = sz & 0xff;
    frame.set(body, 10);
    return frame;
  }

  function makeTextFrame(frameId, text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.trim();
    if (!clean) return null;

    const bytes = [0x01, 0xff, 0xfe];
    for (let i = 0; i < clean.length; i++) {
      const code = clean.charCodeAt(i);
      bytes.push(code & 0xff, (code >> 8) & 0xff);
    }
    return packFrame(frameId, new Uint8Array(bytes));
  }

  function makeCommentFrame(commentText) {
    if (!commentText || typeof commentText !== 'string') return null;
    const clean = commentText.slice(0, 255).trim();
    if (!clean) return null;

    const bytes = [0x01, 0x65, 0x6e, 0x67, 0xff, 0xfe, 0x00, 0x00, 0xff, 0xfe];
    for (let i = 0; i < clean.length; i++) {
      const code = clean.charCodeAt(i);
      bytes.push(code & 0xff, (code >> 8) & 0xff);
    }
    return packFrame('COMM', new Uint8Array(bytes));
  }

  function makeUrlFrame(frameId, url) {
    if (!url || typeof url !== 'string' || frameId !== 'WXXX') return null;
    const cleanUrl = url.trim();
    if (!cleanUrl) return null;

    const bytes = [0x00, 0x00];
    for (let i = 0; i < cleanUrl.length; i++) {
      bytes.push(cleanUrl.charCodeAt(i) & 0x7f);
    }
    return packFrame('WXXX', new Uint8Array(bytes));
  }

  function makeApicFrame(imgBytes) {
    if (!imgBytes || imgBytes.length === 0) return null;
    const mime = 'image/jpeg\0';
    const body = new Uint8Array(1 + mime.length + 2 + imgBytes.length);
    let p = 0;
    body[p++] = 0x00;
    for (let i = 0; i < mime.length; i++) body[p++] = mime.charCodeAt(i);
    body[p++] = 0x03;
    body[p++] = 0x00;
    body.set(imgBytes, p);
    return packFrame('APIC', body);
  }

  const frames = [];

  const tit2 = makeTextFrame('TIT2', title);
  const tpe1 = makeTextFrame('TPE1', artist);
  if (tit2) frames.push(tit2);
  if (tpe1) frames.push(tpe1);

  if (extra.album) {
    const talb = makeTextFrame('TALB', String(extra.album));
    if (talb) frames.push(talb);
  }
  if (extra.trackNumber) {
    const trck = makeTextFrame('TRCK', String(extra.trackNumber));
    if (trck) frames.push(trck);
  }
  if (extra.year) {
    const tyer = makeTextFrame('TYER', String(extra.year));
    if (tyer) frames.push(tyer);
  }
  if (extra.soundCloudId && /^\d+$/.test(String(extra.soundCloudId))) {
    const identity = new TextEncoder().encode(`\0SoundCloud Track ID\0${extra.soundCloudId}`);
    frames.push(packFrame('TXXX', identity));
  }
  if (extra.genre) {
    const tcon = makeTextFrame('TCON', String(extra.genre));
    if (tcon) frames.push(tcon);
  }
  if (extra.comment) {
    const comm = makeCommentFrame(extra.comment);
    if (comm) frames.push(comm);
  }
  if (extra.url) {
    const wxxx = makeUrlFrame('WXXX', extra.url);
    if (wxxx) frames.push(wxxx);
  }
  if (artworkBuffer) {
    const apic = makeApicFrame(artworkBuffer);
    if (apic) frames.push(apic);
  }

  const totalFramesSize = frames.reduce((acc, f) => acc + f.length, 0);

  const header = new Uint8Array(10);
  header[0] = 0x49; // 'I'
  header[1] = 0x44; // 'D'
  header[2] = 0x33; // '3'
  header[3] = 0x03; // v2.3
  header[4] = 0x00;
  header[5] = 0x00;

  // Syncsafe tag size
  header[6] = (totalFramesSize >> 21) & 0x7f;
  header[7] = (totalFramesSize >> 14) & 0x7f;
  header[8] = (totalFramesSize >> 7) & 0x7f;
  header[9] = totalFramesSize & 0x7f;

  const tag = new Uint8Array(10 + totalFramesSize);
  tag.set(header, 0);
  let offset = 10;
  for (const f of frames) {
    tag.set(f, offset);
    offset += f.length;
  }
  return tag;
}

window.createId3v23Tag = createId3v23Tag;
