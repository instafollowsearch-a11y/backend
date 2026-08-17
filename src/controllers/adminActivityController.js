import { Op, fn, col, literal, QueryTypes } from 'sequelize';
import AnalyticsEvent from '../models/AnalyticsEvent.js';
import SearchHistory from '../models/SearchHistory.js';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import AdminAuditLog from '../models/AdminAuditLog.js';
import { sequelize } from '../config/database.js';
import { countActiveSubscriptions } from '../services/localSubscriptionService.js';
import { resolveEventSiteMeta } from '../services/productAnalyticsService.js';
import { trafficSourceSql } from '../services/trafficSource.js';

const SEARCH_EVENTS = ['search', 'story_viewer_search'];
/** Landing + story loads — what the client sees as “pages / visits”. */
const VISIT_EVENTS = ['page_view', 'story_viewer'];
const LOCATION_EVENTS_ALL = [
  'page_view',
  'search',
  'story_viewer_search',
  'story_viewer',
];

const parseIncludeBots = (query = {}) => {
  const raw = String(query.includeBots || query.bots || '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'all';
};

const peopleVisitSql = (includeBots) => {
  const listed = LOCATION_EVENTS_ALL.map((e) => `'${e}'`).join(',');
  if (includeBots) return `event IN (${listed})`;
  return `(
    event IN ('page_view','search','story_viewer_search')
    OR (event = 'story_viewer' AND COALESCE(props->>'clientKind','') = 'browser')
  )`;
};

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
    clientIp: plain.clientIp || plain.client_ip || props.clientIp || null,
    userAgent: plain.userAgent || plain.user_agent || props.ua || null,
    requestOrigin: plain.requestOrigin || plain.request_origin || props.origin || null,
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
    const includeBots = parseIncludeBots(req.query);
    const locationWhere = {
      ts: tsWhere,
      [Op.and]: [literal(peopleVisitSql(includeBots))],
    };
    const since1 = daysAgo(1);
    const since30 = daysAgo(30);

    const [
      dau,
      wau,
      mau,
      eventsInRange,
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
    ] = await Promise.all([
      countUniqueActors({ [Op.gte]: since1 }),
      countUniqueActors({ [Op.gte]: daysAgo(7) }),
      countUniqueActors({ [Op.gte]: since30 }),
      AnalyticsEvent.count({ where: { ts: tsWhere } }),
      countUniqueActors(tsWhere),
      countEventsIn(VISIT_EVENTS, tsWhere),
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
    const visitWhere = {
      ts: tsWhere,
      event: { [Op.in]: VISIT_EVENTS },
    };
    const sourceExpr = literal(trafficSourceSql());
    const [
      featureCounts,
      topEventsRaw,
      topPagesRaw,
      trafficSourcesRaw,
      visitorCountriesRaw,
      visitorCitiesRaw,
    ] = await Promise.all([
      Promise.all(featureEvents.map((event) => countEvent(event, tsWhere))),
      AnalyticsEvent.findAll({
        attributes: ['event', [fn('COUNT', col('id')), 'count']],
        where: { ts: tsWhere },
        group: ['event'],
        order: [[literal('count'), 'DESC']],
        limit: 20,
        raw: true,
      }),
      AnalyticsEvent.findAll({
        attributes: ['path', [fn('COUNT', col('id')), 'count']],
        where: {
          ...visitWhere,
          path: { [Op.ne]: null },
        },
        group: ['path'],
        order: [[literal('count'), 'DESC']],
        limit: 20,
        raw: true,
      }),
      AnalyticsEvent.findAll({
        attributes: [
          [sourceExpr, 'source'],
          [fn('COUNT', col('id')), 'pageViews'],
          [fn('COUNT', literal("DISTINCT COALESCE(user_id::text, anon_id)")), 'visitors'],
        ],
        where: locationWhere,
        group: [sourceExpr],
        order: [[literal('visitors'), 'DESC']],
        limit: 20,
        raw: true,
      }),
      AnalyticsEvent.findAll({
        attributes: [
          'country',
          [fn('COUNT', col('id')), 'pageViews'],
          [fn('COUNT', literal("DISTINCT COALESCE(user_id::text, anon_id)")), 'visitors'],
        ],
        where: {
          ...locationWhere,
          country: { [Op.ne]: null },
        },
        group: ['country'],
        order: [[literal('visitors'), 'DESC']],
        limit: 20,
        raw: true,
      }),
      AnalyticsEvent.findAll({
        attributes: [
          'city',
          'region',
          'country',
          [fn('COUNT', col('id')), 'pageViews'],
          [fn('COUNT', literal("DISTINCT COALESCE(user_id::text, anon_id)")), 'visitors'],
        ],
        where: {
          ...locationWhere,
          city: { [Op.ne]: null },
        },
        group: ['city', 'region', 'country'],
        order: [[literal('visitors'), 'DESC']],
        limit: 20,
        raw: true,
      }),
    ]);
    const featureUsage = featureEvents
      .map((event, i) => ({ event, count: featureCounts[i] }))
      .filter(
        (row) =>
          row.count > 0 ||
          ['search', 'checkout_started', 'page_view', 'story_viewer'].includes(row.event)
      )
      .sort((a, b) => b.count - a.count);

    const funnel = [
      { step: 'visit', count: pageViewsInRange },
      { step: 'search', count: searchesInRange },
      { step: 'shared_activity', count: await countEvent('shared_activity', tsWhere) },
      { step: 'admirers', count: await countEvent('admirers', tsWhere) },
      { step: 'view_profile', count: await countEvent('view_profile', tsWhere) },
      { step: 'upgrade_cta', count: upgradeCtas },
      { step: 'checkout_started', count: checkoutStarted },
    ];

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

    return res.json({
      success: true,
      data: {
        rangeMode: mode,
        rangeDays,
        rangeLabel,
        includeBots,
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
          const meta = resolveEventSiteMeta({
            path: r.path,
            event: r.path === '/story-viewer' ? 'story_viewer' : 'page_view',
          });
          return {
            path: r.path === '/story-viewer' ? '/' : r.path,
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
        trafficSources: trafficSourcesRaw.map((r) => {
          const pageViews = Number(r.pageViews);
          const visitors = Number(r.visitors);
          return {
            source: r.source || 'Direct / unknown',
            visitors,
            pageViews,
            count: includeBots ? pageViews || visitors : visitors || pageViews,
          };
        }),
        visitorCountries: visitorCountriesRaw.map((r) => {
          const pageViews = Number(r.pageViews);
          const visitors = Number(r.visitors);
          return {
            source: r.country,
            country: r.country,
            visitors,
            pageViews,
            count: includeBots ? pageViews || visitors : visitors || pageViews,
          };
        }),
        visitorCities: visitorCitiesRaw.map((r) => {
          const label = [r.city, r.region, r.country].filter(Boolean).join(', ');
          const pageViews = Number(r.pageViews);
          const visitors = Number(r.visitors);
          return {
            source: label,
            city: r.city,
            country: r.country,
            visitors,
            pageViews,
            count: includeBots ? pageViews || visitors : visitors || pageViews,
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

const personScopeSql = (scope, includeBots) => {
  if (scope === 'searches') return `event IN ('search','story_viewer_search')`;
  if (scope === 'visits') return peopleVisitSql(includeBots);
  return 'TRUE';
};

const extraPeopleFiltersSql = ({ country, city, q }) => {
  const parts = [];
  if (country) parts.push('AND country = :country');
  if (city) parts.push('AND city = :city');
  if (q) {
    parts.push(`AND (
      COALESCE(user_id::text, '') ILIKE :qLike
      OR COALESCE(anon_id, '') ILIKE :qLike
      OR COALESCE(client_ip::text, '') ILIKE :qLike
      OR COALESCE(user_agent, '') ILIKE :qLike
    )`);
  }
  return parts.join('\n');
};

/**
 * GET /api/admin/activity/people
 */
export const listActivityPeople = async (req, res) => {
  try {
    const range = parseActivityRange(req.query);
    if (range.error) {
      return res.status(400).json({ success: false, message: range.error });
    }
    const includeBots = parseIncludeBots(req.query);
    const scopeRaw = String(req.query.scope || 'all').toLowerCase();
    const scope = ['all', 'visits', 'searches'].includes(scopeRaw)
      ? scopeRaw
      : 'all';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = (page - 1) * limit;
    const country = String(req.query.country || '').trim() || null;
    const city = String(req.query.city || '').trim() || null;
    const q = String(req.query.q || req.query.search || '').trim() || null;
    const scopeSql = personScopeSql(scope, includeBots);
    const extraSql = extraPeopleFiltersSql({ country, city, q });
    const replacements = {
      from: range.from,
      to: range.to,
      limit,
      offset,
      country,
      city,
      qLike: q ? `%${q}%` : null,
    };
    const whereSql = `
      ts >= :from AND ts <= :to
      AND COALESCE(user_id::text, anon_id) IS NOT NULL
      AND (${scopeSql})
      ${extraSql}
    `;
    const [countRows, peopleRows] = await Promise.all([
      sequelize.query(
        `SELECT COUNT(*)::int AS cnt FROM (
           SELECT DISTINCT COALESCE(user_id::text, anon_id) AS person_key
           FROM analytics_events
           WHERE ${whereSql}
         ) t`,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `WITH actors AS (
           SELECT
             COALESCE(user_id::text, anon_id) AS person_key,
             MAX(user_id::text) AS user_id,
             MAX(anon_id) AS anon_id,
             COUNT(*)::int AS event_count,
             COUNT(*) FILTER (WHERE event IN ('page_view','story_viewer'))::int AS visit_count,
             COUNT(*) FILTER (WHERE event IN ('search','story_viewer_search'))::int AS search_count,
             MIN(ts) AS first_seen,
             MAX(ts) AS last_seen,
             COUNT(DISTINCT client_ip::text) FILTER (WHERE client_ip IS NOT NULL)::int AS ip_count
           FROM analytics_events
           WHERE ${whereSql}
           GROUP BY 1
         ),
         latest AS (
           SELECT DISTINCT ON (COALESCE(user_id::text, anon_id))
             COALESCE(user_id::text, anon_id) AS person_key,
             client_ip::text AS client_ip,
             user_agent,
             request_origin,
             country,
             region,
             city,
             props->>'clientKind' AS client_kind,
             props->>'isBot' AS is_bot,
             event AS last_event
           FROM analytics_events
           WHERE ${whereSql}
           ORDER BY COALESCE(user_id::text, anon_id), ts DESC
         )
         SELECT a.*, l.client_ip, l.user_agent, l.request_origin, l.country, l.region, l.city,
                l.client_kind, l.is_bot, l.last_event
         FROM actors a
         JOIN latest l ON l.person_key = a.person_key
         ORDER BY a.last_seen DESC
         LIMIT :limit OFFSET :offset`,
        { replacements, type: QueryTypes.SELECT }
      ),
    ]);
    const total = Number(countRows?.[0]?.cnt || 0);
    const userIds = [
      ...new Set(peopleRows.map((r) => r.user_id).filter(Boolean)),
    ];
    const users = userIds.length
      ? await User.findAll({
          where: { id: { [Op.in]: userIds } },
          attributes: ['id', 'username', 'email', 'role', 'createdAt', 'lastLogin'],
        })
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.toJSON()]));
    const people = peopleRows.map((row) => {
      const userId = row.user_id || null;
      const anonId = row.anon_id || null;
      const kind = userId ? 'user' : 'anon';
      return {
        kind,
        personKey: userId ? `u/${userId}` : `a/${anonId}`,
        userId,
        anonId,
        account: userId ? userMap[userId] || null : null,
        eventCount: Number(row.event_count || 0),
        visitCount: Number(row.visit_count || 0),
        searchCount: Number(row.search_count || 0),
        ipCount: Number(row.ip_count || 0),
        clientIp: row.client_ip || null,
        userAgent: row.user_agent || null,
        requestOrigin: row.request_origin || null,
        country: row.country || null,
        region: row.region || null,
        city: row.city || null,
        clientKind: row.client_kind || null,
        isBot: row.is_bot === 'true' || row.is_bot === true,
        lastEvent: row.last_event || null,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
      };
    });
    return res.json({
      success: true,
      data: {
        people,
        pagination: {
          currentPage: page,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          totalItems: total,
          itemsPerPage: limit,
        },
        rangeLabel: range.rangeLabel,
        rangeFrom: range.from.toISOString(),
        rangeTo: range.to.toISOString(),
        includeBots,
        scope,
        country,
        city,
        q,
      },
    });
  } catch (error) {
    console.error('listActivityPeople error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load people',
    });
  }
};

/**
 * GET /api/admin/activity/people/:kind/:id
 * kind = u (registered user) | a (anonymous)
 */
export const getActivityPerson = async (req, res) => {
  try {
    const kind = String(req.params.kind || '').toLowerCase();
    const id = decodeURIComponent(String(req.params.id || '').trim());
    if (!id || !['u', 'a', 'user', 'anon'].includes(kind)) {
      return res.status(400).json({ success: false, message: 'Invalid person id' });
    }
    const isUser = kind === 'u' || kind === 'user';
    const where = isUser
      ? { userId: id }
      : { userId: null, anonId: id };
    const events = await AnalyticsEvent.findAll({
      where,
      order: [['ts', 'DESC']],
      limit: 250,
    });
    if (!events.length) {
      return res.status(404).json({ success: false, message: 'No events for this person' });
    }
    const decorated = events.map(decorateEvent);
    const ips = [
      ...new Set(
        decorated
          .map((e) => e.clientIp || e.props?.clientIp)
          .filter(Boolean)
          .map(String)
      ),
    ];
    const userAgents = [
      ...new Set(decorated.map((e) => e.userAgent).filter(Boolean)),
    ];
    const origins = [
      ...new Set(decorated.map((e) => e.requestOrigin).filter(Boolean)),
    ];
    const eventCounts = {};
    decorated.forEach((e) => {
      eventCounts[e.event] = (eventCounts[e.event] || 0) + 1;
    });
    let account = null;
    if (isUser) {
      account = await User.findByPk(id, {
        attributes: { exclude: ['password', 'passwordHash'] },
      });
    }
    const searchWhere = isUser
      ? { [Op.or]: [{ userId: id }, ...(ips.length ? [{ ipAddress: { [Op.in]: ips } }] : [])] }
      : ips.length
        ? { ipAddress: { [Op.in]: ips } }
        : null;
    const searches = searchWhere
      ? await SearchHistory.findAll({
            where: searchWhere,
            order: [['createdAt', 'DESC']],
            limit: 50,
            attributes: [
              'id',
              'targetUsername',
              'searchType',
              'ipAddress',
              'userAgent',
              'status',
              'createdAt',
              'userId',
            ],
          })
      : [];
    const latest = decorated[0];
    return res.json({
      success: true,
      data: {
        kind: isUser ? 'user' : 'anon',
        personKey: isUser ? `u/${id}` : `a/${id}`,
        userId: isUser ? id : null,
        anonId: isUser ? latest.anonId || null : id,
        account: account ? account.toJSON() : null,
        firstSeen: decorated[decorated.length - 1]?.ts,
        lastSeen: latest.ts,
        country: latest.country,
        region: latest.region,
        city: latest.city,
        clientKind: latest.props?.clientKind || null,
        isBot: Boolean(latest.props?.isBot),
        ips,
        userAgents,
        origins,
        eventCounts,
        events: decorated,
        searches,
        note:
          ips.length === 0
            ? 'Raw IP was not stored on older events. New visits record IP for this admin view.'
            : null,
      },
    });
  } catch (error) {
    console.error('getActivityPerson error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load person',
    });
  }
};
