import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const AdminAccount = sequelize.define(
  'AdminAccount',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    login: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'password_hash',
    },
  },
  {
    tableName: 'admin_accounts',
    underscored: true,
    timestamps: true,
  }
);

export default AdminAccount;
