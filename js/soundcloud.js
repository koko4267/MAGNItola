const clientIdStorageKey = 'magnitola_sc_client_id';

async function refreshSoundCloudClientId(signal) {
  const api = window.electronAPI;
  if (!api?.refreshSoundCloudClientId) return null;

  signal.throwIfAborted();
  const cancel = () => api.cancelClientRefresh();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const fresh = await api.refreshSoundCloudClientId();
    signal.throwIfAborted();
    if (fresh) localStorage.setItem(clientIdStorageKey, fresh);
    return fresh;
  } catch (err) {
    signal.throwIfAborted();
    console.warn('Failed to refresh SoundCloud client_id:', err);
    return null;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

async function requestSoundCloud(url, signal) {
  signal.throwIfAborted();
  const endpoint = new URL(url);
  const clientId = localStorage.getItem(clientIdStorageKey) || window.APP_CONFIG.SOUNDCLOUD_CLIENT_ID;
  if (!endpoint.searchParams.has('client_id')) endpoint.searchParams.set('client_id', clientId);
  const response = await window.fetchWithRetry(endpoint.href, { signal });
  if (response.status !== 401) return response;

  endpoint.searchParams.set('client_id', (await refreshSoundCloudClientId(signal)) || clientId);
  return window.fetchWithRetry(endpoint.href, { signal });
}

async function resolveSoundCloudUrl(url, signal) {
  let cleanUrl = url.trim();

  const inputUrl = URL.parse(cleanUrl);
  if (inputUrl?.hostname === 'on.soundcloud.com') {
    try {
      const resp = await window.fetchWithRetry(cleanUrl, { redirect: 'follow', signal });
      if (resp.url && resp.url !== cleanUrl) {
        cleanUrl = resp.url;
      }
    } catch (e) {
      console.warn('Could not expand shortlink:', e);
    }
  }

  const resolveTarget = cleanUrl.replace(/\/likes\/?(\?.*)?$/i, '').replace(/\/+$/, '');
  const resolveApi = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(resolveTarget)}`;
  const resp = await requestSoundCloud(resolveApi, signal);

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
        const batchUrl = `https://api-v2.soundcloud.com/tracks?ids=${batch.join('%2C')}`;
        const bResp = await requestSoundCloud(batchUrl, signal);
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
    let likesUrl = `https://api-v2.soundcloud.com/users/${userId}/likes?limit=50`;
    const seenPages = new Set();

    while (likesUrl && !signal.aborted) {
      let lData;
      try {
        const page = new URL(likesUrl);
        page.searchParams.delete('client_id');
        page.searchParams.sort();
        if (seenPages.has(page.href)) throw new Error('Repeated likes page');
        seenPages.add(page.href);
        const lResp = await requestSoundCloud(likesUrl, signal);
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
window.requestSoundCloud = requestSoundCloud;
