const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { scanLibrary, readTrackCover } = require('../library.cjs');
const { checkTrackFile, saveTrackFile } = require('../track-files.cjs');

function renderer(scripts, overrides = {}) {
  const nodes = new Map();
  function element() {
    return {
      style: {},
      value: '',
      textContent: '',
      children: [],
      setAttribute() {},
      removeAttribute(name) {
        delete this[name];
      },
      focus() {},
      querySelector() {
        return null;
      },
      appendChild(child) {
        this.children.push(child);
      },
      replaceChildren() {
        this.children = [];
      },
      addEventListener(name, callback) {
        this[name] = callback;
      }
    };
  }
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    querySelector() {
      return null;
    },
    createElement: element,
    createDocumentFragment: element
  };
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Uint8Array,
    TextEncoder,
    URL,
    Response,
    Audio: class {},
    document,
    localStorage: {
      getItem() {
        return null;
      }
    },
    L: {},
    ...overrides
  });
  context.window = context;
  for (const script of scripts) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', script + '.js'), 'utf8'), context);
  }
  return context;
}

function mp3Frames() {
  const audio = new Uint8Array(834);
  audio.set([0xff, 0xfb, 0x90, 0], 0);
  audio.set([0xff, 0xfb, 0x90, 0], 417);
  return audio;
}

function trackFixture(mimeType = 'audio/mpeg') {
  return {
    id: 42,
    title: 'Test',
    permalink_url: 'https://soundcloud.com/artist/test',
    media: {
      transcodings: [{ url: 'https://fixture/stream', format: { protocol: 'progressive', mime_type: mimeType } }]
    }
  };
}

function mockAudioDownload(audio, overrides) {
  return renderer(['config', 'utils', 'id3', 'soundcloud', 'download-track'], {
    fetch: async (url) =>
      url.includes('stream?') ? Response.json({ url: 'https://fixture/audio' }) : new Response(audio),
    ...overrides
  });
}

test('a refreshed SoundCloud client ID is reused by later playlist requests', async () => {
  const track = trackFixture();
  const requests = [];
  const storage = new Map();
  const app = renderer(['config', 'utils', 'soundcloud'], {
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value)
    },
    electronAPI: { refreshSoundCloudClientId: async () => 'refreshed' },
    fetch: async (input) => {
      const url = new URL(input);
      requests.push([url.pathname, url.searchParams.get('client_id')]);
      if (requests.length === 1) return new Response(null, { status: 401 });
      if (url.pathname === '/resolve') return Response.json({ kind: 'playlist', tracks: [{ id: track.id }] });
      return Response.json([track]);
    }
  });
  const result = await app.resolveSoundCloudUrl(
    'https://soundcloud.com/artist/sets/test',
    new AbortController().signal
  );
  assert.equal(result.tracks[0].id, track.id);
  assert.deepEqual(requests, [
    ['/resolve', app.APP_CONFIG.SOUNDCLOUD_CLIENT_ID],
    ['/resolve', 'refreshed'],
    ['/tracks', 'refreshed']
  ]);
});

test('playlist retains source positions when batch results arrive reversed and IDs repeat', async () => {
  const track = (id) => ({ id, media: { transcodings: [] } });
  const responses = [{ kind: 'playlist', tracks: [{ id: 2 }, track(1), { id: 3 }, { id: 2 }] }, [track(3), track(2)]];
  const app = renderer(['config', 'utils', 'soundcloud'], {
    fetch: async () => Response.json(responses.shift())
  });
  const result = await app.resolveSoundCloudUrl('https://soundcloud.com/fixture', new AbortController().signal);
  assert.deepEqual(
    Array.from(result.tracks, (item) => item.id),
    [2, 1, 3, 2]
  );
});

test('a failed playlist metadata batch reports the localized error before downloading', async () => {
  let batchRequests = 0;
  const app = renderer(['locales', 'config', 'utils', 'soundcloud', 'downloader'], {
    fetch: async (url) => {
      if (url.includes('/resolve?')) {
        return Response.json({ kind: 'playlist', tracks: [trackFixture(), { id: 43 }] });
      }
      batchRequests++;
      return new Response(null, { status: 503 });
    },
    downloadTrack: () => assert.fail('a track from an incomplete playlist was downloaded')
  });
  app.APP_CONFIG.RETRY_BASE_DELAY_MS = 1;
  app.APP_CONFIG.RETRY_JITTER_MS = 1;
  app.document.getElementById('inputUrl').value = 'https://soundcloud.com/fixture/sets/test';
  await app.startDownloadFlow();
  assert.equal(batchRequests, app.APP_CONFIG.MAX_FETCH_RETRIES);
  assert.equal(app.document.getElementById('inputError').textContent, app.LOCALES.en.playlistPageFailed);
});

