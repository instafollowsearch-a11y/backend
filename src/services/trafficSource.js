/**
 * First-party traffic buckets from UTM + referrer. No third-party APIs.
 */

const clip = (value, max = 128) => {
  if (value == null || value === '') return null;
  return String(value).slice(0, max);
};

const hostFromReferrer = (referrer) => {
  try {
    if (!referrer) return '';
    return new URL(String(referrer)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Map UTM + referrer URL to a display bucket (Instagram, TikTok, Google search, …).
 */
export const resolveTrafficSource = ({
  utmSource = null,
  utmMedium = null,
  referrer = null,
} = {}) => {
  const src = String(utmSource || '').toLowerCase().trim();
  const medium = String(utmMedium || '').toLowerCase().trim();
  const host = hostFromReferrer(referrer);
  if (
    src.includes('instagram') ||
    src === 'ig' ||
    host.includes('instagram.com')
  ) {
    return 'Instagram';
  }
  if (src.includes('tiktok') || host.includes('tiktok.com')) return 'TikTok';
  if (
    src.includes('google') ||
    host.includes('google.') ||
    host === 'google.com' ||
    (medium === 'organic' && (!src || src.includes('google')))
  ) {
    return 'Google search';
  }
  if (
    src.includes('facebook') ||
    src === 'fb' ||
    src.includes('meta') ||
    host.includes('facebook.com') ||
    host.includes('fb.com') ||
    host.includes('l.facebook.com')
  ) {
    return 'Facebook';
  }
  if (src) return clip(utmSource, 64);
  if (host) return host;
  return 'Direct / unknown';
};

/**
 * Postgres expression matching resolveTrafficSource for grouping existing rows.
 */
export const trafficSourceSql = () => `
  (
  CASE
    WHEN COALESCE(props->>'trafficSource', '') <> '' THEN props->>'trafficSource'
    WHEN LOWER(COALESCE(utm_source, '')) LIKE '%instagram%'
      OR LOWER(COALESCE(utm_source, '')) = 'ig'
      OR LOWER(COALESCE(props->>'referrerHost', '')) LIKE '%instagram.com%'
      THEN 'Instagram'
    WHEN LOWER(COALESCE(utm_source, '')) LIKE '%tiktok%'
      OR LOWER(COALESCE(props->>'referrerHost', '')) LIKE '%tiktok.com%'
      THEN 'TikTok'
    WHEN LOWER(COALESCE(utm_source, '')) LIKE '%google%'
      OR LOWER(COALESCE(props->>'referrerHost', '')) LIKE '%google.%'
      OR LOWER(COALESCE(utm_medium, '')) = 'organic'
      THEN 'Google search'
    WHEN LOWER(COALESCE(utm_source, '')) LIKE '%facebook%'
      OR LOWER(COALESCE(utm_source, '')) IN ('fb', 'meta')
      OR LOWER(COALESCE(props->>'referrerHost', '')) LIKE '%facebook.com%'
      OR LOWER(COALESCE(props->>'referrerHost', '')) LIKE '%fb.com%'
      THEN 'Facebook'
    WHEN COALESCE(utm_source, '') <> '' THEN LEFT(utm_source, 64)
    WHEN COALESCE(props->>'referrerHost', '') <> '' THEN props->>'referrerHost'
    ELSE 'Direct / unknown'
  END
  )
`;

export const sanitizeReferrer = (referrer) => clip(referrer, 512);

export const referrerHostOf = (referrer) => {
  const host = hostFromReferrer(referrer);
  return host ? clip(host, 128) : null;
};
