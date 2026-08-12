import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import SearchHistory from '../models/SearchHistory.js';
import AdminAuditLog from '../models/AdminAuditLog.js';
import AnalyticsEvent from '../models/AnalyticsEvent.js';
import { Op } from 'sequelize';
import { sequelize } from '../config/database.js';
import {
  grantLocalSubscription,
  extendLocalSubscription,
  revokeLocalSubscriptions,
  countActiveSubscriptions,
} from '../services/localSubscriptionService.js';
import { getSearchesLimitForPlan } from '../services/stripePriceConfig.js';
import { writeAdminAudit } from '../services/adminAuditService.js';
import { getSubscription } from '../services/stripeService.js';
import { getActiveDbSubscriptionRow } from '../services/entitlementService.js';

// Get all users with pagination
export const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const role = req.query.role || '';

    const offset = (page - 1) * limit;

    let whereClause = {};
    
    if (search) {
      whereClause = {
        [Op.or]: [
          { username: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
          { first_name: { [Op.iLike]: `%${search}%` } },
          { last_name: { [Op.iLike]: `%${search}%` } }
        ]
      };
    }

    if (role) {
      whereClause.role = role;
    }

    const { count, rows: users } = await User.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Subscription,
          as: 'subscriptions',
          required: false
        }
      ],
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    const totalPages = Math.ceil(count / limit);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: page,
          totalPages,
          totalUsers: count,
          limit
        }
      }
    });
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while getting users'
    });
  }
};

// Get user by ID (detail drawer: local entitlement + Stripe read-only + search counts)
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id, {
      include: [
        {
          model: Subscription,
          as: 'subscriptions',
          required: false,
          order: [['created_at', 'DESC']],
        }
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const localEntitlement = await getActiveDbSubscriptionRow(id);
    const searchCount = await SearchHistory.count({ where: { userId: id } });
    const recentSearches = await SearchHistory.findAll({
      where: { userId: id },
      order: [['created_at', 'DESC']],
      limit: 10,
      attributes: ['id', 'targetUsername', 'searchType', 'created_at'],
    });

    let stripeStatus = null;
    if (user.stripeCustomerId) {
      try {
        const stripeResult = await getSubscription(user.stripeCustomerId);
        stripeStatus = stripeResult?.success
          ? stripeResult.data
          : { error: 'No active Stripe subscription' };
      } catch (err) {
        stripeStatus = { error: err.message };
      }
    }

    const recentAudits = await AdminAuditLog.findAll({
      where: { targetUserId: id },
      order: [['created_at', 'DESC']],
      limit: 20,
    });

    const activityTimeline = await AnalyticsEvent.findAll({
      where: { userId: id },
      order: [['ts', 'DESC']],
      limit: 40,
    });

    const allSubscriptions = await Subscription.findAll({
      where: { userId: id },
      order: [['created_at', 'DESC']],
      limit: 20,
    });

    res.json({
      success: true,
      data: {
        user,
        localEntitlement,
        stripeCustomerId: user.stripeCustomerId || null,
        stripeStatus,
        searchCount,
        recentSearches,
        recentAudits,
        activityTimeline,
        allSubscriptions,
      }
    });
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while getting user'
    });
  }
};

// Update user
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Allowed fields for update
    const allowedFields = [
      'username', 'email', 'first_name', 'last_name', 'role',
      'bio', 'website_url', 'email_notifications', 'marketing_emails',
      'theme', 'is_email_verified'
    ];

    const filteredData = {};
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        filteredData[field] = updateData[field];
      }
    });

    // ACL roles only — premium is entitlement via subscriptions, not role
    if (filteredData.role !== undefined) {
      const role = String(filteredData.role).toLowerCase();
      if (role === 'premium') {
        filteredData.role = 'user';
      } else if (role !== 'user' && role !== 'admin') {
        return res.status(400).json({
          success: false,
          message: 'Invalid role. Use user or admin.'
        });
      }
    }

    const before = { role: user.role };
    await user.update(filteredData);

    if (filteredData.role && filteredData.role !== before.role) {
      await writeAdminAudit({
        actorLogin: req.admin?.login,
        action: 'role_update',
        targetUserId: id,
        payload: { from: before.role, to: filteredData.role },
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user'
    });
  }
};

