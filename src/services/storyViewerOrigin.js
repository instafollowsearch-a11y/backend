const hostFromEnvUrl = (value) => {
  try {
    if (!value) return '';
    return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const EXTRA_HOSTS = ['localhost', '127.0.0.1'];

/**
 * Hosts allowed to call POST /story-viewer from a browser (Origin / Referer).
 */
export const getAllowedStoryViewerHosts = () => {
  const hosts = new Set(EXTRA_HOSTS);
  const fromEnv = [
    process.env.FRONTEND_URL,
    process.env.STORY_VIEWER_PUBLIC_URL,
    'https://instafollowcheck.com',
    'https://freeinstagramstoryviewer.com',
  ];
  fromEnv.forEach((url) => {
    const host = hostFromEnvUrl(url);
    if (host) hosts.add(host);
  });
  return hosts;
};

const hostnameOf = (value) => {
  try {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

export const isAllowedStoryViewerHost = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return false;
  if (host.endsWith('.onrender.com')) return true;
  return getAllowedStoryViewerHosts().has(host);
};

export const getRequestOriginOrReferer = (req) =>
  String(req?.headers?.origin || req?.headers?.referer || '').trim();

export const hasBrowserOrigin = (req) => Boolean(getRequestOriginOrReferer(req));

/**
 * If Origin/Referer is present, it must be an allowlisted site.
 * Missing Origin is allowed (stricter rate limit applies elsewhere).
 */
export const isStoryViewerOriginOk = (req) => {
  const raw = getRequestOriginOrReferer(req);
  if (!raw) return true;
  const host = hostnameOf(raw);
  return isAllowedStoryViewerHost(host);
};

export const isStrictStoryClient = (req) => !hasBrowserOrigin(req);
