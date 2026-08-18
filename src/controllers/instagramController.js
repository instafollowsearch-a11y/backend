import { validationResult } from 'express-validator';
import rapidApiService from '../services/rapidApiService.js';
import SearchHistory from '../models/SearchHistory.js';
import { getAdvancedActivity, getInstagramAdmirers, getInstagramProfileDetails, getNextFollowers, getNextFollowing, getNextMedias, getRecentActivity, getSharedActivity, getStoryViewerProfile } from '../services/hikerApiService.js';
import {
  getStoryViewerCache,
  setStoryViewerCache,
  getStoryViewerCacheTtlMs,
} from '../services/utils/storyViewerCache.js';
import { getPostComentsWithCap, getPostLikers, getUserInfo } from '../services/utils/hikerHelperFunctions.js';
import { emitReqAnalyticsEvent } from '../services/productAnalyticsService.js';
import { getClientIp, getCfCountry } from '../services/geoLookup.js';

// Search for recent followers/following - RANDOM DATA for motivation
export const searchRecent = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { username, type = 'both' } = req.body;
    const userId = req.user?.id;
    const ipAddress = getClientIp(req) || req.ip || req.connection.remoteAddress;

    // Create search history entry
    const searchEntry = await SearchHistory.create({
      userId: userId || null,
      targetUsername: username,
      searchType: type,
      ipAddress,
      userAgent: req.get('User-Agent'),
      status: 'pending'
    });

    void emitReqAnalyticsEvent(req, {
      event: 'search',
      path: '/search',
      site: 'main',
      userId: userId || null,
      props: { username, type },
    });

    try {
      // Perform the search using regular activity (random data)
      const startTime = Date.now();
      const results = await getRecentActivity(username, 'free', type);
      const processingTime = Date.now() - startTime;

      const fullResults = {
        user: results.userInfo,
        newFollowers: results.newFollowers,
        newFollowing: results.newFollowing,
        stories: results.stories,
        redFlags: results.redFlags,
        totalNewFollowers: results.totalNewFollowers,
        totalNewFollowing: results.totalNewFollowing,
        lastUpdated: results.lastUpdated,
        processingTime,

        followers: results.followers,
        following: results.following,
        followListOrder: results.followListOrder,
        showUpgradeCTA: true,
        message: "Upgrade to Premium for complete Instagram analytics and real-time tracking!"
      };

      res.status(200).json({
        success: true,
        data: fullResults,
        cached: Boolean(results.cacheHit),
        searchId: searchEntry.id
      });

      searchEntry.update({
        newFollowers: results.newFollowers,
        newFollowing: results.newFollowing,
        totalNewFollowers: results.totalNewFollowers,
        totalNewFollowing: results.totalNewFollowing,
        processingTime,
        dataSource: 'scraper',
        cacheHit: Boolean(results.cacheHit),
        lastUpdated: results.lastUpdated,
        status: 'completed',
        results: {
          user: results.userInfo,
          newFollowers: results.newFollowers,
          newFollowing: results.newFollowing,
          totalNewFollowers: results.totalNewFollowers,
          totalNewFollowing: results.totalNewFollowing,
          lastUpdated: results.lastUpdated,
          processingTime
        }
      }).catch((err) => {
        console.error('Search history update failed:', err.message);
      });

    } catch (searchError) {
      // Update search entry with error
      await searchEntry.update({
        status: 'failed',
        errorMessage: searchError.message
      });
      throw searchError;
    }

  } catch (error) {
    if (error.message?.includes("rate limit exceeded")) {
      return res.status(429).json({
        success: false,
        error:
          "API rate limit exceeded. Please try again in a few minutes or upgrade your plan for higher limits.",
        retryAfter: 300,
      });
    }
    if (error.message?.includes("User not found")) {
      return res.status(404).json({
        success: false,
        error: "User not found. Please check the username and try again.",
      });
    }
    if (error.message?.includes("temporarily unavailable")) {
      return res.status(503).json({
        success: false,
        error:
          "Instagram API is temporarily unavailable. Please try again later.",
      });
    }
    return res.status(500).json({
      success: false,
      error: error.message || "Search failed. Please try again.",
    });
  }
};

