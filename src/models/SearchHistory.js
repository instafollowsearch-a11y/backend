import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

const SearchHistory = sequelize.define('SearchHistory', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'user_id',
    references: {
      model: User,
      key: 'id'
    }
  },
  targetUsername: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'target_username'
  },
  searchType: {
    type: DataTypes.ENUM('followers', 'following', 'both'),
    defaultValue: 'both',
    field: 'search_type'
  },
  ipAddress: {
    type: DataTypes.INET,
    allowNull: false,
    field: 'ip_address'
  },
  userAgent: {
    type: DataTypes.TEXT,
    field: 'user_agent'
  },
  
  // Results
  newFollowers: {
    type: DataTypes.JSONB,
    defaultValue: [],
    field: 'new_followers'
  },
  newFollowing: {
    type: DataTypes.JSONB,
    defaultValue: [],
    field: 'new_following'
  },
  totalNewFollowers: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'total_new_followers'
  },
  totalNewFollowing: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'total_new_following'
  },
  
  // Metadata
  processingTime: {
    type: DataTypes.INTEGER,
    field: 'processing_time'
  },
  dataSource: {
    type: DataTypes.STRING(50),
    defaultValue: 'scraper',
    field: 'data_source'
  },
  cacheHit: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'cache_hit'
  },
  lastUpdated: {
    type: DataTypes.DATE,
    field: 'last_updated'
  },
  
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'failed', 'rate_limited'),
    defaultValue: 'pending'
  },
  errorMessage: {
    type: DataTypes.TEXT,
    field: 'error_message'
  },
  results: {
    type: DataTypes.JSONB,
    defaultValue: null
  }
}, {
  tableName: 'search_history',
  indexes: [
    { fields: ['user_id', 'created_at'] },
    { fields: ['target_username', 'created_at'] },
    { fields: ['ip_address', 'created_at'] },
    { fields: ['created_at'] },
    { fields: ['status'] }
  ]
});

// Update totals before saving
SearchHistory.beforeSave((searchHistory) => {
  if (searchHistory.newFollowers) {
    searchHistory.totalNewFollowers = searchHistory.newFollowers.length;
  }
  if (searchHistory.newFollowing) {
    searchHistory.totalNewFollowing = searchHistory.newFollowing.length;
  }
});

// Static methods
SearchHistory.getTodaySearchCount = async function(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return await this.count({
    where: {
      userId,
      created_at: {
        [sequelize.Sequelize.Op.gte]: today
      },
      status: 'completed'
    }
  });
};

SearchHistory.getTodaySearchCountByIP = async function(ipAddress) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return await this.count({
    where: {
      ipAddress,
      created_at: {
        [sequelize.Sequelize.Op.gte]: today
      },
      status: 'completed'
    }
  });
};

SearchHistory.getRecentSearch = async function(username, maxAgeMinutes = 5) {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  
  return await this.findOne({
    where: {
      targetUsername: username,
      status: 'completed',
      created_at: {
        [sequelize.Sequelize.Op.gte]: cutoff
      }
    },
    order: [['created_at', 'DESC']]
  });
};



export default SearchHistory;