test('a successful HTTP response with an invalid playlist batch is rejected', async () => {
  const app = renderer(['config', 'utils', 'soundcloud'], {
    fetch: async (url) =>
      url.includes('/resolve?')
        ? Response.json({ kind: 'playlist', tracks: [{ id: 43 }] })
        : Response.json('Invalid response')
  });
  await assert.rejects(app.resolveSoundCloudUrl('https://soundcloud.com/fixture', new AbortController().signal), {
    message: 'playlistPageFailed'
  });
});

test('a rejected save result reports the filesystem reason and never adds a track', async () => {
  const updates = [];
  const app = mockAudioDownload(mp3Frames(), {
    electronAPI: { saveTrack: async () => ({ success: false, error: 'disk full' }) },
    addTrackToPlayer() {
      assert.fail('unsaved track added');
    }
  });
  await app.downloadTrack(trackFixture(), 1, 1, null, {}, 'out', new AbortController().signal, (update) =>
    updates.push(update)
  );
  assert.equal(updates.at(-1).reason, 'disk full');
  assert.equal(updates.at(-1).status, 'fail');
  assert.ok(!updates.some((event) => event.status === 'done'));
});

test('verified MP3 frames pass through unchanged after replacing the original ID3 tag', async () => {
  const frames = mp3Frames();
  const oldTag = renderer(['id3']).createId3v23Tag('Old title', 'Artist');
  const input = Uint8Array.from([...oldTag, ...frames]);
  let saved;
  let added;
  const app = mockAudioDownload(input, {
    electronAPI: {
      saveTrack: async (payload) => {
        saved = payload;
        return { success: true, filePath: 'out/actual [42].mp3', fileName: 'actual [42].mp3' };
      }
    },
    addTrackToPlayer: (track) => (added = track)
  });
  assert.equal(
    await app.downloadTrack(trackFixture(), 1, 1, null, {}, 'out', new AbortController().signal, () => {}),
    true
  );
  assert.equal(saved.soundCloudId, 42);
  assert.equal(saved.soundCloudUrl, trackFixture().permalink_url);
  assert.equal(added.fileName, 'actual [42].mp3');
  const tagSize = saved.buffer.subarray(6, 10).reduce((size, byte) => size * 128 + byte, 0);
  assert.deepEqual(saved.buffer.subarray(10 + tagSize), frames);
});

test('HLS follows redirected playlist URLs and keeps segments in playlist order', async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const received = [];
  const app = renderer(['config', 'download-track']);
  const url = 'https://fixture/master.m3u8';
  const request = async (uri) => {
    if (uri === url) {
      return {
        ok: true,
        url: 'https://cdn/master.m3u8',
        text: async () => '#EXT-X-STREAM-INF:BANDWIDTH=64000\nmedia/list.m3u8'
      };
    }
    if (uri === 'https://cdn/media/list.m3u8') {
      return {
        ok: true,
        url: 'https://cdn/segments/list.m3u8',
        text: async () => '#EXT-X-MAP:URI="init.mp4"\nfirst.m4s\nsecond.m4s'
      };
    }
    if (uri === 'https://cdn/segments/init.mp4') return new Response(Uint8Array.of(1));
    if (uri === 'https://cdn/segments/first.m4s') return first.promise;
    if (uri === 'https://cdn/segments/second.m4s') return second.promise;
    assert.fail('Unexpected HLS URL ' + uri);
  };
  const download = app.downloadHlsAudio(url, request, new AbortController().signal, (update) => received.push(update));
  second.resolve(new Response(Uint8Array.of(4, 5)));
  await new Promise(setImmediate);
  assert.deepEqual(
    received.map((update) => update.progress),
    [35]
  );
  first.resolve(new Response(Uint8Array.of(2, 3)));
  assert.deepEqual(await download, Uint8Array.of(1, 2, 3, 4, 5));
  assert.deepEqual(
    received.map((update) => update.progress),
    [35, 70]
  );
});

