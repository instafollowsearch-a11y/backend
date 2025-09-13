import express from 'express';
import { adminAuth, verifyAdminToken } from '../middleware/adminAuth.js';
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserStats,
  manageUserSubscription,
  getAllSubscriptions
} from '../controllers/adminController.js';

const router = express.Router();

// Admin authentication
router.post('/login', adminAuth, (req, res) => {
  res.json({
    success: true,
    message: 'Authentication successful',
    token: req.adminToken
  });
});

// Protected routes (require admin token)
router.use(verifyAdminToken);

// User management
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// Statistics
router.get('/stats', getUserStats);

// Subscription management
router.get('/subscriptions', getAllSubscriptions);
router.post('/users/:userId/subscription', manageUserSubscription);

export default router; 