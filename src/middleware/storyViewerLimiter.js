import rateLimit from 'express-rate-limit';
import { isbot } from 'isbot';
import { getClientIp } from '../services/geoLookup.js';
import {
  isStrictStoryClient,
  isStoryViewerOriginOk,
} from '../services/storyViewerOrigin.js';

/**
 * In-memory counters only. Each Render instance has its own store
 * (resets on dyno restart; not shared across instances).
 */
const windowMs =
  parseInt(process.env.STORY_VIEWER_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000;
const maxNormal = parseInt(process.env.STORY_VIEWER_RATE_LIMIT_MAX, 10) || 20;
const maxStrict =
  parseInt(process.env.STORY_VIEWER_STRICT_RATE_LIMIT_MAX, 10) || 10;
const dailyMax =
  parseInt(process.env.STORY_VIEWER_RATE_LIMIT_DAILY_MAX, 10) || 80;
const dailyStrictMax =
  parseInt(process.env.STORY_VIEWER_STRICT_RATE_LIMIT_DAILY_MAX, 10) || 40;

const clientKey = (req) => {
  const ip = getClientIp(req) || req.ip || 'unknown';
  return `sv:${ip}`;
};

const limitOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  keyGenerator: clientKey,
  skip: (req) => req.method === 'OPTIONS',
};

/**
 * Block empty UA and known scrapers before Hiker. Real browsers pass.
 */
export const storyViewerBotGuard = (req, res, next) => {
  const ua = String(req.headers['user-agent'] || '').trim();
  if (!ua || isbot(ua)) {
    return res.status(403).json({
      success: false,
      error: 'Story search is only available in a web browser.',
    });
  }
  return next();
};

/**
 * If Origin/Referer is sent, it must be our site. Missing Origin is OK (stricter limits).
 */
export const storyViewerOriginGuard = (req, res, next) => {
  if (!isStoryViewerOriginOk(req)) {
    return res.status(403).json({
      success: false,
      error: 'Story search is only available from the official site.',
    });
  }
  return next();
};

export const storyViewerLimiter = rateLimit({
  ...limitOptions,
  windowMs,
  max: (req) => (isStrictStoryClient(req) ? maxStrict : maxNormal),
  message: {
    success: false,
    error: 'Too many story searches. Please try again in a few minutes.',
    retryAfter: Math.ceil(windowMs / 1000),
  },
});

export const storyViewerDailyLimiter = rateLimit({
  ...limitOptions,
  windowMs: 24 * 60 * 60 * 1000,
  max: (req) => (isStrictStoryClient(req) ? dailyStrictMax : dailyMax),
  message: {
    success: false,
    error: 'Daily story search limit reached. Please try again tomorrow.',
    retryAfter: 24 * 60 * 60,
  },
});

export const storyViewerProtection = [
  storyViewerBotGuard,
  storyViewerOriginGuard,
  storyViewerLimiter,
  storyViewerDailyLimiter,
];
