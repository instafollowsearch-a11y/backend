import express from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { postEvents } from '../controllers/eventsController.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const eventsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: {
    success: false,
    error: 'Too many analytics requests.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', eventsLimiter, optionalAuth, postEvents);

export default router;
