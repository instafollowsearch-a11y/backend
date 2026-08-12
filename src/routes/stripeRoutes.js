import express from 'express';
import {
  createPaymentSession,
  verifyPaymentBySession,
  getUserSubscription,
  getUserEntitlement,
  cancelUserSubscription,
  changeUserSubscription,
  applyDiscountToSubscription,
} from '../controllers/stripeController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/create-session', protect, createPaymentSession);
router.post('/verify', protect, verifyPaymentBySession);
router.get('/subscription', protect, getUserSubscription);
router.get('/entitlement', protect, getUserEntitlement);
router.post('/cancel-subscription', protect, cancelUserSubscription);
// Temporary alias for older clients
router.get('/cancel-subscription', protect, cancelUserSubscription);
router.post('/change-subscription', protect, changeUserSubscription);
router.post('/apply-discount', protect, applyDiscountToSubscription);

export default router;
