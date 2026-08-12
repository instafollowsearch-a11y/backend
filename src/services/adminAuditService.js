import AdminAuditLog from '../models/AdminAuditLog.js';

/**
 * Persist an admin action for the audit trail.
 * @param {{ actorLogin?: string, action: string, targetUserId?: string|null, payload?: object }} opts
 */
export const writeAdminAudit = async ({
  actorLogin = 'admin',
  action,
  targetUserId = null,
  payload = {},
}) => {
  try {
    await AdminAuditLog.create({
      actorLogin: actorLogin || 'admin',
      action,
      targetUserId,
      payload,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error('Failed to write admin audit log:', error.message);
  }
};
