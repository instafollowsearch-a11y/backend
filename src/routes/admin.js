import express from 'express';
import { adminAuth, verifyAdminToken } from '../middleware/adminAuth.js';
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserStats,
  manageUserSubscription,
  getAllSubscriptions,
  getAuditLogs,
  changePassword,
} from '../controllers/adminController.js';
import {
  getActivitySummary,
  getUserActivityTimeline,
  getRecentEvents,
  listActivityPeople,
  getActivityPerson,
  listAdminSearches,
} from '../controllers/adminActivityController.js';
import { listBlocks, createBlock, removeBlock } from '../controllers/adminBlockController.js';

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

// Admin account
router.post('/change-password', changePassword);

// User management
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// Statistics / ops overview
router.get('/stats', getUserStats);

// Subscription management
router.get('/subscriptions', getAllSubscriptions);
router.post('/users/:userId/subscription', manageUserSubscription);

// Product usage
router.get('/searches', listAdminSearches);
router.get('/audits', getAuditLogs);

// First-party activity dashboard
router.get('/activity/summary', getActivitySummary);
router.get('/activity/events', getRecentEvents);
router.get('/activity/people', listActivityPeople);
router.get('/activity/people/:kind/:id', getActivityPerson);
router.get('/activity/users/:userId', getUserActivityTimeline);

router.get('/blocks', listBlocks);
router.post('/blocks', createBlock);
router.delete('/blocks/:ip', removeBlock);

export default router; 