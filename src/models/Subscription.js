import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const Subscription = sequelize.define('Subscription', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  plan: {
    type: DataTypes.ENUM('basic', 'premium'),
    allowNull: false,
    defaultValue: 'basic'
  },
  status: {
    type: DataTypes.ENUM('active', 'cancelled', 'expired'),
    allowNull: false,
    defaultValue: 'active'
  },
  startDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: false
  },
  searchesUsed: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  searchesLimit: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  stripeSubscriptionId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  stripeCustomerId: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'subscriptions',
  timestamps: true,
  underscored: true
});

export default Subscription; 