// Get user's search history
export const getSearchHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const searchHistory = await SearchHistory.find({
      user: req.user.id,
      status: 'completed'
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-results.newFollowers -results.newFollowing'); // Exclude detailed results for list view

    const total = await SearchHistory.countDocuments({
      user: req.user.id,
      status: 'completed'
    });

    res.status(200).json({
      success: true,
      data: searchHistory,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get specific search details
export const getSearchDetails = async (req, res, next) => {
  try {
    const { searchId } = req.params;

    const searchQuery = {
      _id: searchId,
      status: 'completed'
    };

    // If user is authenticated, only show their searches
    // If not authenticated, allow access (for anonymous searches)
    if (req.user) {
      searchQuery.user = req.user.id;
    }

    const search = await SearchHistory.findOne(searchQuery);

    if (!search) {
      return res.status(404).json({
        success: false,
        error: 'Search not found'
      });
    }

    res.status(200).json({
      success: true,
      data: search
    });
  } catch (error) {
    next(error);
  }
};

// Check username availability/validity
export const checkUsername = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { username } = req.params;

    const userInfo = await getUserInfo(username);

    if (!userInfo) {
      return res.status(404).json({
        success: false,
        error: 'User not found or account is private'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        exists: true,
        isPrivate: userInfo.isPrivate,
        basicInfo: {
          username: userInfo.username,
          fullName: userInfo.fullName,
          profilePicUrl: userInfo.profilePicUrl,
          isVerified: userInfo.isVerified,
          followerCount: userInfo.followerCount,
          followingCount: userInfo.followingCount
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get analytics (admin only)
export const getAnalytics = async (req, res, next) => {
  try {
    const analytics = await rapidApiService.getAnalytics ? rapidApiService.getAnalytics() : {
      totalCachedUsers: 0,
      staleCacheCount: 0,
      recentUpdates: 0,
      cacheHitRate: 0
    };

    // Get additional stats
    const totalSearches = await SearchHistory.countDocuments();
    const todaySearches = await SearchHistory.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    const successfulSearches = await SearchHistory.countDocuments({ status: 'completed' });

    res.status(200).json({
      success: true,
      data: {
        ...analytics,
        totalSearches,
        todaySearches,
        successfulSearches,
        successRate: totalSearches > 0 ? ((successfulSearches / totalSearches) * 100).toFixed(2) : 0
      }
    });
  } catch (error) {
    next(error);
  }
};

// Advanced search for dashboard - REAL DATA with comparison
export const advancedSearch = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { username, type = 'both' } = req.body;

    // User should be available from middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for advanced search'
      });
    }

    // Get previous search results for comparison
    const previousSearch = await SearchHistory.findOne({
      where: {
        userId: req.user.id,
        targetUsername: username,
        status: 'completed'
      },
      order: [['created_at', 'DESC']]
    });

    // Perform advanced search with real data comparison
    const startTime = Date.now();
    const results = await getAdvancedActivity(username, req.user?.subscription, type);
    const processingTime = Date.now() - startTime;

    // Compare with previous results from database
    let comparison = null;
    let isFirstSearch = false;

    if (previousSearch) {
      comparison = {
        newFollowers: results.newFollowers.filter(current =>
          !previousSearch.newFollowers.some(prev => prev.id === current.id)
        ),
        removedFollowers: previousSearch.newFollowers.filter(prev =>
          !results.newFollowers.some(current => current.id === prev.id)
        ),
        newFollowing: results.newFollowing.filter(current =>
          !previousSearch.newFollowing.some(prev => prev.id === current.id)
        ),
        removedFollowing: previousSearch.newFollowing.filter(prev =>
          !results.newFollowing.some(current => current.id === prev.id)
        )
      };
    } else {
      isFirstSearch = true;
    }

    // Save search history
    const searchEntry = await SearchHistory.create({
      userId: req.user.id,
      targetUsername: username,
      searchType: type,
      ipAddress: getClientIp(req) || req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      status: 'completed',
      newFollowers: results.newFollowers,
      newFollowing: results.newFollowing,
      totalNewFollowers: results.totalNewFollowers,
      totalNewFollowing: results.totalNewFollowing,
      processingTime,
      dataSource: 'advanced_search',
      cacheHit: false,
      lastUpdated: results.lastUpdated,
      results: {
        user: results.userInfo,
        newFollowers: results.newFollowers,
        newFollowing: results.newFollowing,
        stories: results.stories,
        totalNewFollowers: results.totalNewFollowers,
        totalNewFollowing: results.totalNewFollowing,
        lastUpdated: results.lastUpdated,
        totalFollowers: results.totalFollowers,
        totalFollowing: results.totalFollowing,
        processingTime
      }
    });

    res.status(200).json({
      success: true,
      data: {
        user: results.userInfo, // Переименовываем userInfo в user для совместимости
        newFollowers: results.newFollowers,
        newFollowing: results.newFollowing,
        stories: results.stories,
        redFlags: results.redFlags,
        totalNewFollowers: results.totalNewFollowers,
        totalNewFollowing: results.totalNewFollowing,
        lastUpdated: results.lastUpdated,
        totalFollowers: results.totalFollowers,
        totalFollowing: results.totalFollowing,
        followersNextPageId: results.followersNextPageId,
        followingNextPageId: results.followingNextPageId,
        followers: results.followers,
        following: results.following,
        followListOrder: results.followListOrder,
        processingTime,
        searchId: searchEntry.id,
        comparison,
        isFirstSearch,
        message: isFirstSearch
          ? "First search completed! We've recorded the current state. Future searches will show changes."
          : "Search completed! Changes since last search are highlighted."
      }
    });
  } catch (error) {
    console.error('Advanced search error:', error);

    // Обработка ошибки 429
    if (error.message && error.message.includes('rate limit exceeded')) {
      return res.status(429).json({
        success: false,
        error: 'API rate limit exceeded. Please try again in a few minutes or upgrade your plan for higher limits.',
        retryAfter: 300 // 5 minutes
      });
    }

    // Обработка ошибки 404
    if (error.message && error.message.includes('User not found')) {
      return res.status(404).json({
        success: false,
        error: 'User not found. Please check the username and try again.'
      });
    }

    // Обработка ошибок сервера
    if (error.message && error.message.includes('temporarily unavailable')) {
      return res.status(503).json({
        success: false,
        error: 'Instagram API is temporarily unavailable. Please try again later.'
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message || 'Advanced search failed. Please try again.',
    });
  }
};

// Shared Activity among two IG accounts - REAL DATA with comparison
export const sharedActivity = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { username1, username2 } = req.body;

    // User should be available from middleware
    // if (!req.user) {
    //   return res.status(401).json({
    //     success: false,
    //     error: 'Authentication required for advanced search'
    //   });
    // }

    // Perform advanced search with real data comparison
    const startTime = Date.now();
    const results = await getSharedActivity(username1, username2);
    const processingTime = Date.now() - startTime;

    void emitReqAnalyticsEvent(req, {
      event: 'shared_activity',
      path: '/shared-activity',
      site: 'main',
      props: { username1, username2 },
    });

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Advanced search error:', error);

    // Обработка ошибки 429
    if (error.message && error.message.includes('rate limit exceeded')) {
      return res.status(429).json({
        success: false,
        error: 'API rate limit exceeded. Please try again in a few minutes or upgrade your plan for higher limits.',
        retryAfter: 300 // 5 minutes
      });
    }

    // Обработка ошибки 404
    if (error.message && error.message.includes('User not found')) {
      return res.status(404).json({
        success: false,
        error: 'User not found. Please check the username and try again.'
      });
    }

    // Обработка ошибок сервера
    if (error.message && error.message.includes('temporarily unavailable')) {
      return res.status(503).json({
        success: false,
        error: 'Instagram API is temporarily unavailable. Please try again later.'
      });
    }

    next(error);
  }
};

export const getAdmirers = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { username } = req.body;

    // User should be available from middleware
    // if (!req.user) {
    //   return res.status(401).json({
    //     success: false,
    //     error: 'Authentication required for Admirer Feature'
    //   });
    // }

    // Perform advanced search with real data comparison
    const startTime = Date.now();
    const results = await getInstagramAdmirers(username);
    const processingTime = Date.now() - startTime;

    void emitReqAnalyticsEvent(req, {
      event: 'admirers',
      path: '/admirers',
      site: 'main',
      props: { username },
    });

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Advanced search error:', error);

    // Обработка ошибки 429
    if (error.message && error.message.includes('rate limit exceeded')) {
      return res.status(429).json({
        success: false,
        error: 'API rate limit exceeded. Please try again in a few minutes or upgrade your plan for higher limits.',
        retryAfter: 300 // 5 minutes
      });
    }

    // Обработка ошибки 404
    if (error.message && error.message.includes('User not found')) {
      return res.status(404).json({
        success: false,
        error: 'User not found. Please check the username and try again.'
      });
    }

    // Обработка ошибок сервера
    if (error.message && error.message.includes('temporarily unavailable')) {
      return res.status(503).json({
        success: false,
        error: 'Instagram API is temporarily unavailable. Please try again later.'
      });
    }

    next(error);
  }
};

