const PRIVATE_HOST = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^169\.254\./,
  /^fc00:/i,
  /^fe80:/i,
];

const ALLOWED_MEDIA_SUFFIXES = [
  'instagram.com',
  'cdninstagram.com',
  'fbcdn.net',
];

const isPrivateHost = (host) => PRIVATE_HOST.some((re) => re.test(host));

const hostAllowed = (host) =>
  ALLOWED_MEDIA_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));

/**
 * True only when url is http(s) to Instagram/Facebook CDN hosts (no query-string tricks).
 */
export const parseAllowedInstagramMediaUrl = (raw) => {
  let parsed;
  try {
    parsed = new URL(String(raw || ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || isPrivateHost(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return null;
  }
  if (!hostAllowed(host)) return null;
  return parsed;
};

/**
 * Reject CDN redirects that leave Instagram/Facebook hosts.
 */
export const assertAllowedMediaRedirect = (options) => {
  const protocol = String(options?.protocol || 'https:').replace(/:?$/, ':');
  const host = options?.hostname || options?.host || '';
  const pathPart = options?.pathname || options?.path || '/';
  const href = options?.href || `${protocol}//${host}${pathPart}`;
  if (!parseAllowedInstagramMediaUrl(href)) {
    throw new Error('Redirect host not allowed');
  }
};
