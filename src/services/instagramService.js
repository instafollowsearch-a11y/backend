import axios from 'axios';
import { faker } from '@faker-js/faker';
import InstagramCache from '../models/InstagramCache.js';

class InstagramService {
  constructor() {
    this.baseURL = process.env.INSTAGRAM_API_BASE_URL;
    this.accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  }

  // Main method to get recent followers/following
  async getRecentActivity(username, type = 'both') {
    try {
      // Check if user exists and is public
      const userInfo = await this.getUserInfo(username);
      if (!userInfo) {
        throw new Error('User not found or private');
      }

      // Get cached data
      let cachedData = await InstagramCache.findOne({ username });
      let previousFollowers = [];
      let previousFollowing = [];

      if (cachedData) {
        previousFollowers = [...cachedData.followers];
        previousFollowing = [...cachedData.following];
      }

      // Get fresh data (in real app, this would call Instagram API)
      const freshData = await this.fetchFreshUserData(username);

      // Update cache
      cachedData = await this.updateCache(username, freshData);

      // Compare and find new followers/following
      const result = {
        user: userInfo,
        newFollowers: [],
        newFollowing: [],
        totalNewFollowers: 0,
        totalNewFollowing: 0,
        lastUpdated: new Date()
      };

      if (type === 'followers' || type === 'both') {
        result.newFollowers = cachedData.getNewFollowers(previousFollowers);
        result.totalNewFollowers = result.newFollowers.length;
      }

      if (type === 'following' || type === 'both') {
        result.newFollowing = cachedData.getNewFollowing(previousFollowing);
        result.totalNewFollowing = result.newFollowing.length;
      }

      return result;
    } catch (error) {
      console.error('Instagram service error:', error);
      throw error;
    }
  }

  // Get basic user information
  async getUserInfo(username) {
    try {
      // In a real implementation, this would call Instagram API
      // For demo purposes, we'll generate mock data
      const userExists = await this.checkUserExists(username);
      if (!userExists) return null;

      return {
        username,
        fullName: faker.person.fullName(),
        biography: faker.lorem.sentence(),
        profilePicUrl: faker.image.avatar(),
        isVerified: faker.datatype.boolean({ probability: 0.1 }),
        isPrivate: faker.datatype.boolean({ probability: 0.3 }),
        followerCount: faker.number.int({ min: 100, max: 100000 }),
        followingCount: faker.number.int({ min: 50, max: 5000 }),
        mediaCount: faker.number.int({ min: 10, max: 1000 }),
        externalUrl: faker.datatype.boolean({ probability: 0.3 }) ? faker.internet.url() : null
      };
    } catch (error) {
      console.error('Error getting user info:', error);
      return null;
    }
  }

  // Check if user exists (mock implementation)
  async checkUserExists(username) {
    // In real implementation, this would check Instagram API
    // For demo, we'll say user exists if username length > 3
    return username && username.length >= 3;
  }

