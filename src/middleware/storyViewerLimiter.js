import rateLimit from 'express-rate-limit';

const windowMs =
  parseInt(process.env.STORY_VIEWER_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000;
const max = parseInt(process.env.STORY_VIEWER_RATE_LIMIT_MAX, 10) || 30;

export const storyViewerLimiter = rateLimit({
  windowMs,
  max,
  message: {
    success: false,
    error: 'Too many story searches. Please try again in a few minutes.',
    retryAfter: Math.ceil(windowMs / 1000),
  },
  standardHeaders: true,
  legacyHeaders: false,
});
