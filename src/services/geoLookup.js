import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const geoip = require('geoip-lite');

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

const PRIVATE = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^localhost$/i,
];

const clip = (value, max) => {
  if (value == null || value === '') return null;
  return String(value).slice(0, max);
};

/**
 * Client IP from Cloudflare / proxy / Express (no raw IP stored).
 */
export const getClientIp = (req) => {
  const cf = req?.headers?.['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim().replace(/^::ffff:/, '');
  const ip = req?.ip || req?.socket?.remoteAddress || '';
  return String(ip).replace(/^::ffff:/, '').trim();
};

const isPrivateIp = (ip) => {
  if (!ip) return true;
  return PRIVATE.some((re) => re.test(ip));
};

const countryLabel = (code) => {
  if (!code) return null;
  try {
    return countryNames?.of(code) || code;
  } catch {
    return code;
  }
};

/**
 * Best-effort city / region / country from IP using a local GeoLite database.
 * Does not call an external API and does not persist the IP.
 */
export const lookupGeoFromIp = (ip) => {
  if (!ip || isPrivateIp(ip)) {
    return { country: null, region: null, city: null };
  }
  try {
    const hit = geoip.lookup(ip);
    if (!hit) return { country: null, region: null, city: null };
    return {
      country: clip(countryLabel(hit.country) || hit.country, 64),
      region: clip(hit.region, 64),
      city: clip(hit.city, 128),
    };
  } catch {
    return { country: null, region: null, city: null };
  }
};
