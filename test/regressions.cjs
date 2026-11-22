const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { scanLibrary } = require('../library.cjs');

function renderer(scripts, overrides = {}) {
  const nodes = new Map();
  function element() {
    return {
      style: {},
      value: '',
      textContent: '',
      children: [],
      setAttribute() {},
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

test('a rejected save result reports the filesystem reason and never adds a track', async () => {
  const updates = [];
  const app = renderer(['config', 'utils', 'id3', 'soundcloud', 'download-track'], {
    electronAPI: { saveTrack: async () => ({ success: false, error: 'disk full' }) },
    fetch: async (url) =>
      url.includes('stream?')
        ? Response.json({ url: 'https://fixture/audio' })
        : new Response(Uint8Array.of(255, 251, 0, 0, 0)),
    addTrackToPlayer() {
      assert.fail('unsaved track added');
    }
  });
  await app.downloadTrack(
    {
      title: 'Test',
      media: {
        transcodings: [{ url: 'https://fixture/stream', format: { protocol: 'progressive', mime_type: 'audio/mpeg' } }]
      }
    },
    1,
    1,
    null,
    {},
    'out',
    new AbortController().signal,
    (update) => updates.push(update)
  );
  assert.equal(updates.at(-1).reason, 'disk full');
  assert.equal(updates.at(-1).status, 'fail');
  assert.ok(!updates.some((event) => event.status === 'done'));
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
    assert.equal(app.isDownloading, false);
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

test('a short ID3 header never inherits APIC or title bytes from the preceding file', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magnitola-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const full = Buffer.alloc(256);
  full.write('ID3');
  full.write('APIC', 128);
  for (let i = 0; i < 16; i++)
    fs.writeFileSync(path.join(dir, String(i).padStart(2, '0') + '.mp3'), i < 8 ? full : full.subarray(0, 16));
  const tracks = await scanLibrary(dir);
  assert.equal(tracks.length, 16);
  for (const track of tracks) assert.equal(track.hasCover, parseInt(track.fileName) < 8);
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
