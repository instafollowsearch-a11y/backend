import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import User from '../models/User.js';
import SearchHistory from '../models/SearchHistory.js';
import InstagramCache from '../models/InstagramCache.js';

const router = express.Router();

// Get dashboard analytics (admin only)
router.get('/dashboard', protect, authorize('admin'), async (req, res, next) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // User statistics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({
      lastLogin: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });
    const premiumUsers = await User.countDocuments({
      'subscription.plan': { $in: ['premium', 'professional'] }
    });
    const newUsersToday = await User.countDocuments({
      createdAt: { $gte: today }
    });

    // Search statistics
    const totalSearches = await SearchHistory.countDocuments();
    const searchesToday = await SearchHistory.countDocuments({
      createdAt: { $gte: today }
    });
    const successfulSearches = await SearchHistory.countDocuments({
      status: 'completed'
    });
    const failedSearches = await SearchHistory.countDocuments({
      status: 'failed'
    });

    // Revenue metrics (mock data - in real app, this would come from Stripe)
    const revenue = {
      today: Math.floor(Math.random() * 1000),
      thisMonth: Math.floor(Math.random() * 10000),
      lastMonth: Math.floor(Math.random() * 8000),
      total: Math.floor(Math.random() * 50000)
    };

    // Cache statistics
    const cachedUsers = await InstagramCache.countDocuments();
    const staleCacheEntries = await InstagramCache.countDocuments({
      'metadata.isStale': true
    });

    // Top searched usernames
    const topSearches = await SearchHistory.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$targetUsername', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Daily search trends (last 7 days)
    const searchTrends = await SearchHistory.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // User growth (last 30 days)
    const userGrowth = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          premium: premiumUsers,
          newToday: newUsersToday,
          conversionRate: totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(2) : 0
        },
        searches: {
          total: totalSearches,
          today: searchesToday,
          successful: successfulSearches,
          failed: failedSearches,
          successRate: totalSearches > 0 ? ((successfulSearches / totalSearches) * 100).toFixed(2) : 0
        },
        revenue,
        cache: {
          totalEntries: cachedUsers,
          staleEntries: staleCacheEntries,
          hitRate: cachedUsers > 0 ? (((cachedUsers - staleCacheEntries) / cachedUsers) * 100).toFixed(2) : 0
        },
        trends: {
          topSearches: topSearches.map(item => ({
            username: item._id,
            searches: item.count
          })),
          dailySearches: searchTrends,
          userGrowth
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get user activity analytics
router.get('/users', protect, authorize('admin'), async (req, res, next) => {
  try {
    // User distribution by subscription plan
    const subscriptionDistribution = await User.aggregate([
      {
        $group: {
          _id: '$subscription.plan',
          count: { $sum: 1 }
        }
      }
    ]);

    // User activity by usage
    const usageDistribution = await User.aggregate([
      {
        $bucket: {
          groupBy: '$usage.totalSearches',
          boundaries: [0, 1, 5, 10, 50, 100],
          default: '100+',
          output: {
            count: { $sum: 1 },
            users: { $push: '$username' }
          }
        }
      }
    ]);

    // Most active users
    const mostActiveUsers = await User.find()
      .sort({ 'usage.totalSearches': -1 })
      .limit(10)
      .select('username email usage.totalSearches subscription.plan lastLogin');

    res.status(200).json({
      success: true,
      data: {
        subscriptionDistribution,
        usageDistribution,
        mostActiveUsers
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get search analytics
router.get('/searches', protect, authorize('admin'), async (req, res, next) => {
  try {
    // Search status distribution
    const statusDistribution = await SearchHistory.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Search type distribution
    const typeDistribution = await SearchHistory.aggregate([
      {
        $match: { status: 'completed' }
      },
      {
        $group: {
          _id: '$searchType',
          count: { $sum: 1 }
        }
      }
    ]);

    // Average processing time
    const avgProcessingTime = await SearchHistory.aggregate([
      {
        $match: { 
          status: 'completed',
          'metadata.processingTime': { $exists: true }
        }
      },
      {
        $group: {
          _id: null,
          avgTime: { $avg: '$metadata.processingTime' },
          minTime: { $min: '$metadata.processingTime' },
          maxTime: { $max: '$metadata.processingTime' }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        statusDistribution,
        typeDistribution,
        performance: avgProcessingTime[0] || {
          avgTime: 0,
          minTime: 0,
          maxTime: 0
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;