test('declared HLS streams accept extensionless playlist URLs', async () => {
  const track = trackFixture();
  track.media.transcodings[0].format.protocol = 'hls';
  const app = mockAudioDownload(null, {
    fetch: async (url) => {
      if (url.includes('stream?')) return Response.json({ url: 'https://fixture/manifest' });
      if (url.endsWith('/manifest')) return new Response('#EXTM3U\nsegment');
      assert.equal(url, 'https://fixture/segment');
      return new Response(mp3Frames());
    },
    electronAPI: { saveTrack: async () => ({ success: true, filePath: 'out/test.mp3' }) },
    addTrackToPlayer() {}
  });
  assert.equal(await app.downloadTrack(track, 1, 1, null, {}, 'out', new AbortController().signal, () => {}), true);
});

test('Stop releases the queue before a native decode finishes', async () => {
  const started = Promise.withResolvers();
  const decode = Promise.withResolvers();
  let closed = false;
  const app = mockAudioDownload(Uint8Array.of(1), {
    AudioContext: class {
      decodeAudioData() {
        started.resolve();
        return decode.promise;
      }
      async close() {
        closed = true;
      }
    }
  });
  const controller = new AbortController();
  const download = app.downloadTrack(trackFixture(), 1, 1, null, {}, 'out', controller.signal, () => {});
  await started.promise;
  controller.abort();
  const cancelled = assert.rejects(download, { name: 'AbortError' });
  await new Promise(setImmediate);
  assert.equal(closed, true);
  decode.resolve();
  await cancelled;
});

test('AAC with and without ID3 is decoded and encoded to MP3 at 192 kbps', async () => {
  const adts = Uint8Array.of(0xff, 0xf1, 0x50, 0x80, 0, 0xff, 0xfc, 0);
  const tag = renderer(['id3']).createId3v23Tag('AAC title', 'Artist');
  const encoded = mp3Frames();
  for (const input of [adts, Uint8Array.from([...tag, ...adts])]) {
    let decoded;
    let encodingOptions;
    let saved;
    const app = mockAudioDownload(input, {
      AudioContext: class {
        async decodeAudioData(buffer) {
          decoded = new Uint8Array(buffer);
          return { numberOfChannels: 1, sampleRate: 44100, getChannelData: () => new Float32Array(16) };
        }
        async close() {}
      },
      Worker: class {
        postMessage(options) {
          encodingOptions = options;
          this.onmessage({ data: { type: 'done', buffer: encoded } });
        }
        terminate() {}
      },
      electronAPI: {
        saveTrack: async (payload) => {
          saved = payload;
          return { success: true, filePath: 'out/test.mp3' };
        }
      },
      addTrackToPlayer() {}
    });
    let downloaded;
    const join = app.joinAudioChunks;
    app.joinAudioChunks = (...args) => {
      downloaded = join(...args);
      if (input !== adts) {
        const padded = Uint8Array.from([0xcc, ...downloaded, 0xdd]);
        downloaded = padded.subarray(1, -1);
      }
      return downloaded;
    };
    const track = trackFixture('audio/aac');
    assert.equal(await app.downloadTrack(track, 1, 1, null, {}, 'out', new AbortController().signal, () => {}), true);
    assert.deepEqual(decoded, input);
    if (input === adts) assert.equal(decoded.buffer, downloaded.buffer);
    else assert.notEqual(decoded.buffer, downloaded.buffer);
    assert.equal(encodingOptions.bitrate, 192);
    assert.deepEqual(saved.buffer.subarray(-encoded.length), encoded);
  }
});

test('a 503 from the second likes page prevents downloading a partial queue and translates the error', async () => {
  let requests = 0;
  const app = renderer(['locales', 'config', 'utils', 'soundcloud', 'downloader'], {
    fetch: async (url) => {
      requests++;
      if (url.includes('/resolve?')) return Response.json({ kind: 'user', id: 1 });
      if (url.includes('cursor=2')) return new Response(null, { status: 503 });
      return Response.json({
        collection: [{ track: trackFixture() }],
        next_href: 'https://api-v2.soundcloud.com/users/1/likes?cursor=2'
      });
    },
    downloadTrack: () => assert.fail('a track from an incomplete queue was downloaded')
  });
  app.APP_CONFIG.RETRY_BASE_DELAY_MS = 1;
  app.APP_CONFIG.RETRY_JITTER_MS = 1;
  app.document.getElementById('inputUrl').value = 'https://soundcloud.com/artist/likes';
  await app.startDownloadFlow();
  assert.equal(requests, 2 + app.APP_CONFIG.MAX_FETCH_RETRIES);
  assert.equal(app.document.getElementById('inputError').textContent, app.L.likesPageFailed);
  assert.ok(app.L.likesPageFailed);
  assert.equal(app.isDownloading(), false);
});

