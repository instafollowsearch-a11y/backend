import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const BlockedIp = sequelize.define(
  'BlockedIp',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    ip: {
      type: DataTypes.INET,
      allowNull: false,
      unique: true,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    anonId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'anon_id',
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'user_id',
    },
    actorLogin: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: 'admin',
      field: 'actor_login',
    },
  },
  {
    tableName: 'blocked_ips',
    updatedAt: false,
    underscored: true,
    indexes: [{ unique: true, fields: ['ip'] }],
  }
);

export default BlockedIp;
