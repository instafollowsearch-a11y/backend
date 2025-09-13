import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import User from '../models/User.js';
import SearchHistory from '../models/SearchHistory.js';

const router = express.Router();

// Get user profile
router.get('/profile', protect, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id);
    
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
    
    // Get user's search statistics
    const totalSearches = await SearchHistory.countDocuments({ 
      user: userId,
      status: 'completed'
    });
    
    const todaySearches = await SearchHistory.countDocuments({
      user: userId,
      status: 'completed',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    const thisMonthSearches = await SearchHistory.countDocuments({
      user: userId,
      status: 'completed',
      createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
    });

    // Get most searched usernames
    const topSearches = await SearchHistory.aggregate([
      { $match: { user: userId, status: 'completed' } },
      { $group: { _id: '$targetUsername', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    const user = await User.findById(userId);

    res.status(200).json({
      success: true,
      data: {
        usage: user.usage,
        subscription: user.subscription,
        statistics: {
          totalSearches,
          todaySearches,
          thisMonthSearches,
          topSearches: topSearches.map(item => ({
            username: item._id,
            searches: item.count
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
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments();

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

// Update user subscription (admin only)
router.put('/:userId/subscription', protect, authorize('admin'), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { plan, status, endDate } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        'subscription.plan': plan,
        'subscription.status': status,
        'subscription.endDate': endDate
      },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
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

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Delete user's search history
    await SearchHistory.deleteMany({ user: userId });
    
    // Delete user
    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: 'User and associated data deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;