test('likes pagination stops on a repeated page even if its query parameters are reordered', async () => {
  let requests = 0;
  const app = renderer(['config', 'utils', 'soundcloud'], {
    fetch: async (url) => {
      requests++;
      if (url.includes('/resolve?')) return Response.json({ kind: 'user', id: 1 });
      return Response.json({
        collection: [{ track: trackFixture() }],
        next_href: '/users/1/likes?limit=50&client_id=different'
      });
    }
  });
  await assert.rejects(
    app.resolveSoundCloudUrl('https://soundcloud.com/artist/likes', new AbortController().signal),
    /likesPageFailed/
  );
  assert.equal(requests, 2);
});

test('download artwork returns to the logo when the queue finishes', async () => {
  const lastTrack = Promise.withResolvers();
  const app = renderer(['downloader'], {
    resolveSoundCloudUrl: async () => ({ tracks: [{ title: 'First' }, { title: 'Second' }] }),
    downloadTrack: async (track, index, _total, _subFolder, _result, _targetDir, _signal, report) => {
      report({ artwork: `https://fixture/${track.title}.jpg` });
      artwork.onload();
      if (index === 2) await lastTrack.promise;
      report({ status: 'done' });
    }
  });
  const artwork = app.document.getElementById('albumArtImg');
  const logo = app.document.getElementById('albumArtIcon');
  app.document.getElementById('inputUrl').value = 'fixture';
  const download = app.startDownloadFlow();
  await new Promise(setImmediate);
  assert.equal(artwork.src, 'https://fixture/Second.jpg');
  assert.equal(artwork.hidden, false);
  assert.equal(logo.hidden, true);
  assert.equal(app.document.getElementById('queueHeaderCount').textContent, '1/2');
  lastTrack.resolve();
  await download;
  assert.equal(artwork.hidden, true);
  assert.equal(artwork.src, undefined);
  assert.equal(artwork.onload, null);
  assert.equal(logo.hidden, false);
  assert.equal(app.document.getElementById('queueHeaderCount').textContent, '2/2');
});

test('Enter twice starts one job, Stop aborts the request, and restart is available', async () => {
  let calls = 0;
  let initialize;
  const app = renderer(['downloader', 'app'], {
    addEventListener(_event, listener) {
      initialize = listener;
    },
    setInterval,
    clearInterval,
    resolveSoundCloudUrl: (_url, signal) =>
      new Promise((_resolve, reject) => {
        calls++;
        signal.addEventListener('abort', () => reject(signal.reason));
      })
  });
  await initialize();
  app.L.stopped = 'Stopped';
  app.document.getElementById('inputUrl').value = 'fixture';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const input = app.document.getElementById('inputUrl');
    input.keydown({ key: 'Enter' });
    input.keydown({ key: 'Enter' });
    assert.equal(calls, attempt);
    app.document.getElementById('btnStopDownload').click();
    await new Promise(setImmediate);
    assert.equal(app.isDownloading(), false);
    assert.equal(app.document.getElementById('currentTrackTitle').textContent, 'Stopped');
  }
});

