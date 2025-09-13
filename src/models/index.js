import { sequelize } from '../config/database.js';
import User from './User.js';
import SearchHistory from './SearchHistory.js';
import InstagramCache from './InstagramCache.js';
import Subscription from './Subscription.js';

// Определяем связи между моделями
User.hasMany(SearchHistory, { foreignKey: 'userId', as: 'searchHistories' });
SearchHistory.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(Subscription, { foreignKey: 'userId', as: 'subscriptions' });
Subscription.belongsTo(User, { foreignKey: 'userId', as: 'user' });

export {
  sequelize,
  User,
  SearchHistory,
  InstagramCache,
  Subscription
};

// Синхронизация моделей
export const syncModels = async (options = {}) => {
  try {
    await sequelize.sync(options);
    console.log('📋 Database models synchronized');
  } catch (error) {
    console.error('❌ Error synchronizing models:', error);
    throw error;
  }
};

export default {
  sequelize,
  User,
  SearchHistory,
  InstagramCache,
  Subscription,
  syncModels
};