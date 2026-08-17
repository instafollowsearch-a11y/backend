import { createHash } from 'crypto';
import { existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const geoip = require('geoip-lite');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MMDB = path.join(__dirname, '../../data/GeoLite2-City.mmdb');
const MMDB_PATH = process.env.GEOLITE2_CITY_PATH || DEFAULT_MMDB;

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

const emptyGeo = () => ({ country: null, region: null, city: null });

/**
 * Client IP from Cloudflare / proxy / Express.
 */
export const getClientIp = (req) => {
  const cf = req?.headers?.['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim().replace(/^::ffff:/, '');
  const ip = req?.ip || req?.socket?.remoteAddress || '';
  return String(ip).replace(/^::ffff:/, '').trim();
};

/**
 * Keep only a single IPv4/IPv6 value for admin storage.
 */
export const sanitizeClientIp = (ip) => {
  const raw = String(ip || '')
    .trim()
    .replace(/^::ffff:/, '')
    .slice(0, 45);
  if (!raw) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return raw;
  if (/^[0-9a-f:]+$/i.test(raw) && raw.includes(':')) return raw;
  return null;
};

export const getCfCountry = (req) => {
  const code = String(req?.headers?.['cf-ipcountry'] || '').trim().toUpperCase();
  if (!code || code === 'XX' || code === 'T1') return null;
  return code;
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
 * Stable anonymous id from IP (hashed). Admin also stores raw IP on events.
 */
export const anonIdFromIp = (ip) => {
  if (!ip || isPrivateIp(ip)) return null;
  const salt = process.env.ANON_IP_SALT || 'instafollowcheck-anon';
  const digest = createHash('sha256')
    .update(`${salt}|${ip}`)
    .digest('hex')
    .slice(0, 24);
  return `ip_${digest}`;
};

let cityReader = null;
let maxmindTried = false;

const loadMaxmind = async () => {
  if (maxmindTried) return;
  maxmindTried = true;
  if (!existsSync(MMDB_PATH)) return;
  try {
    const maxmind = await import('maxmind');
    const open = maxmind.open || maxmind.default?.open || maxmind.default;
    cityReader = await open(MMDB_PATH);
    console.log('GeoLite2-City loaded from', MMDB_PATH);
  } catch (err) {
    console.warn('GeoLite2 open failed, using geoip-lite:', err.message);
    cityReader = null;
  }
};
void loadMaxmind();

const fromMaxmind = (ip) => {
  if (!cityReader) return null;
  try {
    const hit = cityReader.get(ip);
    if (!hit) return null;
    const iso = hit.country?.iso_code || hit.registered_country?.iso_code;
    const city = hit.city?.names?.en || null;
    const region =
      hit.subdivisions?.[0]?.iso_code ||
      hit.subdivisions?.[0]?.names?.en ||
      null;
    if (!iso && !city) return null;
    return {
      country: clip(countryLabel(iso) || iso, 64),
      region: clip(region, 64),
      city: clip(city, 128),
    };
  } catch {
    return null;
  }
};

const fromGeoipLite = (ip) => {
  try {
    const hit = geoip.lookup(ip);
    if (!hit) return emptyGeo();
    return {
      country: clip(countryLabel(hit.country) || hit.country, 64),
      region: clip(hit.region, 64),
      city: clip(hit.city, 128),
    };
  } catch {
    return emptyGeo();
  }
};

/**
 * Best-effort city / region / country from IP. GeoLite2 when present, else geoip-lite.
 * Optional cfCountry (Cloudflare CF-IPCountry) fills country if the DB misses.
 * Does not persist the IP.
 */
export const lookupGeoFromIp = (ip, { cfCountry = null } = {}) => {
  if (!ip || isPrivateIp(ip)) {
    if (cfCountry) {
      return { country: clip(countryLabel(cfCountry) || cfCountry, 64), region: null, city: null };
    }
    return emptyGeo();
  }
  const geo = fromMaxmind(ip) || fromGeoipLite(ip);
  if (!geo.country && cfCountry) {
    return {
      ...geo,
      country: clip(countryLabel(cfCountry) || cfCountry, 64),
    };
  }
  return geo;
};
