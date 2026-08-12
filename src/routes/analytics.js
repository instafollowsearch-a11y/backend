import express from 'express';

const router = express.Router();

/**
 * Legacy mongoose analytics routes retired (Issue 3C).
 * Use POST /api/events + admin Activity tab (/api/admin/activity/*).
 */
// Express 5 / path-to-regexp rejects bare '*'; use a catch-all param instead.
router.all('/{*path}', (req, res) => {
  res.status(410).json({
    success: false,
    message:
      'Legacy /api/analytics endpoints have been retired. Use POST /api/events and admin Activity.',
  });
});

router.all('/', (req, res) => {
  res.status(410).json({
    success: false,
    message:
      'Legacy /api/analytics endpoints have been retired. Use POST /api/events and admin Activity.',
  });
});

export default router;
