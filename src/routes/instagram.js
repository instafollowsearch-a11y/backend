import express from 'express';
import { body, param } from 'express-validator';
import {
  searchRecent,
  getSearchHistory,
  getSearchDetails,
  checkUsername,
  getAnalytics,
  advancedSearch,
  sharedActivity,
  nextFollowers,
  nextFollowing
} from '../controllers/instagramController.js';
import { protect, authorize, optionalAuth } from '../middleware/auth.js';
import axios from 'axios'; // Added axios import

const router = express.Router();

// Validation rules
const searchValidation = [
  body('username')
    .isLength({ min: 1, max: 30 })
    .withMessage('Username must be between 1 and 30 characters')
    .matches(/^[a-zA-Z0-9._]+$/)
    .withMessage('Username can only contain letters, numbers, dots, and underscores'),
  body('type')
    .optional()
    .isIn(['followers', 'following', 'both'])
    .withMessage('Type must be followers, following, or both')
];

const usernameValidation = [
  param('username')
    .isLength({ min: 1, max: 30 })
    .withMessage('Username must be between 1 and 30 characters')
    .matches(/^[a-zA-Z0-9._]+$/)
    .withMessage('Username can only contain letters, numbers, dots, and underscores')
];

const sharedActivityValidation = [
  body('username1')
    .isLength({ min: 1, max: 30 })
    .withMessage('Username must be between 1 and 30 characters')
    .matches(/^[a-zA-Z0-9._]+$/)
    .withMessage('Username can only contain letters, numbers, dots, and underscores'),
  body('username2')
    .isLength({ min: 1, max: 30 })
    .withMessage('Username must be between 1 and 30 characters')
    .matches(/^[a-zA-Z0-9._]+$/)
    .withMessage('Username can only contain letters, numbers, dots, and underscores')
];

// Routes

// Search for recent followers/following
// This endpoint works for both authenticated and anonymous users
router.post('/search', optionalAuth, searchValidation, searchRecent);

// Check if username exists and get basic info
router.get('/check/:username', usernameValidation, checkUsername);

// Get user's search history (authenticated users only)
router.get('/history', protect, getSearchHistory);

// Get specific search details
router.get('/search/:searchId', optionalAuth, getSearchDetails);

// Get analytics (admin only)
router.get('/analytics', protect, authorize('admin'), getAnalytics);

// Advanced search for dashboard (authenticated users only)
router.post('/advanced-search', protect, searchValidation, advancedSearch);

// Shared Activity among two IG accounts (authenticated users only)
router.post('/shared-activity', protect, sharedActivityValidation, sharedActivity);
router.post('/next-followers', protect, nextFollowers);
router.post('/next-following', protect, nextFollowing);

// Proxy route for Instagram images
router.get('/proxy-image', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    // Validate that it's an Instagram URL
    if (!url.includes('instagram.com') && !url.includes('cdninstagram.com')) {
      return res.status(400).json({ error: 'Only Instagram URLs are allowed' });
    }

    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      timeout: 10000
    });

    // Set appropriate headers
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Pipe the image data
    response.data.pipe(res);

  } catch (error) {
    console.error('Image proxy error:', error.message);
    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

// Download story route
router.get('/download-story', async (req, res) => {
  try {
    const { url, filename, mediaType } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    // Validate that it's an Instagram URL
    if (!url.includes('instagram.com') && !url.includes('cdninstagram.com')) {
      return res.status(400).json({ error: 'Only Instagram URLs are allowed' });
    }

    console.log(`Downloading story from: ${url}`);

    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Accept': mediaType === 'video' ? 'video/mp4,video/*,*/*;q=0.8' : 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 60000,
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400; // Accept redirects
      }
    });

    // Check if we got a valid response
    if (!response.data) {
      throw new Error('No data received from Instagram');
    }

    // Check content length
    const contentLength = response.headers['content-length'];
    if (contentLength && parseInt(contentLength) === 0) {
      throw new Error('File is empty');
    }

    // For images, allow smaller files (Instagram stories can be small)
    if (contentLength && mediaType === 'image' && parseInt(contentLength) < 100) {
      console.warn(`Small image file: ${contentLength} bytes`);
    }

    // Check content type
    const responseContentType = response.headers['content-type'];
    if (!responseContentType) {
      throw new Error('No content type received');
    }

    // Validate content type
    const expectedTypes = mediaType === 'video' 
      ? ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv']
      : ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    
    const isValidType = expectedTypes.some(type => responseContentType.includes(type));
    if (!isValidType) {
      console.warn(`Unexpected content type: ${responseContentType} for ${mediaType}`);
    }

    // Generate filename if not provided
    const downloadFilename = filename || `story_${Date.now()}.${mediaType === 'video' ? 'mp4' : 'jpg'}`;
    
    // Set download headers
    const contentType = responseContentType || 
                       (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
    
    res.setHeader('Content-Type', contentType);
    
    // For images, use inline disposition to allow browser to display them
    const disposition = mediaType === 'image' ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${downloadFilename}"`);
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Length', response.headers['content-length'] || '');

    console.log(`Downloading ${mediaType} file: ${downloadFilename} (${contentType})`);

    // Handle errors in the stream
    response.data.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error during download' });
      }
    });

    // Handle data events to ensure we're getting content
    let hasData = false;
    response.data.on('data', (chunk) => {
      hasData = true;
    });

    response.data.on('end', () => {
      if (!hasData) {
        console.error('No data received in stream');
        if (!res.headersSent) {
          res.status(500).json({ error: 'No data received from Instagram' });
        }
      }
    });

    // Pipe the file data
    response.data.pipe(res);

    // Handle response end
    res.on('finish', () => {
      console.log(`Download completed: ${downloadFilename}`);
    });

  } catch (error) {
    console.error('Download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to download story',
        details: error.message 
      });
    }
  }
});

export default router;