test('abort interrupts retry backoff', async () => {
  const controller = new AbortController();
  let calls = 0;
  const app = renderer(['utils'], {
    fetch: async () => {
      calls++;
      return new Response(null, { status: 503 });
    }
  });
  const request = app.fetchWithRetry('fixture', { signal: controller.signal }, 3, 60000);
  await new Promise(setImmediate);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('stopping an encode terminates its worker and settles the promise', async () => {
  let terminated = 0;
  const app = renderer(['download-track'], {
    Worker: class {
      postMessage() {}
      terminate() {
        terminated++;
      }
    }
  });
  const controller = new AbortController();
  const encoding = app.encodeAudioBufferWithWorker(
    { numberOfChannels: 1, getChannelData: () => new Float32Array(16) },
    192,
    null,
    controller.signal
  );
  controller.abort();
  await assert.rejects(encoding, { name: 'AbortError' });
  assert.equal(terminated, 1);
});

test('newest folder wins and a save during its scan survives exactly once', async () => {
  const replies = {};
  const app = renderer(['player'], {
    document: { getElementById: () => null },
    electronAPI: {
      scanLibrary: (folder) =>
        new Promise((resolve) => {
          replies[folder] = resolve;
        })
    }
  });
  const first = app.scanAndLoadLibrary('A');
  const second = app.scanAndLoadLibrary('B');
  app.addTrackToPlayer({ filePath: 'B/new', title: 'fresh' }, 'B');
  app.addTrackToPlayer({ filePath: 'A/other' }, 'A');
  replies.B([{ filePath: 'b/new' }, { filePath: 'B/old' }]);
  await second;
  replies.A([{ filePath: 'A/song' }]);
  await first;
  assert.deepEqual(
    Array.from(vm.runInContext('libraryTracks', app), (track) => track.filePath),
    ['B/new', 'B/old']
  );
});

test('a short ID3 tag never inherits APIC or title bytes from the preceding file', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magnitola-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { createId3v23Tag } = renderer(['id3']);
  const full = createId3v23Tag('Tagged', 'Artist', Uint8Array.of(0xff, 0xd8, 0xff));
  for (let i = 0; i < 16; i++)
    fs.writeFileSync(path.join(dir, String(i).padStart(2, '0') + '.mp3'), i < 8 ? full : full.subarray(0, 16));
  const tracks = await scanLibrary(dir);
  assert.equal(tracks.length, 16);
  for (const track of tracks) {
    const fullTag = parseInt(track.fileName) < 8;
    assert.equal(track.hasCover, fullTag);
    assert.equal(track.title, fullTag ? 'Tagged' : path.parse(track.fileName).name);
  }
});

test('scanning and reading artwork use frame boundaries even beyond the first 8 KiB', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magnitola-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { createId3v23Tag } = renderer(['id3']);
  const cover = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(160 * 1024)]);
  const tagged = Buffer.from(createId3v23Tag('Название', 'Исполнитель', cover));
  const fakeFrames = Buffer.from(createId3v23Tag('Wrong title', 'Wrong artist', cover.subarray(0, 3))).subarray(10);
  const privateData = Buffer.concat([Buffer.from('test\0'), fakeFrames, Buffer.alloc(8192)]);
  const privateFrame = Buffer.alloc(10);
  privateFrame.write('PRIV');
  privateFrame.writeUInt32BE(privateData.length, 4);
  const contents = Buffer.concat([tagged.subarray(0, 10), privateFrame, privateData, tagged.subarray(10)]);
  const size = contents.length - 10;
  for (let i = 0; i < 4; i++) contents[9 - i] = (size >>> (7 * i)) & 0x7f;
  const filePath = path.join(dir, 'track.mp3');
  fs.writeFileSync(filePath, contents);

  const [track] = await scanLibrary(dir);
  assert.equal(track.title, 'Название');
  assert.equal(track.artist, 'Исполнитель');
  assert.equal(track.hasCover, true);
  assert.equal(await readTrackCover(filePath), 'data:image/jpeg;base64,' + cover.toString('base64'));
});

test('the library reads an ID3v2.4 frame after an extended header', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magnitola-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const title = 'Title '.repeat(23).trim();
  const body = Buffer.concat([Buffer.from([3]), Buffer.from(title)]);
  const frame = Buffer.from([0x54, 0x49, 0x54, 0x32, 0, 0, body.length >>> 7, body.length & 0x7f, 0, 0]);
  const extendedHeader = Buffer.from([0, 0, 0, 6, 1, 0]);
  const size = extendedHeader.length + frame.length + body.length;
  const header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0x40, 0, 0, size >>> 7, size & 0x7f]);
  fs.writeFileSync(path.join(dir, 'track.mp3'), Buffer.concat([header, extendedHeader, frame, body]));
  const [track] = await scanLibrary(dir);
  assert.equal(track.title, title);
});

