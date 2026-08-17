import { getClientIp } from '../services/geoLookup.js';
import { isIpBlocked } from '../services/blockedIpService.js';

const isExemptPath = (path = '') =>
  path === '/health' ||
  path === '/admin' ||
  path === '/admin.js' ||
  path === '/admin.html' ||
  path.startsWith('/api/admin') ||
  path.startsWith('/api/payment/webhook');

/**
 * Deny product API access for denylisted client IPs.
 * Admin, health, and Stripe webhooks stay reachable.
 */
export const ipBlockMiddleware = async (req, res, next) => {
  try {
    if (req.method === 'OPTIONS') return next();
    if (isExemptPath(req.path || '')) return next();
    const ip = getClientIp(req);
    if (await isIpBlocked(ip)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied.',
      });
    }
    return next();
  } catch (error) {
    console.error('ipBlockMiddleware:', error.message);
    return next();
  }
};
