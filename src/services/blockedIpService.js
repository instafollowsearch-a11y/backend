import BlockedIp from '../models/BlockedIp.js';
import { sanitizeClientIp } from './geoLookup.js';
import { writeAdminAudit } from './adminAuditService.js';

const CACHE_MS = 15 * 1000;
let cache = { at: 0, set: new Set() };

const ipKey = (value) => {
  const ip = sanitizeClientIp(value);
  return ip ? ip.toLowerCase() : null;
};

const loadSet = async () => {
  const rows = await BlockedIp.findAll({ attributes: ['ip'], raw: true });
  const set = new Set();
  rows.forEach((row) => {
    const key = ipKey(row.ip);
    if (key) set.add(key);
  });
  cache = { at: Date.now(), set };
  return set;
};

export const refreshBlockedIpCache = async () => {
  await loadSet();
};

const getSet = async () => {
  if (Date.now() - cache.at < CACHE_MS && cache.set) return cache.set;
  return loadSet();
};

export const isIpBlocked = async (ip) => {
  const key = ipKey(ip);
  if (!key) return false;
  const set = await getSet();
  return set.has(key);
};

export const listBlockedIps = async () => {
  const rows = await BlockedIp.findAll({ order: [['created_at', 'DESC']] });
  return rows.map((row) => {
    const plain = row.toJSON();
    return {
      ...plain,
      ip: String(plain.ip || ''),
    };
  });
};

export const blockIp = async ({
  ip,
  reason = null,
  anonId = null,
  userId = null,
  actorLogin = 'admin',
}) => {
  const key = ipKey(ip);
  if (!key) {
    const err = new Error('Enter a valid IPv4 or IPv6 address.');
    err.status = 400;
    throw err;
  }
  const [row, created] = await BlockedIp.findOrCreate({
    where: { ip: key },
    defaults: {
      ip: key,
      reason: reason ? String(reason).slice(0, 500) : null,
      anonId: anonId ? String(anonId).slice(0, 64) : null,
      userId:
        userId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          String(userId)
        )
          ? userId
          : null,
      actorLogin: actorLogin || 'admin',
    },
  });
  await refreshBlockedIpCache();
  if (created) {
    await writeAdminAudit({
      actorLogin,
      action: 'block_ip',
      targetUserId: userId || null,
      payload: { ip: key, reason, anonId },
    });
  }
  return { ...row.toJSON(), ip: key, created };
};

export const unblockIp = async ({ ip, actorLogin = 'admin' }) => {
  const key = ipKey(ip);
  if (!key) {
    const err = new Error('Enter a valid IPv4 or IPv6 address.');
    err.status = 400;
    throw err;
  }
  const deleted = await BlockedIp.destroy({ where: { ip: key } });
  await refreshBlockedIpCache();
  if (deleted) {
    await writeAdminAudit({
      actorLogin,
      action: 'unblock_ip',
      payload: { ip: key },
    });
  }
  return deleted > 0;
};
