const cache = new Map();

const TTL_MS =
  (parseInt(process.env.STORY_VIEWER_CACHE_TTL_MINUTES, 10) || 8) * 60 * 1000;

/** Short TTL when a profile loads with zero stories (avoid caching a miss for minutes). */
const EMPTY_STORIES_TTL_MS =
  (parseInt(process.env.STORY_VIEWER_EMPTY_STORIES_TTL_SECONDS, 10) || 45) *
  1000;

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

/**
 * @param {string} username
 * @param {object} data
 * @param {{ ttlMs?: number }} [options]
 */
export function setStoryViewerCache(username, data, options = {}) {
  const key = username.toLowerCase().trim();
  const ttlMs =
    Number.isFinite(options.ttlMs) && options.ttlMs > 0
      ? options.ttlMs
      : TTL_MS;
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

export function getStoryViewerCacheTtlMs({ hasStories = false } = {}) {
  return hasStories ? TTL_MS : EMPTY_STORIES_TTL_MS;
}
