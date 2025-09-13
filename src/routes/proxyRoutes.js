import express from 'express';
import axios from 'axios';

const router = express.Router();

// Proxy for Instagram images
router.get('/image/:encodedUrl', async (req, res) => {
  try {
    const { encodedUrl } = req.params;
    const imageUrl = decodeURIComponent(encodedUrl);
    
    // Validate that it's an Instagram image URL
    if (!imageUrl.includes('cdninstagram.com') && !imageUrl.includes('instagram.com')) {
      return res.status(400).json({ error: 'Invalid image URL' });
    }

    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://www.instagram.com/'
      }
    });

    // Set appropriate headers
    res.setHeader('Content-Type', response.headers['content-type']);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Pipe the image data
    response.data.pipe(res);
  } catch (error) {
    console.error('Error proxying image:', error.message);
    res.status(500).json({ error: 'Failed to load image' });
  }
});

export default router; 