// Delete user
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await writeAdminAudit({
      actorLogin: req.admin?.login,
      action: 'user_delete',
      targetUserId: id,
      payload: { username: user.username, email: user.email },
    });

    // Delete related subscriptions
    await Subscription.destroy({
      where: { userId: id }
    });

    // Delete user
    await user.destroy();

    res.json({
      success: true,
      message: 'User and related subscriptions deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting user'
    });
  }
};

// Get user / ops statistics (overview strip)
export const getUserStats = async (req, res) => {
  try {
    const now = new Date();
    const d1 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const totalUsers = await User.count();
    const activeUsers = await User.count({
      where: { lastLogin: { [Op.gte]: d30 } },
    });
    const premiumUsers = await countActiveSubscriptions();
    const adminUsers = await User.count({ where: { role: 'admin' } });
    const recentUsers = await User.count({
      where: { created_at: { [Op.gte]: d7 } },
    });
    const signupsToday = await User.count({
      where: { created_at: { [Op.gte]: d1 } },
    });
    const searchesToday = await SearchHistory.count({
      where: { created_at: { [Op.gte]: d1 } },
    });
    const searches7d = await SearchHistory.count({
      where: { created_at: { [Op.gte]: d7 } },
    });
    const cancelledSubs = await Subscription.count({
      where: { status: 'cancelled' },
    });
    const expiringSoon = await Subscription.count({
      where: {
        status: 'active',
        endDate: {
          [Op.gt]: now,
          [Op.lte]: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    });
    const stripeLinkedUsers = await User.count({
      where: {
        stripeCustomerId: { [Op.ne]: null },
      },
    });
    const planMix = await Subscription.findAll({
      attributes: [
        'plan',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      where: {
        status: 'active',
        endDate: { [Op.gt]: now },
      },
      group: ['plan'],
      raw: true,
    });
    const usersByRole = await User.findAll({
      attributes: [
        'role',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['role'],
    });

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        premiumUsers,
        adminUsers,
        recentUsers,
        signupsToday,
        searchesToday,
        searches7d,
        cancelledSubs,
        expiringSoon,
        stripeLinkedUsers,
        planMix: planMix.map((r) => ({
          plan: r.plan,
          count: Number(r.count),
        })),
        usersByRole,
      },
    });
  } catch (error) {
    console.error('Error getting statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while getting statistics',
    });
  }
};

/**
 * GET /api/admin/searches — recent Instagram search history
 */
export const getSearchHistoryAdmin = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const search = (req.query.search || '').trim();
    const offset = (page - 1) * limit;
    const where = {};
    if (search) {
      where.targetUsername = { [Op.iLike]: `%${search}%` };
    }

    const { count, rows } = await SearchHistory.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'username', 'email'],
          required: false,
        },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return res.json({
      success: true,
      data: {
        searches: rows,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(count / limit) || 1,
          total: count,
          limit,
        },
      },
    });
  } catch (error) {
    console.error('Error getting search history:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while getting searches',
    });
  }
};

/**
 * GET /api/admin/audits — admin action audit trail
 */
export const getAuditLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 40, 100);
    const action = (req.query.action || '').trim();
    const offset = (page - 1) * limit;
    const where = {};
    if (action) where.action = action;

    const { count, rows } = await AdminAuditLog.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return res.json({
      success: true,
      data: {
        audits: rows,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(count / limit) || 1,
          total: count,
          limit,
        },
      },
    });
  } catch (error) {
    console.error('Error getting audit logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while getting audits',
    });
  }
};

