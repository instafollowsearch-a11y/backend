import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import { Op } from 'sequelize';
import { sequelize } from '../config/database.js';

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

// Get user by ID
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id, {
      include: [
        {
          model: Subscription,
          as: 'subscriptions',
          required: false
        }
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
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

    await user.update(filteredData);

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

// Get user statistics
export const getUserStats = async (req, res) => {
  try {
    const totalUsers = await User.count();
    const activeUsers = await User.count({
      where: {
        lastLogin: {
          [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      }
    });
    const premiumUsers = await User.count({
      where: { role: 'premium' }
    });
    const adminUsers = await User.count({
      where: { role: 'admin' }
    });

    const usersByRole = await User.findAll({
      attributes: [
        'role',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['role']
    });

    const recentUsers = await User.count({
      where: {
        created_at: {
          [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      }
    });

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        premiumUsers,
        adminUsers,
        recentUsers,
        usersByRole
      }
    });
  } catch (error) {
    console.error('Error getting statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while getting statistics'
    });
  }
};

// Manage user subscription
export const manageUserSubscription = async (req, res) => {
  try {
    const { userId } = req.params;
    const { action, plan, endDate, searchesLimit } = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    switch (action) {
      case 'create':
        const newSubscription = await Subscription.create({
          userId,
          plan: plan || 'basic',
          endDate: endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days default
          searchesLimit: searchesLimit || 100
        });
        
        // Update user role
        await user.update({ role: plan === 'premium' ? 'premium' : 'user' });
        
        res.json({
          success: true,
          message: 'Subscription created successfully',
          data: newSubscription
        });
        break;

      case 'update':
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
          searchesLimit: searchesLimit || subscription.searchesLimit
        });

        // Update user role
        await user.update({ role: plan === 'premium' ? 'premium' : 'user' });

        res.json({
          success: true,
          message: 'Subscription updated successfully',
          data: subscription
        });
        break;

      case 'cancel':
        const activeSubscription = await Subscription.findOne({
          where: { userId, status: 'active' }
        });
        
        if (!activeSubscription) {
          return res.status(404).json({
            success: false,
            message: 'Active subscription not found'
          });
        }

        await activeSubscription.update({ status: 'cancelled' });
        await user.update({ role: 'user' });

        res.json({
          success: true,
          message: 'Subscription cancelled successfully'
        });
        break;

      default:
        res.status(400).json({
          success: false,
          message: 'Invalid action. Available actions: create, update, cancel'
        });
    }
  } catch (error) {
    console.error('Error managing subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while managing subscription'
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