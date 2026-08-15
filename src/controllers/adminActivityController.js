import { Op, fn, col, literal } from 'sequelize';
import AnalyticsEvent from '../models/AnalyticsEvent.js';
import SearchHistory from '../models/SearchHistory.js';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import AdminAuditLog from '../models/AdminAuditLog.js';
import { countActiveSubscriptions } from '../services/localSubscriptionService.js';
import { resolveEventSiteMeta } from '../services/productAnalyticsService.js';
import { trafficSourceSql } from '../services/trafficSource.js';

const SEARCH_EVENTS = ['search', 'story_viewer_search'];

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const hoursAgo = (n) => new Date(Date.now() - n * 60 * 60 * 1000);

const parseDays = (raw, fallback = 7) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 90);
};

const parseHours = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(Math.floor(n), 24 * 90);
};

const startOfDay = (raw) => {
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  if (!m) d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (raw) => {
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  if (!m) d.setHours(23, 59, 59, 999);
  return d;
};

/**
 * Resolve activity window from ?hours=, ?days=, or ?from=&to= (YYYY-MM-DD).
 * Single day: set from=to (or only one of them).
 * Custom from/to stays calendar-day inclusive. hours/days are rolling.
 */
const parseActivityRange = (query = {}) => {
  const fromRaw = String(query.from || query.start || '').trim();
  const toRaw = String(query.to || query.end || '').trim();
  if (fromRaw || toRaw) {
    const from = startOfDay(fromRaw || toRaw);
    const to = endOfDay(toRaw || fromRaw);
    if (!from || !to) {
      return { error: 'Invalid from/to date. Use YYYY-MM-DD.' };
    }
    if (from > to) {
      return { error: 'from must be on or before to.' };
    }
    const maxMs = 366 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > maxMs) {
      return { error: 'Date range cannot exceed 366 days.' };
    }
    const rangeDays = Math.max(
      1,
      Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
    );
    const fromIso = from.toISOString().slice(0, 10);
    const toIso = to.toISOString().slice(0, 10);
    return {
      mode: 'custom',
      from,
      to,
      rangeDays,
      rangeLabel: fromIso === toIso ? fromIso : `${fromIso} → ${toIso}`,
      tsWhere: { [Op.gte]: from, [Op.lte]: to },
    };
  }
  const hours = parseHours(query.hours);
  if (hours != null) {
    const from = hoursAgo(hours);
    const to = new Date();
    return {
      mode: 'preset',
      from,
      to,
      rangeDays: Math.max(1, Math.ceil(hours / 24)),
      rangeLabel: hours === 24 ? 'Last 24 hours' : `Last ${hours} hours`,
      tsWhere: { [Op.gte]: from },
    };
  }
  const days = parseDays(query.days, 7);
  const from = daysAgo(days);
  const to = new Date();
  return {
    mode: 'preset',
    from,
    to,
    rangeDays: days,
    rangeLabel: days === 1 ? 'Last 24 hours' : `Last ${days} days`,
    tsWhere: { [Op.gte]: from },
  };
};

/**
 * Attach site label + full URL for admin UI (works for older rows too).
 */
const decorateEvent = (row) => {
  const plain = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
  const props = plain.props && typeof plain.props === 'object' ? plain.props : {};
  const meta = resolveEventSiteMeta({
    event: plain.event,
    path: plain.path,
    props,
  });
  return {
    ...plain,
    site: meta.site,
    siteKey: meta.siteKey,
    url: meta.url,
    props: {
      ...props,
      siteLabel: props.siteLabel || meta.site,
      siteUrl: props.siteUrl || meta.url,
      site: props.site || meta.siteKey,
    },
  };
};

/**
 * Distinct users/anons in a ts window. Pass a Sequelize ts filter (Op.gte / range).
 */
const countUniqueActors = async (tsWhere, extraWhere = {}) => {
  const rows = await AnalyticsEvent.findAll({
    attributes: [
      [fn('COUNT', literal("DISTINCT COALESCE(user_id::text, anon_id)")), 'cnt'],
    ],
    where: { ts: tsWhere, ...extraWhere },
    raw: true,
  });
  return Number(rows?.[0]?.cnt || 0);
};

const countEvent = async (event, tsWhere) =>
  AnalyticsEvent.count({
    where: { event, ts: tsWhere },
  });

const countEventsIn = async (events, tsWhere) =>
  AnalyticsEvent.count({
    where: { event: { [Op.in]: events }, ts: tsWhere },
  });

