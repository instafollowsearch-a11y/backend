import { ingestAnalyticsEvents } from '../services/productAnalyticsService.js';
import { getClientIp } from '../services/geoLookup.js';

const MAX_BATCH = 25;

/**
 * POST /api/events — public batch ingest (optionalAuth).
 */
export const postEvents = async (req, res) => {
  try {
    const body = req.body || {};
    const events = Array.isArray(body.events) ? body.events : [];
    if (!events.length) {
      return res.status(400).json({ success: false, message: 'events array required' });
    }
    if (events.length > MAX_BATCH) {
      return res.status(400).json({
        success: false,
        message: `Max ${MAX_BATCH} events per request`,
      });
    }

    const userId = req.user?.id || null;
    const count = await ingestAnalyticsEvents(events, {
      userId,
      clientIp: getClientIp(req),
    });
    return res.json({ success: true, ingested: count });
  } catch (error) {
    console.error('postEvents error:', error);
    return res.status(500).json({ success: false, message: 'Failed to ingest events' });
  }
};
