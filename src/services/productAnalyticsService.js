import AnalyticsEvent from '../models/AnalyticsEvent.js';
import { classifyClient } from './clientKind.js';
import { anonIdFromIp, lookupGeoFromIp, sanitizeClientIp } from './geoLookup.js';
import {
  referrerHostOf,
  resolveTrafficSource,
  sanitizeReferrer,
} from './trafficSource.js';

export const ALLOWED_EVENTS = new Set([
  'page_view',
  'search',
  'shared_activity',
  'admirers',
  'view_profile',
  'story_viewer',
  'story_viewer_search',
  'upgrade_cta',
  'checkout_started',
  'feature_click',
]);

const MAIN_SITE_URL = (
  process.env.FRONTEND_URL || 'https://instafollowcheck.com'
).replace(/\/$/, '');
const STORY_SITE_URL = (
  process.env.STORY_VIEWER_PUBLIC_URL || 'https://freeinstagramstoryviewer.com'
).replace(/\/$/, '');

/**
 * Resolve human site label + full URL for admin activity.
 */
export const resolveEventSiteMeta = ({ event, path, props = {} } = {}) => {
  if (props.siteUrl) {
    return {
      site:
        props.siteLabel ||
        (String(props.siteUrl).includes('story')
          ? 'Story viewer site'
          : 'Main site'),
      siteKey: props.site || 'custom',
      url: String(props.siteUrl),
    };
  }
  const isStory =
    event === 'story_viewer' ||
    event === 'story_viewer_search' ||
    props.site === 'story_viewer' ||
    path === '/story-viewer';
  if (isStory) {
    const pagePath = path && path !== '/story-viewer' ? path : '/';
    return {
      site: 'Story viewer site',
      siteKey: 'story_viewer',
      url: `${STORY_SITE_URL}${pagePath === '/' ? '' : pagePath}`,
    };
  }
  const pagePath = path || props.path || '/';
  return {
    site: 'Main site (InstaFollowCheck)',
    siteKey: 'main',
    url: `${MAIN_SITE_URL}${pagePath.startsWith('/') ? pagePath : `/${pagePath}`}`,
  };
};

/**
 * Merge first-party attribution onto event props.
 */
const withTrafficProps = (props, { utmSource, utmMedium, referrer }) => {
  const ref = sanitizeReferrer(referrer || props.referrer || null);
  const utmS = utmSource || props.utmSource || null;
  const utmM = utmMedium || props.utmMedium || null;
  return {
    ...props,
    referrer: ref,
    referrerHost: referrerHostOf(ref),
    trafficSource: resolveTrafficSource({
      utmSource: utmS,
      utmMedium: utmM,
      referrer: ref,
    }),
  };
};

/**
 * Persist one analytics event (best-effort).
 */
export const emitAnalyticsEvent = async ({
  event,
  path = null,
  userId = null,
  anonId = null,
  props = {},
  utmSource = null,
  utmMedium = null,
  utmCampaign = null,
  referrer = null,
  ts = null,
  site = null,
  clientIp = null,
  userAgent = null,
  origin = null,
  cfCountry = null,
}) => {
  if (!event || !ALLOWED_EVENTS.has(event)) return null;
  try {
    const meta = resolveEventSiteMeta({
      event,
      path,
      props: { ...props, site: site || props.site },
    });
    const kind = classifyClient({
      userAgent,
      anonId,
      referrer,
      origin,
    });
    const mergedProps = withTrafficProps(
      {
        ...(props && typeof props === 'object' ? props : {}),
        site: site || props.site || meta.siteKey,
        siteLabel: meta.site,
        siteUrl: meta.url,
        ua: kind.ua,
        isBot: kind.isBot,
        clientKind: kind.clientKind,
      },
      { utmSource, utmMedium, referrer }
    );
    const geo = lookupGeoFromIp(clientIp, { cfCountry });
    const resolvedAnon = anonId || anonIdFromIp(clientIp);
    const storedIp = sanitizeClientIp(clientIp);
    const storedUa = kind.ua;
    const storedOrigin = origin ? String(origin).slice(0, 512) : null;
    return await AnalyticsEvent.create({
      event,
      path: path ? String(path).slice(0, 512) : null,
      userId: userId || null,
      anonId: resolvedAnon ? String(resolvedAnon).slice(0, 64) : null,
      clientIp: storedIp,
      userAgent: storedUa,
      requestOrigin: storedOrigin,
      props: {
        ...mergedProps,
        clientIp: storedIp,
        origin: storedOrigin,
      },
      utmSource: utmSource ? String(utmSource).slice(0, 128) : null,
      utmMedium: utmMedium ? String(utmMedium).slice(0, 128) : null,
      utmCampaign: utmCampaign ? String(utmCampaign).slice(0, 128) : null,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      ts: ts ? new Date(ts) : new Date(),
    });
  } catch (error) {
    console.error('analytics emit failed:', error.message);
    return null;
  }
};

/**
 * Batch insert validated events.
 */
export const ingestAnalyticsEvents = async (
  events,
  { userId = null, clientIp = null, userAgent = null, origin = null, cfCountry = null } = {}
) => {
  const rows = [];
  const geo = lookupGeoFromIp(clientIp, { cfCountry });
  for (const raw of events || []) {
    if (!raw || !ALLOWED_EVENTS.has(raw.event)) continue;
    const baseProps =
      raw.props && typeof raw.props === 'object' ? { ...raw.props } : {};
    if (raw.site && !baseProps.site) baseProps.site = raw.site;
    if (raw.url && !baseProps.siteUrl) baseProps.siteUrl = raw.url;
    if (raw.siteUrl && !baseProps.siteUrl) baseProps.siteUrl = raw.siteUrl;
    const meta = resolveEventSiteMeta({
      event: raw.event,
      path: raw.path,
      props: baseProps,
    });
    const utmSource = raw.utmSource || raw.utm_source || null;
    const utmMedium = raw.utmMedium || raw.utm_medium || null;
    const utmCampaign = raw.utmCampaign || raw.utm_campaign || null;
    const referrer = raw.referrer || baseProps.referrer || null;
    const resolvedAnon = raw.anonId || anonIdFromIp(clientIp);
    const kind = classifyClient({
      userAgent,
      anonId: raw.anonId || null,
      referrer,
      origin,
    });
    const storedIp = sanitizeClientIp(clientIp);
    const storedOrigin = origin ? String(origin).slice(0, 512) : null;
    rows.push({
      event: raw.event,
      path: raw.path ? String(raw.path).slice(0, 512) : null,
      userId: userId || raw.userId || null,
      anonId: resolvedAnon ? String(resolvedAnon).slice(0, 64) : null,
      clientIp: storedIp,
      userAgent: kind.ua,
      requestOrigin: storedOrigin,
      props: withTrafficProps(
        {
          ...baseProps,
          site: baseProps.site || meta.siteKey,
          siteLabel: baseProps.siteLabel || meta.site,
          siteUrl: baseProps.siteUrl || meta.url,
          ua: kind.ua,
          isBot: kind.isBot,
          clientKind: kind.clientKind,
          clientIp: storedIp,
          origin: storedOrigin,
        },
        { utmSource, utmMedium, referrer }
      ),
      utmSource: utmSource ? String(utmSource).slice(0, 128) : null,
      utmMedium: utmMedium ? String(utmMedium).slice(0, 128) : null,
      utmCampaign: utmCampaign ? String(utmCampaign).slice(0, 128) : null,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      ts: raw.ts ? new Date(raw.ts) : new Date(),
    });
  }
  if (!rows.length) return 0;
  await AnalyticsEvent.bulkCreate(rows);
  return rows.length;
};