test('a rejected playback request leaves the play button available for retry', async () => {
  let attempts = 0;
  const app = renderer(['config', 'locales', 'player'], {
    console: { warn() {} },
    Audio: class extends EventTarget {
      paused = true;
      async play() {
        attempts++;
        if (attempts === 1) throw new Error('File unavailable');
        this.paused = false;
        this.dispatchEvent(new Event('play'));
      }
      pause() {
        this.paused = true;
        this.dispatchEvent(new Event('pause'));
      }
    }
  });
  const button = app.document.getElementById('btnPlayerPlay');
  app.initPlayerListeners();
  app.playTrack({ filePath: 'track.mp3' });
  await new Promise(setImmediate);
  assert.equal(button.textContent, '▶');
  button.click();
  assert.equal(attempts, 2);
  assert.equal(button.textContent, '❚❚');
  app.electronAPI = { scanLibrary: async () => [] };
  await app.scanAndLoadLibrary('empty');
  assert.equal(button.disabled, false);
  button.click();
  assert.equal(button.textContent, '▶');
});

test('overlapping library and player requests share a single cover read', async () => {
  let reads = 0;
  let reply;
  const app = renderer(['player'], {
    electronAPI: {
      readTrackCover: () => {
        reads++;
        return new Promise((resolve) => {
          reply = resolve;
        });
      }
    }
  });
  const first = app.loadCover('file');
  const second = app.loadCover('file');
  assert.equal(reads, 1);
  reply('artwork');
  assert.deepEqual(await Promise.all([first, second]), ['artwork', 'artwork']);
  assert.equal(app.getArtworkCache('file'), 'artwork');
});

test('tracks saved during a scan retain only metadata after their artwork is evicted', async () => {
  let reply;
  const app = renderer(['player'], {
    APP_CONFIG: { ARTWORK_CACHE_MAX: 1 },
    document: { getElementById: () => null },
    electronAPI: {
      scanLibrary: () => new Promise((resolve) => (reply = resolve)),
      readTrackCover: async () => 'from disk'
    }
  });
  const scan = app.scanAndLoadLibrary('A');
  for (const name of ['first', 'second']) {
    app.addTrackToPlayer({ filePath: `A/${name}`, artworkDataUrl: name, hasCover: true }, 'A');
  }
  reply([{ filePath: 'A/first' }]);
  await scan;
  const tracks = vm.runInContext('libraryTracks', app);
  assert.equal(tracks.length, 2);
  assert.ok(tracks.every((track) => !Object.hasOwn(track, 'artworkDataUrl')));
  assert.equal(app.getArtworkCache('A/first'), null);
  assert.equal(app.getArtworkCache('A/second'), 'second');
  assert.equal(await app.loadCover('A/first'), 'from disk');
  assert.equal(app.getArtworkCache('A/second'), null);
});

test('the artwork cache evicts by total size and keeps recently used covers', () => {
  const app = renderer(['player'], { APP_CONFIG: { ARTWORK_CACHE_MAX_CHARS: 10 } });
  app.setArtworkCache('recent', 'abcd');
  app.setArtworkCache('old', 'efgh');
  app.getArtworkCache('recent');
  app.setArtworkCache('new', 'ijk');
  assert.equal(app.getArtworkCache('recent'), 'abcd');
  assert.equal(app.getArtworkCache('old'), null);
  assert.equal(app.getArtworkCache('new'), 'ijk');
  app.setArtworkCache('recent', 'x'.repeat(11));
  assert.equal(app.getArtworkCache('recent'), null);
  assert.equal(app.getArtworkCache('new'), 'ijk');
});

test('concurrent saves preserve distinct SoundCloud tracks with the same filename', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magnitola-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { createId3v23Tag } = renderer(['id3']);
  const fileName = 'Artist - Test.mp3';
  const legacyUrl = 'https://soundcloud.com/artist/old';
  const legacy = createId3v23Tag('Test', 'Artist', null, { url: legacyUrl });
  fs.writeFileSync(path.join(directory, fileName), legacy);
  const legacyMatch = await checkTrackFile(directory, { fileName, soundCloudId: 1, soundCloudUrl: legacyUrl });
  assert.equal(legacyMatch.exists, true);

  const payload = (id) => ({
    fileName,
    soundCloudId: id,
    buffer: createId3v23Tag('Test', 'Artist', null, { soundCloudId: id })
  });
  fs.writeFileSync(path.join(directory, 'Artist - Test [2].mp3'), 'unidentified');
  const [first, second, repeat] = await Promise.all([
    saveTrackFile(directory, payload(2)),
    saveTrackFile(directory, payload(3)),
    saveTrackFile(directory, payload(2))
  ]);
  assert.equal(first.fileName, 'Artist - Test [2] (2).mp3');
  assert.equal(second.fileName, 'Artist - Test [3].mp3');
  assert.equal(repeat.filePath, first.filePath);
  assert.notEqual(first.exists, repeat.exists);
  assert.deepEqual(fs.readFileSync(path.join(directory, fileName)), Buffer.from(legacy));
  assert.equal(fs.readFileSync(path.join(directory, 'Artist - Test [2].mp3'), 'utf8'), 'unidentified');
  assert.ok(fs.readdirSync(directory).every((name) => name.endsWith('.mp3')));

  fs.unlinkSync(path.join(directory, fileName));
  fs.unlinkSync(path.join(directory, 'Artist - Test [2].mp3'));
  assert.equal((await checkTrackFile(directory, payload(2))).filePath, first.filePath);
  const unique = await saveTrackFile(directory, payload(4));
  assert.equal(unique.fileName, fileName);
});

