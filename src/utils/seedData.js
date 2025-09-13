import { faker } from '@faker-js/faker';
import User from '../models/User.js';
import SearchHistory from '../models/SearchHistory.js';
import InstagramCache from '../models/InstagramCache.js';
import connectDB from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

// Function to create sample users
const createSampleUsers = async (count = 10) => {
  const users = [];
  
  for (let i = 0; i < count; i++) {
    const user = {
      username: faker.internet.userName(),
      email: faker.internet.email(),
      password: 'password123',
      role: i === 0 ? 'admin' : 'user',
      subscription: {
        plan: faker.helpers.arrayElement(['free', 'premium', 'professional']),
        status: 'active',
        startDate: faker.date.past({ years: 1 }),
        endDate: faker.date.future({ years: 1 })
      },
      usage: {
        searchesToday: faker.number.int({ min: 0, max: 10 }),
        searchesThisMonth: faker.number.int({ min: 0, max: 100 }),
        totalSearches: faker.number.int({ min: 0, max: 500 })
      },
      profile: {
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        bio: faker.lorem.sentence(),
        website: faker.internet.url()
      },
      isEmailVerified: faker.datatype.boolean({ probability: 0.8 }),
      lastLogin: faker.date.recent({ days: 30 })
    };
    
    users.push(user);
  }
  
  return User.insertMany(users);
};

// Function to create sample search history
const createSampleSearchHistory = async (users, count = 50) => {
  const searches = [];
  
  for (let i = 0; i < count; i++) {
    const user = faker.helpers.arrayElement(users);
    const targetUsername = faker.internet.userName();
    
    const search = {
      user: Math.random() > 0.3 ? user._id : null, // 30% anonymous searches
      targetUsername,
      searchType: faker.helpers.arrayElement(['followers', 'following', 'both']),
      ipAddress: faker.internet.ip(),
      userAgent: faker.internet.userAgent(),
      results: {
        newFollowers: Array.from({ length: faker.number.int({ min: 0, max: 10 }) }, () => ({
          username: faker.internet.userName(),
          fullName: faker.person.fullName(),
          profilePicUrl: faker.image.avatar(),
          isVerified: faker.datatype.boolean({ probability: 0.1 }),
          followedDate: faker.date.recent({ days: 7 }),
          followerCount: faker.number.int({ min: 100, max: 10000 }),
          followingCount: faker.number.int({ min: 50, max: 5000 }),
          mediaCount: faker.number.int({ min: 10, max: 1000 })
        })),
        newFollowing: Array.from({ length: faker.number.int({ min: 0, max: 5 }) }, () => ({
          username: faker.internet.userName(),
          fullName: faker.person.fullName(),
          profilePicUrl: faker.image.avatar(),
          isVerified: faker.datatype.boolean({ probability: 0.1 }),
          followedDate: faker.date.recent({ days: 7 }),
          followerCount: faker.number.int({ min: 100, max: 10000 }),
          followingCount: faker.number.int({ min: 50, max: 5000 }),
          mediaCount: faker.number.int({ min: 10, max: 1000 })
        }))
      },
      metadata: {
        processingTime: faker.number.int({ min: 500, max: 5000 }),
        dataSource: faker.helpers.arrayElement(['instagram_api', 'scraper', 'cache']),
        cacheHit: faker.datatype.boolean({ probability: 0.3 })
      },
      status: faker.helpers.arrayElement(['completed', 'failed']),
      createdAt: faker.date.recent({ days: 30 })
    };
    
    searches.push(search);
  }
  
  return SearchHistory.insertMany(searches);
};

// Function to create sample Instagram cache
const createSampleInstagramCache = async (count = 20) => {
  const cacheEntries = [];
  
  for (let i = 0; i < count; i++) {
    const username = faker.internet.userName();
    
    const entry = {
      username,
      userData: {
        id: faker.string.uuid(),
        username,
        fullName: faker.person.fullName(),
        biography: faker.lorem.sentence(),
        profilePicUrl: faker.image.avatar(),
        isVerified: faker.datatype.boolean({ probability: 0.1 }),
        isPrivate: faker.datatype.boolean({ probability: 0.2 }),
        followerCount: faker.number.int({ min: 100, max: 100000 }),
        followingCount: faker.number.int({ min: 50, max: 5000 }),
        mediaCount: faker.number.int({ min: 10, max: 1000 })
      },
      followers: Array.from({ length: faker.number.int({ min: 10, max: 50 }) }, () => ({
        id: faker.string.uuid(),
        username: faker.internet.userName(),
        fullName: faker.person.fullName(),
        profilePicUrl: faker.image.avatar(),
        isVerified: faker.datatype.boolean({ probability: 0.05 }),
        followerCount: faker.number.int({ min: 50, max: 5000 }),
        followingCount: faker.number.int({ min: 20, max: 1000 }),
        mediaCount: faker.number.int({ min: 5, max: 500 }),
        lastSeen: faker.date.recent({ days: 30 })
      })),
      following: Array.from({ length: faker.number.int({ min: 5, max: 30 }) }, () => ({
        id: faker.string.uuid(),
        username: faker.internet.userName(),
        fullName: faker.person.fullName(),
        profilePicUrl: faker.image.avatar(),
        isVerified: faker.datatype.boolean({ probability: 0.05 }),
        followerCount: faker.number.int({ min: 50, max: 5000 }),
        followingCount: faker.number.int({ min: 20, max: 1000 }),
        mediaCount: faker.number.int({ min: 5, max: 500 }),
        lastSeen: faker.date.recent({ days: 30 })
      })),
      metadata: {
        lastFullUpdate: faker.date.recent({ days: 1 }),
        lastFollowersUpdate: faker.date.recent({ days: 1 }),
        lastFollowingUpdate: faker.date.recent({ days: 1 }),
        isStale: faker.datatype.boolean({ probability: 0.2 })
      }
    };
    
    cacheEntries.push(entry);
  }
  
  return InstagramCache.insertMany(cacheEntries);
};

// Main seeding function
const seedDatabase = async () => {
  try {
    console.log('🌱 Starting database seeding...');
    
    await connectDB();
    
    // Clear existing data
    console.log('🧹 Clearing existing data...');
    await User.deleteMany({});
    await SearchHistory.deleteMany({});
    await InstagramCache.deleteMany({});
    
    // Create sample data
    console.log('👥 Creating sample users...');
    const users = await createSampleUsers(15);
    console.log(`✅ Created ${users.length} users`);
    
    console.log('🔍 Creating sample search history...');
    const searches = await createSampleSearchHistory(users, 100);
    console.log(`✅ Created ${searches.length} search records`);
    
    console.log('💾 Creating sample Instagram cache...');
    const cacheEntries = await createSampleInstagramCache(30);
    console.log(`✅ Created ${cacheEntries.length} cache entries`);
    
    console.log('🎉 Database seeding completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`Users: ${users.length}`);
    console.log(`Search History: ${searches.length}`);
    console.log(`Cache Entries: ${cacheEntries.length}`);
    
    console.log('\n👤 Admin User:');
    console.log(`Email: ${users[0].email}`);
    console.log(`Password: password123`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

// Run seeding if this file is executed directly
if (process.argv[2] === 'seed') {
  seedDatabase();
}

export { seedDatabase, createSampleUsers, createSampleSearchHistory, createSampleInstagramCache };