import {
  listBlockedIps,
  blockIp,
  unblockIp,
} from '../services/blockedIpService.js';

const actorOf = (req) => req.admin?.login || 'admin';

export const listBlocks = async (req, res) => {
  try {
    const blocks = await listBlockedIps();
    return res.json({ success: true, data: { blocks } });
  } catch (error) {
    console.error('listBlocks:', error);
    return res.status(500).json({ success: false, message: 'Failed to load blocks' });
  }
};

export const createBlock = async (req, res) => {
  try {
    const { ip, reason, anonId, userId } = req.body || {};
    const row = await blockIp({
      ip,
      reason,
      anonId,
      userId,
      actorLogin: actorOf(req),
    });
    return res.status(row.created ? 201 : 200).json({
      success: true,
      data: { block: row },
      message: row.created ? 'IP blocked' : 'IP was already blocked',
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to block IP',
    });
  }
};

export const removeBlock = async (req, res) => {
  try {
    const ip = req.params.ip || req.query.ip || req.body?.ip;
    const removed = await unblockIp({
      ip: decodeURIComponent(String(ip || '')),
      actorLogin: actorOf(req),
    });
    if (!removed) {
      return res.status(404).json({ success: false, message: 'IP is not blocked' });
    }
    return res.json({ success: true, message: 'IP unblocked' });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to unblock IP',
    });
  }
};
