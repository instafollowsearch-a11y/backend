import axios from 'axios';
import InstagramCache from '../models/InstagramCache.js';

class RapidApiService {
  constructor() {
    this.baseURL = 'https://instagram-premium-api-2023.p.rapidapi.com';
    this.apiKey = process.env.RAPID_API_KEY;
    this.accessKey = process.env.RAPID_API_ACCESS_KEY;
    this.host = process.env.RAPID_API_HOST;
    
    // Rate limiting
    this.rateLimit = parseInt(process.env.INSTAGRAM_RATE_LIMIT) || 200;
    this.requestCount = 0;
    this.lastReset = Date.now();
    
    // Follower limit - maximum to process for any account
    this.maxFollowersLimit = 500;
  }

  // Вспомогательная функция для обработки ошибок API
  handleApiError(error, context = 'API request') {
    console.error(`Error in ${context}:`, error.message);
    
    // Обработка ошибки 429 (Too Many Requests)
    if (error.response && error.response.status === 429) {
      throw new Error('API rate limit exceeded. Please try again in a few minutes or upgrade your plan for higher limits.');
    }
    
    // Обработка ошибки 404 (Not Found)
    if (error.response && error.response.status === 404) {
      throw new Error('User not found. Please check the username and try again.');
    }
    
    // Обработка ошибок сервера
    if (error.response && error.response.status >= 500) {
      throw new Error('Instagram API is temporarily unavailable. Please try again later.');
    }
    
    // Обработка ошибки 403 (Forbidden)
    if (error.response && error.response.status === 403) {
      throw new Error('Access denied. The account might be private or restricted.');
    }
    
    throw error;
  }