/**
 * GET /api/admin/activity/summary?hours=24 | ?days=7 | ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export const getActivitySummary = async (req, res) => {
  try {
    const range = parseActivityRange(req.query);
    if (range.error) {
      return res.status(400).json({ success: false, message: range.error });
    }
    const { tsWhere, rangeDays, rangeLabel, from, to, mode } = range;
    const since1 = daysAgo(1);
    const since30 = daysAgo(30);

    const [
      dau,
      wau,
      mau,
      eventsInRange,
      visitorsInRange,
      searchesInRange,
      uniqueSearchersInRange,
      activePaid,
      searches1d,
      searches7d,
      signups1d,
      signups7d,
      checkoutStarted,
      upgradeCtas,
      grants7d,
    ] = await Promise.all([
      countUniqueActors({ [Op.gte]: since1 }),
      countUniqueActors({ [Op.gte]: daysAgo(7) }),
      countUniqueActors({ [Op.gte]: since30 }),
      AnalyticsEvent.count({ where: { ts: tsWhere } }),
      countUniqueActors(tsWhere),
      countEventsIn(SEARCH_EVENTS, tsWhere),
      countUniqueActors(tsWhere, { event: { [Op.in]: SEARCH_EVENTS } }),
      countActiveSubscriptions(),
      SearchHistory.count({ where: { created_at: { [Op.gte]: since1 } } }),
      SearchHistory.count({ where: { created_at: { [Op.gte]: daysAgo(7) } } }),
      User.count({ where: { created_at: { [Op.gte]: since1 } } }),
      User.count({ where: { created_at: { [Op.gte]: daysAgo(7) } } }),
      countEvent('checkout_started', tsWhere),
      countEvent('upgrade_cta', tsWhere),
      AdminAuditLog.count({
        where: {
          action: { [Op.in]: ['grant_access', 'extend_access'] },
          createdAt: { [Op.gte]: daysAgo(7) },
        },
      }),
    ]);

    const featureEvents = [
      'search',
      'shared_activity',
      'admirers',
      'view_profile',
      'story_viewer',
      'story_viewer_search',
      'upgrade_cta',
      'checkout_started',
      'page_view',
    ];
    const featureUsage = [];
    for (const event of featureEvents) {
      const count = await countEvent(event, tsWhere);
      if (count > 0 || ['search', 'checkout_started', 'page_view'].includes(event)) {
        featureUsage.push({ event, count });
      }
    }
    featureUsage.sort((a, b) => b.count - a.count);

    const topEventsRaw = await AnalyticsEvent.findAll({
      attributes: ['event', [fn('COUNT', col('id')), 'count']],
      where: { ts: tsWhere },
      group: ['event'],
      order: [[literal('count'), 'DESC']],
      limit: 20,
      raw: true,
    });

    const topPagesRaw = await AnalyticsEvent.findAll({
      attributes: ['path', [fn('COUNT', col('id')), 'count']],
      where: {
        ts: tsWhere,
        event: 'page_view',
        path: { [Op.ne]: null },
      },
      group: ['path'],
      order: [[literal('count'), 'DESC']],
      limit: 20,
      raw: true,
    });

    const funnelSteps = [
      'page_view',
      'search',
      'shared_activity',
      'admirers',
      'view_profile',
      'upgrade_cta',
      'checkout_started',
    ];
    const funnel = [];
    for (const step of funnelSteps) {
      funnel.push({ step, count: await countEvent(step, tsWhere) });
    }
    const pageViewsInRange =
      funnel.find((step) => step.step === 'page_view')?.count ?? 0;

    const dailySeriesRaw = await AnalyticsEvent.findAll({
      attributes: [
        [fn('DATE', col('ts')), 'day'],
        [fn('COUNT', col('id')), 'count'],
      ],
      where: { ts: tsWhere },
      group: [fn('DATE', col('ts'))],
      order: [[fn('DATE', col('ts')), 'ASC']],
      raw: true,
    });

    const signupSeriesRaw = await User.findAll({
      attributes: [
        [fn('DATE', col('created_at')), 'day'],
        [fn('COUNT', col('id')), 'count'],
      ],
      where: { created_at: tsWhere },
      group: [fn('DATE', col('created_at'))],
      order: [[fn('DATE', col('created_at')), 'ASC']],
      raw: true,
    });

    const planMixRaw = await Subscription.findAll({
      attributes: ['plan', [fn('COUNT', col('id')), 'count']],
      where: {
        status: 'active',
        endDate: { [Op.gt]: new Date() },
      },
      group: ['plan'],
      raw: true,
    });

    const recentEvents = await AnalyticsEvent.findAll({
      where: { ts: tsWhere },
      order: [['ts', 'DESC']],
      limit: 40,
    });

    const recentAudits = await AdminAuditLog.findAll({
      order: [['created_at', 'DESC']],
      limit: 20,
    });

    const topSearchTargets = await SearchHistory.findAll({
      attributes: [
        'targetUsername',
        [fn('COUNT', col('id')), 'count'],
      ],
      where: { created_at: tsWhere },
      group: ['targetUsername'],
      order: [[literal('count'), 'DESC']],
      limit: 15,
      raw: true,
    });

    const sourceExpr = literal(trafficSourceSql());
    const trafficSourcesRaw = await AnalyticsEvent.findAll({
      attributes: [
        [sourceExpr, 'source'],
        [fn('COUNT', col('id')), 'pageViews'],
        [fn('COUNT', literal("DISTINCT COALESCE(user_id::text, anon_id)")), 'visitors'],
      ],
      where: {
        ts: tsWhere,
        event: 'page_view',
      },
      group: [sourceExpr],
      order: [[literal('visitors'), 'DESC']],
      limit: 20,
      raw: true,
    });

    const visitorCountriesRaw = await AnalyticsEvent.findAll({
      attributes: [
        'country',
        [fn('COUNT', col('id')), 'pageViews'],
        [fn('COUNT', literal("DISTINCT COALESCE(user_id::text, anon_id)")), 'visitors'],
      ],
      where: {
        ts: tsWhere,
        event: 'page_view',
        country: { [Op.ne]: null },
      },
      group: ['country'],
      order: [[literal('visitors'), 'DESC']],
      limit: 20,
      raw: true,
    });

    const visitorCitiesRaw = await AnalyticsEvent.findAll({
      attributes: [
        'city',
        'region',
        'country',
        [fn('COUNT', col('id')), 'pageViews'],
        [fn('COUNT', literal("DISTINCT COALESCE(user_id::text, anon_id)")), 'visitors'],
      ],
      where: {
        ts: tsWhere,
        event: 'page_view',
        city: { [Op.ne]: null },
      },
      group: ['city', 'region', 'country'],
      order: [[literal('visitors'), 'DESC']],
      limit: 20,
      raw: true,
    });

    return res.json({
      success: true,
      data: {
        rangeMode: mode,
        rangeDays,
        rangeLabel,
        rangeFrom: from.toISOString(),
        rangeTo: to.toISOString(),
        dau,
        wau,
        mau,
        eventsInRange,
        events7d: eventsInRange,
        visitorsInRange,
        pageViewsInRange,
        searchesInRange,
        uniqueSearchersInRange,
        activePaid,
        searches1d,
        searches7d,
        signups1d,
        signups7d,
        checkoutStarted,
        upgradeCtas,
        grants7d,
        featureUsage,
        topEvents: topEventsRaw.map((r) => ({
          event: r.event,
          count: Number(r.count),
        })),
        topPages: topPagesRaw.map((r) => {
          const meta = resolveEventSiteMeta({ path: r.path, event: 'page_view' });
          return {
            path: r.path,
            site: meta.site,
            url: meta.url,
            count: Number(r.count),
          };
        }),
        funnel,
        dailySeries: dailySeriesRaw.map((r) => ({
          day: r.day,
          count: Number(r.count),
        })),
        signupSeries: signupSeriesRaw.map((r) => ({
          day: r.day,
          count: Number(r.count),
        })),
        planMix: planMixRaw.map((r) => ({
          plan: r.plan,
          count: Number(r.count),
        })),
        topSearchTargets: topSearchTargets.map((r) => ({
          username: r.targetUsername,
          count: Number(r.count),
        })),
        trafficSources: trafficSourcesRaw.map((r) => ({
          source: r.source || 'Direct / unknown',
          visitors: Number(r.visitors),
          pageViews: Number(r.pageViews),
          count: Number(r.visitors),
        })),
        visitorCountries: visitorCountriesRaw.map((r) => ({
          source: r.country,
          visitors: Number(r.visitors),
          pageViews: Number(r.pageViews),
          count: Number(r.visitors),
        })),
        visitorCities: visitorCitiesRaw.map((r) => {
          const label = [r.city, r.region, r.country].filter(Boolean).join(', ');
          return {
            source: label,
            visitors: Number(r.visitors),
            pageViews: Number(r.pageViews),
            count: Number(r.visitors),
          };
        }),
        recentEvents: recentEvents.map(decorateEvent),
        recentAudits,
      },
    });
  } catch (error) {
    console.error('getActivitySummary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load activity summary',
    });
  }
};

/**
 * GET /api/admin/activity/events?limit=&event=&hours=24 | ?days= | &from=&to=
 */
export const getRecentEvents = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const range = parseActivityRange(req.query);
    if (range.error) {
      return res.status(400).json({ success: false, message: range.error });
    }
    const event = req.query.event || '';
    const where = { ts: range.tsWhere };
    if (event) where.event = event;

    const [events, total] = await Promise.all([
      AnalyticsEvent.findAll({
        where,
        order: [['ts', 'DESC']],
        limit,
      }),
      AnalyticsEvent.count({ where }),
    ]);
    return res.json({
      success: true,
      data: {
        events: events.map(decorateEvent),
        total,
        limit,
        rangeLabel: range.rangeLabel,
        rangeFrom: range.from.toISOString(),
        rangeTo: range.to.toISOString(),
      },
    });
  } catch (error) {
    console.error('getRecentEvents error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load events',
    });
  }
};

/**
 * GET /api/admin/activity/users/:userId
 */
export const getUserActivityTimeline = async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const events = await AnalyticsEvent.findAll({
      where: { userId },
      order: [['ts', 'DESC']],
      limit,
    });
    return res.json({
      success: true,
      data: { events: events.map(decorateEvent) },
    });
  } catch (error) {
    console.error('getUserActivityTimeline error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load user activity',
    });
  }
};