export const getStoryViewer = async (req, res, next) => {
  try {
    if (process.env.STORY_VIEWER_ENABLED === 'false') {
      return res.status(503).json({
        success: false,
        error: 'Story viewer is temporarily unavailable. Please try again later.',
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { username } = req.body;
    const normalized = username.trim().replace(/^@+/, '');

    const emitStoryVisit = () => {
      void emitReqAnalyticsEvent(req, {
        event: 'story_viewer',
        path: '/story-viewer',
        site: 'story_viewer',
        userId: req.user?.id || null,
        anonId: req.body?.anonId || null,
        utmSource: req.body?.utmSource || req.body?.utm_source || null,
        utmMedium: req.body?.utmMedium || req.body?.utm_medium || null,
        utmCampaign: req.body?.utmCampaign || req.body?.utm_campaign || null,
        referrer: req.body?.referrer || req.headers.referer || null,
        clientIp: getClientIp(req),
        userAgent: req.headers['user-agent'] || null,
        origin: req.headers.origin || req.headers.referer || null,
        cfCountry: getCfCountry(req),
        props: { username: normalized },
      });
    };

    const cached = getStoryViewerCache(normalized);
    if (cached) {
      emitStoryVisit();
      return res.status(200).json({
        success: true,
        data: cached,
        processingTime: 0,
        cached: true,
      });
    }

    const results = await getStoryViewerProfile(normalized);

    if (!results.success) {
      if (results.error?.includes('User not found')) {
        return res.status(404).json({
          success: false,
          error: 'User not found. Please check the username and try again.',
        });
      }
      if (results.error?.includes('rate limit')) {
        return res.status(429).json({
          success: false,
          error: 'API rate limit exceeded. Please try again in a few minutes.',
          retryAfter: 300,
        });
      }
      return res.status(500).json({
        success: false,
        error: results.error || 'Failed to load stories',
      });
    }

    const storyCount = Array.isArray(results.userStories)
      ? results.userStories.length
      : 0;
    // Always cache successful profile loads, but empty stories get a short TTL
    // so a temporary Hiker miss does not hide an active ring for ~8 minutes.
    if (results.success) {
      setStoryViewerCache(normalized, results, {
        ttlMs: getStoryViewerCacheTtlMs({ hasStories: storyCount > 0 }),
      });
    }

    emitStoryVisit();

    res.status(200).json({
      success: true,
      data: results,
      processingTime: results.processingTime,
    });
  } catch (error) {
    console.error('Story viewer error:', error);
    next(error);
  }
};

export const getInstagramProfile = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { username } = req.body;

    // requireActiveSubscription already guaranteed paid access
    const startTime = Date.now();
    const forPremium = true;
    const results = await getInstagramProfileDetails(username, { forPremium });
    const processingTime = Date.now() - startTime;

    void emitReqAnalyticsEvent(req, {
      event: 'view_profile',
      path: '/view-profile',
      site: 'main',
      props: { username },
    });

    res.status(200).json({
      success: true,
      data: results,
      processingTime
    });
  } catch (error) {
    console.error('Get instagram profile details error:', error);

    // Обработка ошибки 429
    if (error.message && error.message.includes('rate limit exceeded')) {
      return res.status(429).json({
        success: false,
        error: 'API rate limit exceeded. Please try again in a few minutes or upgrade your plan for higher limits.',
        retryAfter: 300 // 5 minutes
      });
    }

    // Обработка ошибки 404
    if (error.message && error.message.includes('User not found')) {
      return res.status(404).json({
        success: false,
        error: 'User not found. Please check the username and try again.'
      });
    }

    // Обработка ошибок сервера
    if (error.message && error.message.includes('temporarily unavailable')) {
      return res.status(503).json({
        success: false,
        error: 'Instagram API is temporarily unavailable. Please try again later.'
      });
    }

    next(error);
  }
};

export const nextFollowers = async (req, res) => {
  try {
    const { userId, nextPageId } = req.body;
    
    // User should be available from middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for advanced search'
      });
    }
    if (!userId || !nextPageId) {
      return res.status(400).json({
        success: false,
        error: 'Params not provided'
      });
    }
    
    // Perform advanced search with real data comparison
    const results = await getNextFollowers(userId, nextPageId);

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Error getting next followers:', error);
    return res.status(500).json({
      success: false,
      error: 'Error getting next followers'
    });
  }
};

