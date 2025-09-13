import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const InstagramCache = sequelize.define('InstagramCache', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  userData: {
    type: DataTypes.JSONB,
    allowNull: false,
    field: 'user_data'
  },
  followers: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  following: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  
  // Metadata
  lastFullUpdate: {
    type: DataTypes.DATE,
    field: 'last_full_update'
  },
  lastFollowersUpdate: {
    type: DataTypes.DATE,
    field: 'last_followers_update'
  },
  lastFollowingUpdate: {
    type: DataTypes.DATE,
    field: 'last_following_update'
  },
  totalFollowers: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'total_followers'
  },
  totalFollowing: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'total_following'
  },
  updateFrequency: {
    type: DataTypes.INTEGER,
    defaultValue: 60,
    field: 'update_frequency'
  },
  isStale: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_stale'
  }
}, {
  tableName: 'instagram_cache',
  indexes: [
    { fields: ['username'] },
    { fields: ['last_full_update'] },
    { fields: ['is_stale'] }
  ]
});

// Instance methods
InstagramCache.prototype.isFresh = function(maxAgeMinutes = 60) {
  if (!this.lastFullUpdate) return false;
  
  const ageInMinutes = (Date.now() - this.lastFullUpdate.getTime()) / (1000 * 60);
  return ageInMinutes < maxAgeMinutes;
};

InstagramCache.prototype.getNewFollowers = function(previousFollowers = []) {
  const currentFollowerIds = new Set(this.followers.map(f => f.id));
  const previousFollowerIds = new Set(previousFollowers.map(f => f.id));
  
  return this.followers.filter(follower => 
    !previousFollowerIds.has(follower.id)
  );
};

InstagramCache.prototype.getNewFollowing = function(previousFollowing = []) {
  const currentFollowingIds = new Set(this.following.map(f => f.id));
  const previousFollowingIds = new Set(previousFollowing.map(f => f.id));
  
  return this.following.filter(following => 
    !previousFollowingIds.has(following.id)
  );
};

InstagramCache.prototype.markAsStale = async function() {
  this.isStale = true;
  return await this.save();
};

// Static methods
InstagramCache.cleanupOldEntries = async function(daysOld = 30) {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  return await this.destroy({
    where: {
      lastFullUpdate: {
        [sequelize.Sequelize.Op.lt]: cutoff
      }
    }
  });
};

export default InstagramCache;