test('saving chooses another name if the intended file appears while writing', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magnitola-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fileName = 'Artist - Test.mp3';
  const originalPath = path.join(directory, fileName);
  const writeFile = fs.promises.writeFile;
  t.mock.method(fs.promises, 'writeFile', async (...args) => {
    await writeFile(...args);
    await writeFile(originalPath, 'another file');
  });

  const result = await saveTrackFile(directory, { fileName, soundCloudId: 42, buffer: mp3Frames() });
  assert.equal(result.fileName, 'Artist - Test [42].mp3');
  assert.equal(fs.readFileSync(originalPath, 'utf8'), 'another file');
  assert.ok(fs.readdirSync(directory).every((name) => name.endsWith('.mp3')));
});

test('invalid links stay local, and the queue accepts a corrected private link', async () => {
  for (const lang of ['en', 'ru']) {
    const targets = [];
    const app = renderer(['locales', 'config', 'utils', 'soundcloud', 'downloader'], {
      localStorage: { getItem: (key) => (key === 'magnitola_lang' ? lang : null) },
      fetch: async (url) => {
        targets.push(new URL(url).searchParams.get('url'));
        return Response.json({ kind: 'playlist', tracks: [] });
      }
    });
    const input = app.document.getElementById('inputUrl');
    for (input.value of [
      'pasted text',
      'https://example.invalid/file?token=synthetic',
      'https://soundcloud.com.example.invalid/a',
      'https://soundcloud.com@example.invalid/a',
      'ftp://soundcloud.com/a'
    ]) {
      await app.startDownloadFlow();
      assert.equal(app.document.getElementById('inputError').textContent, app.LOCALES[lang].invalidUrlError);
    }
    assert.deepEqual(targets, []);
    input.value = 'http://m.soundcloud.com/a/music/s-private?secret_token=test%2F';
    await app.startDownloadFlow();
    assert.deepEqual(targets, [input.value.replace('http:', 'https:')]);
  }
});

test('short links validate the expanded URL before resolve', async () => {
  const short = 'https://on.soundcloud.com/test';
  let destination = 'https://example.invalid/file';
  const calls = [];
  const app = renderer(['config', 'utils', 'soundcloud'], {
    fetch: async (url) => {
      calls.push(url);
      if (url === short) return { ok: true, url: destination };
      return Response.json({ kind: 'track' });
    }
  });
  const signal = new AbortController().signal;
  await assert.rejects(app.resolveSoundCloudUrl(short, signal), /invalidUrlError/);
  assert.deepEqual(calls, [short]);
  destination = 'https://www.soundcloud.com/artist/likes/?x=1';
  await app.resolveSoundCloudUrl(short, signal);
  assert.equal(new URL(calls[2]).searchParams.get('url'), 'https://www.soundcloud.com/artist?x=1');
});