  // Get user info by username
  async getUserInfo(username) {
    try {
      const apiKey = process.env.RAPID_API_KEY;
      const host = process.env.RAPID_API_HOST;
      const accessKey = process.env.RAPID_API_ACCESS_KEY;
      
      const options = {
        method: 'GET',
        url: `${this.baseURL}/v2/user/by/username`,
        params: { username },
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': host,
          'x-access-key': accessKey
        }
      };

      const response = await axios.request(options);
      
      if (response.data && response.data.user) {
        const userData = response.data.user;
        
        return {
          id: userData.pk,
          username: userData.username,
          fullName: userData.full_name,
          profilePicUrl: userData.profile_pic_url,
          isVerified: userData.is_verified,
          isPrivate: userData.is_private,
          followerCount: userData.follower_count,
          followingCount: userData.following_count,
          mediaCount: userData.media_count,
          biography: userData.biography,
          externalUrl: userData.external_url,
          // Добавляем дополнительные поля для совместимости
          pk: userData.pk,
          full_name: userData.full_name,
          profile_pic_url: userData.profile_pic_url,
          is_verified: userData.is_verified,
          is_private: userData.is_private,
          follower_count: userData.follower_count,
          following_count: userData.following_count,
          media_count: userData.media_count
        };
      }
      
      throw new Error('Invalid response format from RapidAPI');
    } catch (error) {
      this.handleApiError(error, 'getting user info');
    }
  }

  analyzeRedFlags(userData) {
    const redFlags = [];
    
    // Проверка на подозрительную активность
    if (userData.follower_count > 0 && userData.following_count > 0) {
      const ratio = userData.following_count / userData.follower_count;
      
      // Слишком много подписок по сравнению с подписчиками
      if (ratio > 10) {
        redFlags.push({
          type: 'following_ratio',
          severity: 'high',
          message: 'Following significantly more accounts than followers',
          details: `Following ${userData.following_count} accounts with only ${userData.follower_count} followers`
        });
      }
      
      // Очень мало подписчиков при большом количестве подписок
      if (userData.follower_count < 10 && userData.following_count > 100) {
        redFlags.push({
          type: 'low_followers',
          severity: 'medium',
          message: 'Very few followers despite following many accounts',
          details: `Only ${userData.follower_count} followers while following ${userData.following_count} accounts`
        });
      }
      
      // Подозрительно много подписчиков при мало постов
      if (userData.follower_count > 1000 && userData.media_count < 10) {
        redFlags.push({
          type: 'high_followers_low_posts',
          severity: 'medium',
          message: 'High follower count with very few posts',
          details: `${userData.follower_count} followers but only ${userData.media_count} posts`
        });
      }
      
      // Очень высокое соотношение подписчиков к постам
      if (userData.media_count > 0 && (userData.follower_count / userData.media_count) > 1000) {
        redFlags.push({
          type: 'suspicious_engagement_ratio',
          severity: 'high',
          message: 'Suspicious follower to post ratio',
          details: `${userData.follower_count} followers for only ${userData.media_count} posts`
        });
      }
    }
    
    // Проверка на подозрительную биографию
    if (userData.biography) {
      const bio = userData.biography.toLowerCase();
      
      // Подозрительные слова в био
      const suspiciousWords = [
        'buy', 'sell', 'follow', 'unfollow', 'dm', 'message', 'link', 'click',
        'promo', 'advertisement', 'sponsored', 'paid', 'earn', 'money',
        'business', 'marketing', 'promotion', 'offer', 'deal', 'discount'
      ];
      const foundWords = suspiciousWords.filter(word => bio.includes(word));
      
      if (foundWords.length > 2) {
        redFlags.push({
          type: 'suspicious_bio',
          severity: 'medium',
          message: 'Suspicious content in biography',
          details: `Contains suspicious words: ${foundWords.join(', ')}`
        });
      }
      
      // Проверка на спам-ссылки
      if (bio.includes('http') && (bio.includes('bit.ly') || bio.includes('tinyurl') || bio.includes('goo.gl'))) {
        redFlags.push({
          type: 'suspicious_links',
          severity: 'medium',
          message: 'Suspicious shortened links in biography',
          details: 'Contains shortened URLs which are often used for spam'
        });
      }
    }
    
    // Проверка на новый аккаунт
    if (userData.is_new_to_instagram) {
      redFlags.push({
        type: 'new_account',
        severity: 'low',
        message: 'Recently created account',
        details: 'Account was created recently'
      });
    }
    
    // Проверка на приватный аккаунт
    if (userData.is_private) {
      redFlags.push({
        type: 'private_account',
        severity: 'low',
        message: 'Private account',
        details: 'This account is private'
      });
    }
    
    // Проверка на верифицированный аккаунт (зеленый флаг)
    if (userData.is_verified) {
      redFlags.push({
        type: 'verified_account',
        severity: 'positive',
        message: 'Verified account',
        details: 'This account is verified by Instagram'
      });
    }
    
    // Проверка на пустую биографию при большом количестве подписчиков
    if ((!userData.biography || userData.biography.trim() === '') && userData.follower_count > 1000) {
      redFlags.push({
        type: 'empty_bio_high_followers',
        severity: 'low',
        message: 'Empty biography despite high follower count',
        details: 'Account has many followers but no biography'
      });
    }
    
    // Проверка на отсутствие постов при большом количестве подписчиков
    if (userData.media_count === 0 && userData.follower_count > 500) {
      redFlags.push({
        type: 'no_posts_high_followers',
        severity: 'medium',
        message: 'No posts despite high follower count',
        details: `${userData.follower_count} followers but no posts`
      });
    }
    
    return redFlags;
  }

  // Get user stories
  async getUserStories(userId) {
    try {
      const apiKey = process.env.RAPID_API_KEY;
      const host = process.env.RAPID_API_HOST;
      const accessKey = process.env.RAPID_API_ACCESS_KEY;
      
      const options = {
        method: 'GET',
        url: `${this.baseURL}/v2/user/stories`,
        params: { user_id: userId },
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': host,
          'x-access-key': accessKey
        }
      };

      const response = await axios.request(options);
      
      if (response.data && response.data.reel && response.data.reel.items) {
        return response.data.reel.items.map(item => {
          let mediaUrl = null;
          
          // Определяем URL медиа (фото или видео)
          if (item.video_versions && item.video_versions.length > 0) {
            // Видео
            mediaUrl = item.video_versions[0].url;
          } else if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates.length > 0) {
            // Фото
            mediaUrl = item.image_versions2.candidates[0].url;
          }
          
          return {
            id: item.pk,
            mediaUrl,
            mediaType: item.video_versions ? 'video' : 'image',
            takenAt: item.taken_at,
            expiringAt: item.expiring_at,
            duration: item.video_duration || null,
            viewCount: item.view_count || 0,
            hasAudio: item.has_audio || false
          };
        });
      }
      
      return [];
    } catch (error) {
      console.error('Error getting user stories:', error.message);
      return [];
    }
  }

  // Get followers with pagination
  async getFollowers(userId, maxFollowers = 500) {
    try {
      const apiKey = process.env.RAPID_API_KEY;
      const host = process.env.RAPID_API_HOST;
      const accessKey = process.env.RAPID_API_ACCESS_KEY;
      
      const allFollowers = [];
      let nextPageId = null;
      let pageCount = 0;
      
      do {
        const options = {
          method: 'GET',
          url: `${this.baseURL}/v2/user/followers`,
          params: {
            user_id: userId,
            ...(nextPageId && { page_id: nextPageId })
          },
          headers: {
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': host,
            'x-access-key': accessKey
          }
        };

        const response = await axios.request(options);
        
        if (response.data && response.data.response && response.data.response.users) {
          const followers = response.data.response.users.map(user => ({
            id: user.pk,
            username: user.username,
            fullName: user.full_name,
            profilePicUrl: user.profile_pic_url,
            isVerified: user.is_verified,
            isPrivate: user.is_private,
            followerCount: user.follower_count,
            followingCount: user.following_count,
            mediaCount: user.media_count,
            biography: user.biography,
            externalUrl: user.external_url
          }));
          
          allFollowers.push(...followers);
          nextPageId = response.data.next_page_id;
          pageCount++;
          
          // Check if we've reached the limit
          if (allFollowers.length >= maxFollowers) {
            allFollowers.splice(maxFollowers);
            break;
          }
          
          // Rate limiting - wait between requests
          if (pageCount > 1) {
            await this.delay(1000); // 1 second delay
          }
        } else {
          break;
        }
      } while (nextPageId && allFollowers.length < maxFollowers);
      
      return allFollowers;
    } catch (error) {
      console.error('Error getting followers:', error.message);
      throw error;
    }
  }

  // Get following with pagination
  async getFollowing(userId, maxFollowing = 500) {
    try {
      const apiKey = process.env.RAPID_API_KEY;
      const host = process.env.RAPID_API_HOST;
      const accessKey = process.env.RAPID_API_ACCESS_KEY;
      
      const allFollowing = [];
      let nextPageId = null;
      let pageCount = 0;
      
      do {
        const options = {
          method: 'GET',
          url: `${this.baseURL}/v2/user/following`,
          params: {
            user_id: userId,
            ...(nextPageId && { page_id: nextPageId })
          },
          headers: {
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': host,
            'x-access-key': accessKey
          }
        };

        const response = await axios.request(options);
        
        if (response.data && response.data.response && response.data.response.users) {
          const following = response.data.response.users.map(user => ({
            id: user.pk,
            username: user.username,
            fullName: user.full_name,
            profilePicUrl: user.profile_pic_url,
            isVerified: user.is_verified,
            isPrivate: user.is_private,
            followerCount: user.follower_count,
            followingCount: user.following_count,
            mediaCount: user.media_count,
            biography: user.biography,
            externalUrl: user.external_url
          }));
          
          allFollowing.push(...following);
          nextPageId = response.data.next_page_id;
          pageCount++;
          
          // Check if we've reached the limit
          if (allFollowing.length >= maxFollowing) {
            allFollowing.splice(maxFollowing);
            break;
          }
          
          // Rate limiting - wait between requests
          if (pageCount > 1) {
            await this.delay(1000); // 1 second delay
          }
        } else {
          break;
        }
      } while (nextPageId && allFollowing.length < maxFollowing);
      
      return allFollowing;
    } catch (error) {
      console.error('Error getting following:', error.message);
      throw error;
    }
  }

  // Get recent activity (followers + following) - RANDOM for regular search
  async getRecentActivity(username, userSubscription = 'free') {
    const startTime = Date.now();
    try {
      // Get user info first
      const userInfo = await this.getUserInfo(username);
      
      if (!userInfo) {
        throw new Error('User not found or private');
      }

      // Determine follower limit - we'll process max 500 followers regardless of account size
      const maxFollowers = this.getMaxFollowersBySubscription(userSubscription);

      // Get cached data for comparison
      let cachedData = await InstagramCache.findOne({ where: { username } });
      let previousFollowers = [];
      let previousFollowing = [];

      if (cachedData) {
        previousFollowers = cachedData.followers || [];
        previousFollowing = cachedData.following || [];
      }

      // Get fresh data and stories
      const userId = userInfo.id || userInfo.pk;
      const [followers, following, stories] = await Promise.all([
        this.getFollowers(userId, maxFollowers),
        this.getFollowing(userId, maxFollowers),
        this.getUserStories(userId)
      ]);

      // Update cache
      cachedData = await this.updateCache(username, {
        userData: userInfo,
        followers,
        following
      });

      // Find new followers/following using random generation logic
      const newFollowers = this.generateRandomNewUsers(followers, previousFollowers, 'followers');
      const newFollowing = this.generateRandomNewUsers(following, previousFollowing, 'following');

      // Add red flags and stories only for premium users
      let redFlags = null;
      let premiumStories = null;

      if (userSubscription === 'premium') {
        redFlags = this.analyzeRedFlags(userInfo);
        premiumStories = stories;
      }

      return {
        userInfo,
        newFollowers,
        newFollowing,
        stories: premiumStories,
        redFlags,
        totalNewFollowers: newFollowers.length,
        totalNewFollowing: newFollowing.length,
        lastUpdated: new Date(),
        totalFollowers: followers.length,
        totalFollowing: following.length,
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      console.error('Error getting recent activity:', error.message);
      throw error;
    }
  }

  // Get advanced activity (followers + following) - REAL DATA for advanced search
  async getAdvancedActivity(username, userSubscription = 'free') {
    const startTime = Date.now();
    try {
      // Get user info first
      const userInfo = await this.getUserInfo(username);
      
      if (!userInfo) {
        throw new Error('User not found or private');
      }

      // Determine follower limit - we'll process max 500 followers regardless of account size
      const maxFollowers = this.getMaxFollowersBySubscription(userSubscription);

      // Get cached data for comparison
      let cachedData = await InstagramCache.findOne({ where: { username } });
      let previousFollowers = [];
      let previousFollowing = [];

      if (cachedData) {
        previousFollowers = cachedData.followers || [];
        previousFollowing = cachedData.following || [];
      }

      // Get fresh data and stories
      const userId = userInfo.id || userInfo.pk;
      const [followers, following, stories] = await Promise.all([
        this.getFollowers(userId, maxFollowers),
        this.getFollowing(userId, maxFollowers),
        this.getUserStories(userId)
      ]);

      // Update cache
      cachedData = await this.updateCache(username, {
        userData: userInfo,
        followers,
        following
      });

      // Find REAL new followers/following (no random generation)
      const newFollowers = this.findNewUsers(followers, previousFollowers);
      const newFollowing = this.findNewUsers(following, previousFollowing);

      // Add red flags and stories only for premium users
      let redFlags = null;
      let premiumStories = null;

      if (userSubscription === 'premium') {
        redFlags = this.analyzeRedFlags(userInfo);
        premiumStories = stories;
      }

      return {
        userInfo,
        newFollowers,
        newFollowing,
        stories: premiumStories,
        redFlags,
        totalNewFollowers: newFollowers.length,
        totalNewFollowing: newFollowing.length,
        lastUpdated: new Date(),
        totalFollowers: followers.length,
        totalFollowing: following.length,
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      console.error('Error getting advanced activity:', error.message);
      throw error;
    }
  }

  // Helper methods
  getMaxFollowersBySubscription(subscription) {
    // Always return the same limit regardless of subscription
    return this.maxFollowersLimit;
  }

  findNewUsers(currentUsers, previousUsers) {
    const previousIds = new Set(previousUsers.map(user => user.id));
    return currentUsers.filter(user => !previousIds.has(user.id));
  }

  generateRandomNewUsers(currentUsers, previousUsers, type) {
    // If no previous data, generate 1-15 random "new" users from current data
    if (!previousUsers || previousUsers.length === 0) {
      const count = Math.floor(Math.random() * 15) + 1; // 1 to 15
      const shuffled = [...currentUsers].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, Math.min(count, currentUsers.length));
    }

    // If we have previous data, find actual new users
    const newUsers = this.findNewUsers(currentUsers, previousUsers);
    
    // If no actual new users, generate 1-5 random "new" users
    if (newUsers.length === 0) {
      const count = Math.floor(Math.random() * 5) + 1; // 1 to 5
      const shuffled = [...currentUsers].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, Math.min(count, currentUsers.length));
    }

    return newUsers;
  }

  async updateCache(username, data) {
    try {
      const [cachedData, created] = await InstagramCache.findOrCreate({
        where: { username },
        defaults: {
          username,
          userData: data.userData,
          followers: data.followers,
          following: data.following,
          totalFollowers: data.followers.length,
          totalFollowing: data.following.length,
          lastFullUpdate: new Date(),
          lastFollowersUpdate: new Date(),
          lastFollowingUpdate: new Date(),
          isStale: false
        }
      });

      if (!created) {
        await cachedData.update({
          userData: data.userData,
          followers: data.followers,
          following: data.following,
          totalFollowers: data.followers.length,
          totalFollowing: data.following.length,
          lastFullUpdate: new Date(),
          lastFollowersUpdate: new Date(),
          lastFollowingUpdate: new Date(),
          isStale: false
        });
      }

      return cachedData;
    } catch (error) {
      console.error('Error updating cache:', error);
      throw error;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }



  // Rate limiting check
  async checkRateLimit() {
    const now = Date.now();
    if (now - this.lastReset > 3600000) { // 1 hour
      this.requestCount = 0;
      this.lastReset = now;
    }

    if (this.requestCount >= this.rateLimit) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    this.requestCount++;
  }
}

export default new RapidApiService(); 