const cache = new Map();

const TTL_MS =
  (parseInt(process.env.STORY_VIEWER_CACHE_TTL_MINUTES, 10) || 8) * 60 * 1000;

export function getStoryViewerCache(username) {
  const key = username.toLowerCase().trim();
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setStoryViewerCache(username, data) {
  const key = username.toLowerCase().trim();
  cache.set(key, {
    data,
    expiresAt: Date.now() + TTL_MS,
  });
}
