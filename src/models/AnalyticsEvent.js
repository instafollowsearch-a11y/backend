import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const AnalyticsEvent = sequelize.define(
  'AnalyticsEvent',
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    event: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    path: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'user_id',
    },
    anonId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'anon_id',
    },
    props: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    utmSource: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: 'utm_source',
    },
    utmMedium: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: 'utm_medium',
    },
    utmCampaign: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: 'utm_campaign',
    },
    country: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    region: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING(128),
      allowNull: true,
    },
    clientIp: {
      type: DataTypes.INET,
      allowNull: true,
      field: 'client_ip',
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'user_agent',
    },
    requestOrigin: {
      type: DataTypes.STRING(512),
      allowNull: true,
      field: 'request_origin',
    },
    ts: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'analytics_events',
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ['ts'] },
      { fields: ['event'] },
      { fields: ['user_id'] },
      { fields: ['path'] },
      { fields: ['country'] },
      { fields: ['anon_id'] },
      { fields: ['client_ip'] },
    ],
  }
);

export default AnalyticsEvent;
