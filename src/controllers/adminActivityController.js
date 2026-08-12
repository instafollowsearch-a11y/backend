import { Op, fn, col, literal } from 'sequelize';
import AnalyticsEvent from '../models/AnalyticsEvent.js';
import SearchHistory from '../models/SearchHistory.js';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import AdminAuditLog from '../models/AdminAuditLog.js';
import { countActiveSubscriptions } from '../services/localSubscriptionService.js';

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const parseDays = (raw, fallback = 7) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 90);
};

/**
 * Distinct active users/anons in window.
 */
const countUniqueActors = async (since) => {
  const rows = await AnalyticsEvent.findAll({
    attributes: [
      [fn('COUNT', literal("DISTINCT COALESCE(user_id::text, anon_id)")), 'cnt'],
    ],
    where: { ts: { [Op.gte]: since } },
    raw: true,
  });
  return Number(rows?.[0]?.cnt || 0);
};

const countEvent = async (event, since) =>
  AnalyticsEvent.count({
    where: { event, ts: { [Op.gte]: since } },
  });

/**
 * GET /api/admin/activity/summary?days=7
 */
export const getActivitySummary = async (req, res) => {
  try {
    const days = parseDays(req.query.days, 7);
    const since = daysAgo(days);
    const since1 = daysAgo(1);
    const since30 = daysAgo(30);

    const [
      dau,
      wau,
      mau,
      eventsInRange,
      activePaid,
      searches1d,
      searches7d,
      signups1d,
      signups7d,
      checkoutStarted,
      upgradeCtas,
      grants7d,
    ] = await Promise.all([
      countUniqueActors(since1),
      countUniqueActors(daysAgo(7)),
      countUniqueActors(since30),
      AnalyticsEvent.count({ where: { ts: { [Op.gte]: since } } }),
      countActiveSubscriptions(),
      SearchHistory.count({ where: { created_at: { [Op.gte]: since1 } } }),
      SearchHistory.count({ where: { created_at: { [Op.gte]: daysAgo(7) } } }),
      User.count({ where: { created_at: { [Op.gte]: since1 } } }),
      User.count({ where: { created_at: { [Op.gte]: daysAgo(7) } } }),
      countEvent('checkout_started', since),
      countEvent('upgrade_cta', since),
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
      const count = await countEvent(event, since);
      if (count > 0 || ['search', 'checkout_started', 'page_view'].includes(event)) {
        featureUsage.push({ event, count });
      }
    }
    featureUsage.sort((a, b) => b.count - a.count);

    const topEventsRaw = await AnalyticsEvent.findAll({
      attributes: ['event', [fn('COUNT', col('id')), 'count']],
      where: { ts: { [Op.gte]: since } },
      group: ['event'],
      order: [[literal('count'), 'DESC']],
      limit: 20,
      raw: true,
    });

    const topPagesRaw = await AnalyticsEvent.findAll({
      attributes: ['path', [fn('COUNT', col('id')), 'count']],
      where: {
        ts: { [Op.gte]: since },
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
      funnel.push({ step, count: await countEvent(step, since) });
    }

    const dailySeriesRaw = await AnalyticsEvent.findAll({
      attributes: [
        [fn('DATE', col('ts')), 'day'],
        [fn('COUNT', col('id')), 'count'],
      ],
      where: { ts: { [Op.gte]: since } },
      group: [fn('DATE', col('ts'))],
      order: [[fn('DATE', col('ts')), 'ASC']],
      raw: true,
    });

    const signupSeriesRaw = await User.findAll({
      attributes: [
        [fn('DATE', col('created_at')), 'day'],
        [fn('COUNT', col('id')), 'count'],
      ],
      where: { created_at: { [Op.gte]: since } },
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
      where: { created_at: { [Op.gte]: since } },
      group: ['targetUsername'],
      order: [[literal('count'), 'DESC']],
      limit: 15,
      raw: true,
    });

    return res.json({
      success: true,
      data: {
        rangeDays: days,
        dau,
        wau,
        mau,
        eventsInRange,
        events7d: eventsInRange,
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
        topPages: topPagesRaw.map((r) => ({
          path: r.path,
          count: Number(r.count),
        })),
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
        recentEvents,
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
 * GET /api/admin/activity/events?limit=&event=&days=
 */
export const getRecentEvents = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const days = parseDays(req.query.days, 7);
    const event = req.query.event || '';
    const where = { ts: { [Op.gte]: daysAgo(days) } };
    if (event) where.event = event;

    const events = await AnalyticsEvent.findAll({
      where,
      order: [['ts', 'DESC']],
      limit,
    });
    return res.json({ success: true, data: { events } });
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
    return res.json({ success: true, data: { events } });
  } catch (error) {
    console.error('getUserActivityTimeline error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load user activity',
    });
  }
};
