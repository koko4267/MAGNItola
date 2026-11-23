async function getActiveClientId(forceRefresh = false, signal) {
  signal?.throwIfAborted();
  if (forceRefresh) {
    localStorage.removeItem('magnitola_sc_client_id');
  } else {
    const cached = localStorage.getItem('magnitola_sc_client_id');
    if (cached) return cached;
    if (window.APP_CONFIG?.SOUNDCLOUD_CLIENT_ID) return window.APP_CONFIG.SOUNDCLOUD_CLIENT_ID;
  }
  const api = window.electronAPI || null;
  if (api?.refreshSoundCloudClientId) {
    const cancel = () => api.cancelClientRefresh();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const fresh = await api.refreshSoundCloudClientId();
      signal?.throwIfAborted();
      if (fresh) {
        localStorage.setItem('magnitola_sc_client_id', fresh);
        if (window.APP_CONFIG) window.APP_CONFIG.SOUNDCLOUD_CLIENT_ID = fresh;
        return fresh;
      }
    } catch (err) {
      signal?.throwIfAborted();
      console.warn('Failed to refresh SoundCloud client_id:', err);
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }
  return window.APP_CONFIG?.SOUNDCLOUD_CLIENT_ID || '5lnU5PEpImc23JXFHBdq8E6QDd39I2uT';
}

async function resolveSoundCloudUrl(url, signal) {
  let clientId = await getActiveClientId(false, signal);
  const request = (url, options) => window.fetchWithRetry(url, { ...options, signal });
  let cleanUrl = url.trim();

  const inputUrl = URL.parse(cleanUrl);
  if (inputUrl?.hostname === 'on.soundcloud.com') {
    try {
      const resp = await request(cleanUrl, { method: 'GET', redirect: 'follow' });
      if (resp.url && resp.url !== cleanUrl) {
        cleanUrl = resp.url;
      }
    } catch (e) {
      console.warn('Could not expand shortlink:', e);
    }
  }

  const resolveTarget = cleanUrl.replace(/\/likes\/?(\?.*)?$/i, '').replace(/\/+$/, '');
  let resolveApi = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(resolveTarget)}&client_id=${clientId}`;

  let resp = await request(resolveApi);
  if (resp.status === 401) {
    console.warn('SoundCloud resolve returned 401, refreshing client_id...');
    clientId = await getActiveClientId(true, signal);
    resolveApi = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(resolveTarget)}&client_id=${clientId}`;
    resp = await request(resolveApi);
  }

  if (!resp.ok) {
    throw new Error(`SoundCloud resolve failed with status ${resp.status}`);
  }

  const data = await resp.json();
  const kind = data.kind;
  let trackQueue = [];
  let subFolder = null;

  if (kind === 'track') {
    trackQueue = [data];
  } else if (kind === 'playlist' || kind === 'system-playlist') {
    const title = (data.title || '').trim();
    subFolder = window.sanitizeFolderName(title) || (data.set_type === 'album' ? 'Album' : 'Playlist');
    const tracksElement = data.tracks || [];
    const byId = new Map();
    const trackIdsToFetch = new Set();

    for (const item of tracksElement) {
      if (item.media?.transcodings) {
        byId.set(item.id, item);
      } else if (item.id) {
        trackIdsToFetch.add(item.id);
      }
    }

    const missing = [...trackIdsToFetch].filter((id) => !byId.has(id));
    try {
      for (let i = 0; i < missing.length; i += 50) {
        signal.throwIfAborted();
        const batch = missing.slice(i, i + 50);
        let batchUrl = `https://api-v2.soundcloud.com/tracks?ids=${batch.join('%2C')}&client_id=${clientId}`;
        let bResp = await request(batchUrl);
        if (bResp.status === 401) {
          clientId = await getActiveClientId(true, signal);
          batchUrl = `https://api-v2.soundcloud.com/tracks?ids=${batch.join('%2C')}&client_id=${clientId}`;
          bResp = await request(batchUrl);
        }
        if (!bResp.ok) throw new Error(`HTTP ${bResp.status}`);
        const bTracks = await bResp.json();
        if (!Array.isArray(bTracks)) throw new Error('Invalid playlist tracks response');
        for (const track of bTracks) byId.set(track.id, track);
      }
    } catch (error) {
      signal.throwIfAborted();
      throw new Error('playlistPageFailed', { cause: error });
    }
    trackQueue = tracksElement.map((track) => byId.get(track.id) || track);
  } else if (kind === 'user') {
    subFolder = 'Likes';
    const userId = data.id;
    let likesUrl = `https://api-v2.soundcloud.com/users/${userId}/likes?client_id=${clientId}&limit=50`;
    const seenPages = new Set();

    while (likesUrl && !signal.aborted) {
      let lData;
      try {
        const page = new URL(likesUrl);
        page.searchParams.delete('client_id');
        page.searchParams.sort();
        if (seenPages.has(page.href)) throw new Error('Repeated likes page');
        seenPages.add(page.href);
        let lResp = await request(likesUrl);
        if (lResp.status === 401) {
          clientId = await getActiveClientId(true, signal);
          const retryUrl = new URL(likesUrl);
          retryUrl.searchParams.set('client_id', clientId);
          likesUrl = retryUrl.href;
          lResp = await request(likesUrl);
        }
        if (!lResp.ok) throw new Error(`HTTP ${lResp.status}`);
        lData = await lResp.json();
        if (!Array.isArray(lData?.collection)) throw new Error('Invalid likes response');
      } catch (error) {
        signal.throwIfAborted();
        throw new Error('likesPageFailed', { cause: error });
      }

      for (const item of lData.collection) {
        if (item.track && item.track.media && item.track.media.transcodings) {
          trackQueue.push(item.track);
        } else if (item.playlist && item.playlist.tracks) {
          for (const ptr of item.playlist.tracks) {
            if (ptr && ptr.media && ptr.media.transcodings) {
              trackQueue.push(ptr);
            }
          }
        } else if (item.media && item.media.transcodings) {
          trackQueue.push(item);
        }
      }

      if (!lData.next_href) break;
      const nextPage = URL.parse(lData.next_href, likesUrl);
      if (nextPage?.origin !== 'https://api-v2.soundcloud.com') throw new Error('likesPageFailed');
      if (!nextPage.searchParams.has('client_id')) nextPage.searchParams.set('client_id', clientId);
      likesUrl = nextPage.href;
    }
    signal.throwIfAborted();
  } else {
    throw new Error(window.L.invalidUrlError);
  }

  return {
    tracks: trackQueue,
    subFolder,
    title: data.title || null
  };
}

window.resolveSoundCloudUrl = resolveSoundCloudUrl;
window.getActiveClientId = getActiveClientId;
