import { DataTypes } from 'sequelize';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sequelize from '../config/database.js';

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  username: {
    type: DataTypes.STRING(30),
    allowNull: false,
    validate: {
      len: [3, 30],
      is: /^[a-zA-Z0-9_]+$/
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  passwordHash: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'password_hash'
  },
  role: {
    type: DataTypes.ENUM('user', 'premium', 'admin'),
    defaultValue: 'user'
  },
  

  

  
  // Profile
  firstName: {
    type: DataTypes.STRING(50),
    field: 'first_name'
  },
  lastName: {
    type: DataTypes.STRING(50),
    field: 'last_name'
  },
  avatarUrl: {
    type: DataTypes.TEXT,
    field: 'avatar_url'
  },
  bio: {
    type: DataTypes.TEXT
  },
  websiteUrl: {
    type: DataTypes.TEXT,
    field: 'website_url',
    validate: {
      isUrl: true
    }
  },
  
  // Preferences
  emailNotifications: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'email_notifications'
  },
  marketingEmails: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'marketing_emails'
  },
  theme: {
    type: DataTypes.ENUM('light', 'dark', 'auto'),
    defaultValue: 'auto'
  },
  
  // Security
  isEmailVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_email_verified'
  },
  emailVerificationToken: {
    type: DataTypes.STRING,
    field: 'email_verification_token'
  },
  passwordResetToken: {
    type: DataTypes.STRING,
    field: 'password_reset_token'
  },
  passwordResetExpires: {
    type: DataTypes.DATE,
    field: 'password_reset_expires'
  },
  lastLogin: {
    type: DataTypes.DATE,
    field: 'last_login'
  },
  loginAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'login_attempts'
  },
  lockUntil: {
    type: DataTypes.DATE,
    field: 'lock_until'
  },
  
  // Stripe integration
  stripeCustomerId: {
    type: DataTypes.STRING,
    field: 'stripe_customer_id'
  }
}, {
  tableName: 'users',
  indexes: [
    { fields: ['email'] },
    { fields: ['username'] },
    { fields: ['last_login'] }
  ]
});

// Hash password before saving
User.beforeSave(async (user) => {
  if (user.changed('passwordHash')) {
    const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 10);
    user.passwordHash = await bcrypt.hash(user.passwordHash, salt);
  }
});

// Instance methods
User.prototype.getSignedJwtToken = function() {
  return jwt.sign({ id: this.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '24h'
  });
};

User.prototype.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.passwordHash);
};



User.prototype.hasActiveSubscription = function() {
  // Всегда возвращаем true, так как подписки теперь в отдельной таблице
  return true;
};



// Virtual for full name
User.prototype.getFullName = function() {
  return `${this.firstName || ''} ${this.lastName || ''}`.trim();
};

export default User;