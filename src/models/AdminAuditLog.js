import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const AdminAuditLog = sequelize.define(
  'AdminAuditLog',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    actorLogin: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'actor_login',
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    targetUserId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'target_user_id',
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'created_at',
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'admin_audit_logs',
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ['created_at'] },
      { fields: ['target_user_id'] },
      { fields: ['action'] },
    ],
  }
);

export default AdminAuditLog;