/**
 * Manage local (comp) subscription. Does not cancel Stripe.
 * Actions: create | grant | extend | update | cancel | revoke
 * Role is ACL-only — never set role=premium for entitlement.
 */
export const manageUserSubscription = async (req, res) => {
  try {
    const { userId } = req.params;
    const { action, plan, endDate, searchesLimit, days } = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const resolvedPlan = plan || 'premium';
    const resolvedLimit =
      searchesLimit != null
        ? Number(searchesLimit)
        : getSearchesLimitForPlan(resolvedPlan);

    switch (action) {
      case 'create':
      case 'grant': {
        const existing = await getActiveDbSubscriptionRow(userId);
        if (existing && action === 'create') {
          return res.status(409).json({
            success: false,
            message: 'Active access already exists. Use extend or revoke.',
            data: existing,
          });
        }
        const newSubscription = await grantLocalSubscription({
          userId,
          plan: resolvedPlan,
          days: days || 30,
          endDate: endDate || null,
          searchesLimit: resolvedLimit,
        });
        await writeAdminAudit({
          actorLogin: req.admin?.login,
          action: 'grant_access',
          targetUserId: userId,
          payload: { plan: resolvedPlan, endDate: newSubscription.endDate },
        });
        return res.json({
          success: true,
          message: 'Access granted (comp) successfully',
          data: newSubscription
        });
      }

      case 'extend': {
        const extended = await extendLocalSubscription({
          userId,
          plan: plan || null,
          days: days || 30,
          endDate: endDate || null,
          searchesLimit: searchesLimit != null ? Number(searchesLimit) : null,
        });
        await writeAdminAudit({
          actorLogin: req.admin?.login,
          action: 'extend_access',
          targetUserId: userId,
          payload: { plan: extended.plan, endDate: extended.endDate },
        });
        return res.json({
          success: true,
          message: 'Access extended successfully',
          data: extended
        });
      }

      case 'update': {
        const subscription = await Subscription.findOne({
          where: { userId, status: 'active' }
        });
        if (!subscription) {
          return res.status(404).json({
            success: false,
            message: 'Active subscription not found'
          });
        }
        await subscription.update({
          plan: plan || subscription.plan,
          endDate: endDate || subscription.endDate,
          searchesLimit:
            searchesLimit != null
              ? Number(searchesLimit)
              : subscription.searchesLimit
        });
        await writeAdminAudit({
          actorLogin: req.admin?.login,
          action: 'update_access',
          targetUserId: userId,
          payload: { plan: subscription.plan, endDate: subscription.endDate },
        });
        return res.json({
          success: true,
          message: 'Subscription updated successfully',
          data: subscription
        });
      }

      case 'cancel':
      case 'revoke': {
        const count = await revokeLocalSubscriptions(userId);
        if (!count) {
          return res.status(404).json({
            success: false,
            message: 'Active subscription not found'
          });
        }
        await writeAdminAudit({
          actorLogin: req.admin?.login,
          action: 'revoke_access',
          targetUserId: userId,
          payload: { revokedCount: count },
        });
        return res.json({
          success: true,
          message: 'Local access revoked (Stripe untouched)'
        });
      }

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Use: create, grant, extend, update, cancel, revoke'
        });
    }
  } catch (error) {
    console.error('Error managing subscription:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while managing subscription'
    });
  }
};

// Get all subscriptions
export const getAllSubscriptions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || '';

    const offset = (page - 1) * limit;

    let whereClause = {};
    if (status) {
      whereClause.status = status;
    }

    const { count, rows: subscriptions } = await Subscription.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'username', 'email', 'first_name', 'last_name']
        }
      ],
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    const totalPages = Math.ceil(count / limit);

    res.json({
      success: true,
      data: {
        subscriptions,
        pagination: {
          currentPage: page,
          totalPages,
          totalSubscriptions: count,
          limit
        }
      }
    });
  } catch (error) {
    console.error('Error getting subscriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while getting subscriptions'
    });
  }
}; 