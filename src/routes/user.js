import express from 'express';
import { Op, fn, col, literal } from 'sequelize';
import { protect, authorize } from '../middleware/auth.js';
import User from '../models/User.js';
import SearchHistory from '../models/SearchHistory.js';

const router = express.Router();

// Get user profile
router.get('/profile', protect, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['passwordHash'] }
    });

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
});

// Get user statistics
router.get('/stats', protect, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const today = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [totalSearches, todaySearches, thisMonthSearches, topSearchRows, user] = await Promise.all([
      SearchHistory.count({ where: { userId, status: 'completed' } }),
      SearchHistory.count({
        where: {
          userId,
          status: 'completed',
          createdAt: { [Op.gte]: today }
        }
      }),
      SearchHistory.count({
        where: {
          userId,
          status: 'completed',
          createdAt: { [Op.gte]: monthStart }
        }
      }),
      SearchHistory.findAll({
        attributes: [
          'targetUsername',
          [fn('COUNT', col('id')), 'searches']
        ],
        where: { userId, status: 'completed' },
        group: ['targetUsername'],
        order: [[literal('searches'), 'DESC']],
        limit: 5
      }),
      User.findByPk(userId)
    ]);

    res.status(200).json({
      success: true,
      data: {
        usage: null,
        subscription: user?.hasActiveSubscription?.() || false,
        statistics: {
          totalSearches,
          todaySearches,
          thisMonthSearches,
          topSearches: topSearchRows.map((item) => ({
            username: item.targetUsername,
            searches: Number(item.get('searches'))
          }))
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get all users (admin only)
router.get('/all', protect, authorize('admin'), async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const { rows: users, count: total } = await User.findAndCountAll({
      attributes: { exclude: ['passwordHash'] },
      order: [['created_at', 'DESC']],
      offset,
      limit
    });

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update user role (admin only)
router.put('/:userId/subscription', protect, authorize('admin'), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (role) {
      user.role = role;
      await user.save();
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
});

// Delete user (admin only)
router.delete('/:userId', protect, authorize('admin'), async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    await SearchHistory.destroy({ where: { userId } });
    await user.destroy();

    res.status(200).json({
      success: true,
      message: 'User and associated data deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
