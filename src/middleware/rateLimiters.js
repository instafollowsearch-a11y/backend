import rateLimit from 'express-rate-limit';

/** Login / register — tight limit */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Public free search — stop anonymous scraping */
export const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: {
    success: false,
    error: 'Too many search requests. Please try again in a few minutes.',
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Expensive Hiker features (shared-activity, admirers, view-profile).
 * Default IP key (runs after protect so bursts are still per-IP; 10/hour).
 */
export const expensiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: 'Too many requests for this feature. Please try again later.',
    retryAfter: 60 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});
