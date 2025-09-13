import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

const ApiLog = sequelize.define('ApiLog', {
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
  endpoint: {
    type: DataTypes.STRING,
    allowNull: false
  },
  method: {
    type: DataTypes.STRING(10),
    allowNull: false
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
  requestBody: {
    type: DataTypes.JSONB,
    field: 'request_body'
  },
  responseStatus: {
    type: DataTypes.INTEGER,
    field: 'response_status'
  },
  responseTime: {
    type: DataTypes.INTEGER,
    field: 'response_time'
  },
  errorMessage: {
    type: DataTypes.TEXT,
    field: 'error_message'
  }
}, {
  tableName: 'api_logs',
  updatedAt: false, // Логи не обновляются
  indexes: [
    { fields: ['user_id'] },
    { fields: ['endpoint'] },
    { fields: ['created_at'] },
    { fields: ['response_status'] }
  ]
});

// Associations
ApiLog.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

User.hasMany(ApiLog, {
  foreignKey: 'userId',
  as: 'apiLogs'
});

export default ApiLog;