export const nextFollowing = async (req, res) => {
  try {
    const { userId, nextPageId } = req.body;

    // User should be available from middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for advanced search'
      });
    }
    if (!userId || !nextPageId) {
      return res.status(400).json({
        success: false,
        error: 'Params not provided'
      });
    }

    // Perform advanced search with real data comparison
    const results = await getNextFollowing(userId, nextPageId);

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Error getting next following:', error);
    return res.status(500).json({
      success: false,
      error: 'Error getting next following'
    });
  }
};

export const nextMedias = async (req, res) => {
  try {
    const { userId, nextPageId } = req.body;

    // User should be available from middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for advanced search'
      });
    }
    if (!userId || !nextPageId) {
      return res.status(400).json({
        success: false,
        error: 'Params not provided'
      });
    }

    // Perform advanced search with real data comparison
    const results = await getNextMedias(userId, nextPageId);

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Error getting next medias:', error);
    return res.status(500).json({
      success: false,
      error: 'Error getting next medias'
    });
  }
};

export const getMediaLikers = async (req, res) => {
  try {
    const { mediaId } = req.body;

    // User should be available from middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for advanced search'
      });
    }
    if (!mediaId) {
      return res.status(400).json({
        success: false,
        error: 'Params not provided'
      });
    }

    // Perform advanced search with real data comparison
    const results = await getPostLikers(mediaId);

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Error getting media likers:', error);
    return res.status(500).json({
      success: false,
      error: 'Error getting media likers'
    });
  }
};

export const getMediaComments = async (req, res) => {
  try {
    const { mediaId } = req.body;

    // User should be available from middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for advanced search'
      });
    }
    if (!mediaId) {
      return res.status(400).json({
        success: false,
        error: 'Params not provided'
      });
    }

    // Perform advanced search with real data comparison
    const results = await getPostComentsWithCap(mediaId);

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Error getting media comments:', error);
    return res.status(500).json({
      success: false,
      error: 'Error getting media comments'
    });
  }
};