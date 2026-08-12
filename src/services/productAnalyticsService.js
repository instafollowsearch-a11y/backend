import AnalyticsEvent from '../models/AnalyticsEvent.js';

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
  ts = null,
}) => {
  if (!event || !ALLOWED_EVENTS.has(event)) return null;
  try {
    return await AnalyticsEvent.create({
      event,
      path: path ? String(path).slice(0, 512) : null,
      userId: userId || null,
      anonId: anonId ? String(anonId).slice(0, 64) : null,
      props: props && typeof props === 'object' ? props : {},
      utmSource: utmSource ? String(utmSource).slice(0, 128) : null,
      utmMedium: utmMedium ? String(utmMedium).slice(0, 128) : null,
      utmCampaign: utmCampaign ? String(utmCampaign).slice(0, 128) : null,
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
export const ingestAnalyticsEvents = async (events, { userId = null } = {}) => {
  const rows = [];
  for (const raw of events || []) {
    if (!raw || !ALLOWED_EVENTS.has(raw.event)) continue;
    rows.push({
      event: raw.event,
      path: raw.path ? String(raw.path).slice(0, 512) : null,
      userId: userId || raw.userId || null,
      anonId: raw.anonId ? String(raw.anonId).slice(0, 64) : null,
      props: raw.props && typeof raw.props === 'object' ? raw.props : {},
      utmSource: raw.utmSource || raw.utm_source || null,
      utmMedium: raw.utmMedium || raw.utm_medium || null,
      utmCampaign: raw.utmCampaign || raw.utm_campaign || null,
      ts: raw.ts ? new Date(raw.ts) : new Date(),
    });
  }
  if (!rows.length) return 0;
  await AnalyticsEvent.bulkCreate(rows);
  return rows.length;
};
