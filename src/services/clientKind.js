import { isbot } from 'isbot';

const BROWSER_ANON = /^(anon_|sv_)/i;
const OUR_HOST_HINTS = [
  'instafollowcheck.com',
  'freeinstagramstoryviewer.com',
  'instagramstoryviewer',
  'onrender.com',
];

const clipUa = (value) => {
  if (value == null || value === '') return null;
  return String(value).slice(0, 256);
};

const hostFromUrl = (value) => {
  try {
    if (!value) return '';
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return String(value || '').toLowerCase();
  }
};

const isOurSite = (value) => {
  const host = hostFromUrl(value);
  if (!host) return false;
  return OUR_HOST_HINTS.some((hint) => host.includes(hint));
};

/**
 * Classify a request as a real browser vs API/bot. Never throws.
 */
export const classifyClient = ({
  userAgent = null,
  anonId = null,
  referrer = null,
  origin = null,
} = {}) => {
  const ua = clipUa(userAgent);
  const flaggedBot = Boolean(ua && isbot(ua));
  const browserAnon = BROWSER_ANON.test(String(anonId || ''));
  const fromOurSite = isOurSite(referrer) || isOurSite(origin);
  const isBrowser = !flaggedBot && (browserAnon || fromOurSite);
  return {
    ua,
    isBot: flaggedBot || !isBrowser,
    clientKind: isBrowser ? 'browser' : 'api',
  };
};