test('stream fallback preserves retries, cancellation and the final failure reason', async () => {
  for (const scenario of ['404', 'transport', 'empty', 'abort', 'exhausted', 'range', 'map-only']) {
    const track = trackFixture();
    const first = track.media.transcodings[0];
    const second = { ...first, url: 'https://fixture/second' };
    const ranged = scenario === 'range' || scenario === 'map-only';
    if (ranged) {
      first.format = { protocol: 'hls' };
      second.format = { protocol: 'progressive' };
    }
    if (scenario !== 'map-only') track.media.transcodings.push(second);
    const controller = new AbortController();
    const updates = [];
    const counts = [0, 0, 0];
    const unexpected = [];
    const app = mockAudioDownload(null, {
      L: { hlsByteRangeUnsupported: 'unsupported byte ranges' },
      fetch: async (url) => {
        const pathname = new URL(url).pathname;
        if (pathname === '/stream' || pathname === '/second') {
          return Response.json({ url: 'https://fixture' + pathname + '/audio' });
        }
        if (pathname === '/stream/audio') {
          counts[0]++;
          if (scenario === 'abort') controller.abort();
          if (scenario === '404') return new Response(null, { status: 404 });
          if (scenario === 'empty') return new Response(new Uint8Array());
          if (ranged) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/variant');
          throw new Error('transport failed');
        }
        if (pathname === '/variant') {
          const tag = scenario === 'range' ? '#EXT-X-BYTERANGE:2@0' : '#EXT-X-MAP:URI="init",BYTERANGE="2@0"';
          const segments = scenario === 'range' ? 'segment\n#EXT-X-BYTERANGE:2@2\nsegment' : 'segment';
          return new Response(`#EXTM3U\n${tag}\n${segments}`);
        }
        if (pathname === '/second/audio') {
          counts[1]++;
          return scenario === 'exhausted' ? new Response(null, { status: 410 }) : new Response(mp3Frames());
        }
        unexpected.push(pathname);
        return new Response(null, { status: 404 });
      },
      electronAPI: {
        saveTrack: async ({ buffer }) => {
          assert.deepEqual(buffer.subarray(-834), mp3Frames());
          counts[2]++;
          return { success: true, filePath: 'out/test.mp3' };
        }
      },
      addTrackToPlayer() {}
    });
    app.APP_CONFIG.RETRY_BASE_DELAY_MS = 1;
    app.APP_CONFIG.RETRY_JITTER_MS = 1;
    const result = app.downloadTrack(track, 1, 1, null, {}, 'out', controller.signal, (update) => updates.push(update));
    if (scenario === 'abort') await assert.rejects(result, { name: 'AbortError' });
    else if (scenario === 'exhausted' || scenario === 'map-only') {
      assert.equal(await result, false);
      const failures = updates.filter((update) => update.status === 'fail');
      assert.deepEqual(
        failures.map((update) => update.reason),
        [ranged ? 'hlsByteRangeUnsupported' : 'HTTP 410']
      );
    } else assert.equal(await result, true);
    const expected = {
      404: [1, 1, 1],
      transport: [3, 1, 1],
      empty: [1, 1, 1],
      abort: [1, 0, 0],
      exhausted: [3, 1, 0],
      range: [1, 1, 1],
      'map-only': [1, 0, 0]
    };
    assert.deepEqual(counts, expected[scenario], scenario);
    assert.deepEqual(unexpected, []);
  }
});

test('a ranged HLS rendition falls back within the same master before reading media', async () => {
  const app = renderer(['config', 'download-track']);
  const requests = [];
  const bodies = {
    '/master': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2\nranged\n#EXT-X-STREAM-INF:BANDWIDTH=1\nplain',
    '/ranged': '#EXTM3U\n#EXT-X-MAP:BYTERANGE="2@0",URI="init"\nskip',
    '/plain': '#EXTM3U\n#EXT-X-MAP:URI="init,BYTERANGE=fake"\nsound',
    '/init,BYTERANGE=fake': Uint8Array.of(1, 2),
    '/sound': Uint8Array.of(3, 4)
  };
  const request = async (url) => {
    const name = new URL(url).pathname;
    requests.push(name);
    assert.ok(Object.hasOwn(bodies, name));
    return new Response(bodies[name]);
  };
  const audio = await app.downloadHlsAudio('https://fixture/master', request, new AbortController().signal, () => {});
  assert.deepEqual(audio, Uint8Array.of(1, 2, 3, 4));
  assert.deepEqual(requests, Object.keys(bodies));
});

test('a stored HLS range error renders in the current queue language', () => {
  const app = renderer(['locales', 'downloader']);
  for (const lang of ['ru', 'en']) {
    app.L = app.LOCALES[lang];
    const row = app.document.createElement('div');
    app.renderReason(row, 'fail', 'hlsByteRangeUnsupported');
    assert.equal(row.children[0].textContent, app.LOCALES[lang].hlsByteRangeUnsupported);
  }
});
