// ID3v2.3 tag writer
// Tag header size is syncsafe; frame sizes are UInt32BE.

function createId3v23Tag(title, artist, artworkBuffer, extra = {}) {
  function makeTextFrame(frameId, text) {
    if (!text || typeof text !== 'string') return null;
    const cleanText = text.trim();
    if (!cleanText) return null;

    // UTF-16 LE with BOM (0x01 = Unicode, 0xFF, 0xFE = BOM)
    const bytes = [0x01, 0xff, 0xfe];
    for (let i = 0; i < cleanText.length; i++) {
      const code = cleanText.charCodeAt(i);
      bytes.push(code & 0xff, (code >> 8) & 0xff);
    }

    const body = new Uint8Array(bytes);
    const frame = new Uint8Array(10 + body.length);
    for (let i = 0; i < 4; i++) frame[i] = frameId.charCodeAt(i);

    // ID3v2.3 frame size is standard UInt32BE (not syncsafe)
    const sz = body.length;
    frame[4] = (sz >> 24) & 0xff;
    frame[5] = (sz >> 16) & 0xff;
    frame[6] = (sz >> 8) & 0xff;
    frame[7] = sz & 0xff;
    frame[8] = 0x00;
    frame[9] = 0x00;
    frame.set(body, 10);
    return frame;
  }

  function makeCommentFrame(commentText) {
    if (!commentText || typeof commentText !== 'string') return null;
    const clean = commentText.slice(0, 255).trim();
    if (!clean) return null;

    // Encoding: 0x01 (UTF-16LE), Lang: 'eng', Description: BOM + null, Text: BOM + chars
    const bytes = [
      0x01, // UTF-16LE
      0x65,
      0x6e,
      0x67, // 'eng'
      0xff,
      0xfe,
      0x00,
      0x00, // Empty description in UTF-16 with BOM + terminator
      0xff,
      0xfe // BOM for comment text
    ];

    for (let i = 0; i < clean.length; i++) {
      const code = clean.charCodeAt(i);
      bytes.push(code & 0xff, (code >> 8) & 0xff);
    }

    const body = new Uint8Array(bytes);
    const frame = new Uint8Array(10 + body.length);
    for (let i = 0; i < 4; i++) frame[i] = 'COMM'.charCodeAt(i);

    // ID3v2.3 frame size is standard UInt32BE
    const sz = body.length;
    frame[4] = (sz >> 24) & 0xff;
    frame[5] = (sz >> 16) & 0xff;
    frame[6] = (sz >> 8) & 0xff;
    frame[7] = sz & 0xff;
    frame[8] = 0x00;
    frame[9] = 0x00;
    frame.set(body, 10);
    return frame;
  }

  function makeUrlFrame(frameId, url) {
    if (!url || typeof url !== 'string') return null;
    const cleanUrl = url.trim();
    if (!cleanUrl) return null;

    if (frameId === 'WXXX') {
      // User defined URL: encoding (0x00), description ('\0'), URL ASCII
      const bytes = [0x00, 0x00]; // ISO-8859-1, empty description null-terminated
      for (let i = 0; i < cleanUrl.length; i++) {
        bytes.push(cleanUrl.charCodeAt(i) & 0x7f);
      }
      const body = new Uint8Array(bytes);
      const frame = new Uint8Array(10 + body.length);
      for (let i = 0; i < 4; i++) frame[i] = 'WXXX'.charCodeAt(i);

      // ID3v2.3 frame size is standard UInt32BE
      const sz = body.length;
      frame[4] = (sz >> 24) & 0xff;
      frame[5] = (sz >> 16) & 0xff;
      frame[6] = (sz >> 8) & 0xff;
      frame[7] = sz & 0xff;
      frame[8] = 0x00;
      frame[9] = 0x00;
      frame.set(body, 10);
      return frame;
    }
    return null;
  }

  function makeApicFrame(imgBytes) {
    if (!imgBytes || imgBytes.length === 0) return null;
    const mime = 'image/jpeg\0';
    const mimeBytes = [];
    for (let i = 0; i < mime.length; i++) mimeBytes.push(mime.charCodeAt(i));

    const bodyLen = 1 + mimeBytes.length + 1 + 1 + imgBytes.length;
    const body = new Uint8Array(bodyLen);
    let p = 0;
    body[p++] = 0x00; // ISO-8859-1
    for (const b of mimeBytes) body[p++] = b;
    body[p++] = 0x03; // Front cover
    body[p++] = 0x00; // Empty description
    body.set(imgBytes, p);

    const frame = new Uint8Array(10 + bodyLen);
    for (let i = 0; i < 4; i++) frame[i] = 'APIC'.charCodeAt(i);

    // ID3v2.3 frame size is standard UInt32BE
    frame[4] = (bodyLen >> 24) & 0xff;
    frame[5] = (bodyLen >> 16) & 0xff;
    frame[6] = (bodyLen >> 8) & 0xff;
    frame[7] = bodyLen & 0xff;
    frame[8] = 0x00;
    frame[9] = 0x00;
    frame.set(body, 10);
    return frame;
  }

  const frames = [];

  // Mandatory title (TIT2) and artist (TPE1)
  const tit2 = makeTextFrame('TIT2', title);
  const tpe1 = makeTextFrame('TPE1', artist);
  if (tit2) frames.push(tit2);
  if (tpe1) frames.push(tpe1);

  // Extended tags
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

  // Tag Header: ID3v2.3 (10 bytes)
  const header = new Uint8Array(10);
  header[0] = 0x49; // 'I'
  header[1] = 0x44; // 'D'
  header[2] = 0x33; // '3'
  header[3] = 0x03; // Version 2.3
  header[4] = 0x00; // Revision 0
  header[5] = 0x00; // Flags

  // ID3 Tag size: strictly syncsafe integer (7 bits per byte)
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