  // Fetch fresh user data (mock implementation)
  async fetchFreshUserData(username) {
    // In real implementation, this would call Instagram API
    // For demo purposes, we generate realistic mock data
    
    const followerCount = faker.number.int({ min: 50, max: 1000 });
    const followingCount = faker.number.int({ min: 20, max: 500 });

    const followers = Array.from({ length: Math.min(followerCount, 100) }, () => ({
      id: faker.string.uuid(),
      username: faker.internet.userName(),
      fullName: faker.person.fullName(),
      profilePicUrl: faker.image.avatar(),
      isVerified: faker.datatype.boolean({ probability: 0.05 }),
      followerCount: faker.number.int({ min: 10, max: 10000 }),
      followingCount: faker.number.int({ min: 10, max: 1000 }),
      mediaCount: faker.number.int({ min: 0, max: 500 }),
      lastSeen: faker.date.recent({ days: 30 })
    }));

    const following = Array.from({ length: Math.min(followingCount, 100) }, () => ({
      id: faker.string.uuid(),
      username: faker.internet.userName(),
      fullName: faker.person.fullName(),
      profilePicUrl: faker.image.avatar(),
      isVerified: faker.datatype.boolean({ probability: 0.05 }),
      followerCount: faker.number.int({ min: 10, max: 10000 }),
      followingCount: faker.number.int({ min: 10, max: 1000 }),
      mediaCount: faker.number.int({ min: 0, max: 500 }),
      lastSeen: faker.date.recent({ days: 30 })
    }));

    // Simulate some users being "new" by giving them recent lastSeen dates
    const recentFollowers = followers.slice(0, faker.number.int({ min: 0, max: 5 }))
      .map(follower => ({
        ...follower,
        lastSeen: faker.date.recent({ days: 1 })
      }));

    const recentFollowing = following.slice(0, faker.number.int({ min: 0, max: 3 }))
      .map(follow => ({
        ...follow,
        lastSeen: faker.date.recent({ days: 1 })
      }));

    return {
      userData: {
        id: faker.string.uuid(),
        username,
        fullName: faker.person.fullName(),
        biography: faker.lorem.sentence(),
        profilePicUrl: faker.image.avatar(),
        isVerified: faker.datatype.boolean({ probability: 0.1 }),
        isPrivate: false, // We only return data for public accounts
        followerCount,
        followingCount,
        mediaCount: faker.number.int({ min: 10, max: 1000 }),
        externalUrl: faker.datatype.boolean({ probability: 0.3 }) ? faker.internet.url() : null
      },
      followers: [...recentFollowers, ...followers.slice(recentFollowers.length)],
      following: [...recentFollowing, ...following.slice(recentFollowing.length)]
    };
  }

  // Update cache with fresh data
  async updateCache(username, freshData) {
    try {
      const updateData = {
        username,
        userData: freshData.userData,
        followers: freshData.followers,
        following: freshData.following,
        metadata: {
          lastFullUpdate: new Date(),
          lastFollowersUpdate: new Date(),
          lastFollowingUpdate: new Date(),
          totalFollowers: freshData.followers.length,
          totalFollowing: freshData.following.length,
          isStale: false
        }
      };

      const cachedData = await InstagramCache.findOneAndUpdate(
        { username },
        updateData,
        { upsert: true, new: true }
      );

      return cachedData;
    } catch (error) {
      console.error('Error updating cache:', error);
      throw error;
    }
  }

  // Get cached data if fresh enough
  async getCachedData(username, maxAgeMinutes = 60) {
    try {
      const cachedData = await InstagramCache.findOne({ username });
      
      if (!cachedData || !cachedData.isFresh(maxAgeMinutes)) {
        return null;
      }

      return cachedData;
    } catch (error) {
      console.error('Error getting cached data:', error);
      return null;
    }
  }

  // Clean up old cache entries
  async cleanupCache(daysOld = 30) {
    try {
      const result = await InstagramCache.cleanupOldEntries(daysOld);
      console.log(`Cleaned up ${result.deletedCount} old cache entries`);
      return result;
    } catch (error) {
      console.error('Error cleaning up cache:', error);
      throw error;
    }
  }

  // Get analytics for admin
  async getAnalytics() {
    try {
      const totalCachedUsers = await InstagramCache.countDocuments();
      const staleCacheCount = await InstagramCache.countDocuments({ 'metadata.isStale': true });
      const recentUpdates = await InstagramCache.countDocuments({
        'metadata.lastFullUpdate': { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });

      return {
        totalCachedUsers,
        staleCacheCount,
        recentUpdates,
        cacheHitRate: staleCacheCount > 0 ? ((totalCachedUsers - staleCacheCount) / totalCachedUsers * 100).toFixed(2) : 100
      };
    } catch (error) {
      console.error('Error getting analytics:', error);
      throw error;
    }
  }
}

export default new InstagramService();