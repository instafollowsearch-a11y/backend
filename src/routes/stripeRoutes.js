import express from 'express';
import { createPaymentSession, verifyPaymentBySession, getUserSubscription, cancelUserSubscription, changeUserSubscription, applyDiscountToSubscription } from '../controllers/stripeController.js';

const router = express.Router();

router.post('/create-session', createPaymentSession);
router.post('/verify', verifyPaymentBySession);
router.get('/subscription', getUserSubscription);
router.get('/cancel-subscription', cancelUserSubscription);
router.post('/change-subscription', changeUserSubscription);
router.post('/apply-discount', applyDiscountToSubscription);

export default router;