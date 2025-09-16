import { sequelize } from './database.js';
import { DataTypes } from 'sequelize';

// Таблица для отслеживания миграций
const Migration = sequelize.define('Migration', {
  name: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  executedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'migrations',
  timestamps: false
});

// Список миграций
const migrations = [
  {
    name: '001_create_users_table',
    up: async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username VARCHAR(30) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(20) DEFAULT 'user',
          first_name VARCHAR(50) DEFAULT NULL,
          last_name VARCHAR(50) DEFAULT NULL,
          avatar_url TEXT DEFAULT NULL,
          bio TEXT DEFAULT NULL,
          website_url TEXT DEFAULT NULL,
          email_notifications BOOLEAN DEFAULT TRUE,
          marketing_emails BOOLEAN DEFAULT FALSE,
          theme VARCHAR(10) DEFAULT 'auto',
          is_email_verified BOOLEAN DEFAULT FALSE,
          email_verification_token VARCHAR(255) DEFAULT NULL,
          password_reset_token VARCHAR(255) DEFAULT NULL,
          password_reset_expires TIMESTAMP DEFAULT NULL,
          last_login TIMESTAMP DEFAULT NULL,
          login_attempts INTEGER DEFAULT 0,
          lock_until TIMESTAMP DEFAULT NULL,
          stripe_customer_id VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    name: '002_create_search_history_table',
    up: async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS search_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id),
          target_username VARCHAR(255) NOT NULL,
          search_type VARCHAR(20) DEFAULT 'both',
          ip_address INET NOT NULL,
          user_agent TEXT,
          new_followers JSONB DEFAULT '[]',
          new_following JSONB DEFAULT '[]',
          total_new_followers INTEGER DEFAULT 0,
          total_new_following INTEGER DEFAULT 0,
          processing_time INTEGER,
          data_source VARCHAR(50) DEFAULT 'scraper',
          cache_hit BOOLEAN DEFAULT false,
          last_updated TIMESTAMP,
          status VARCHAR(20) DEFAULT 'pending',
          error_message TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    name: '003_create_instagram_cache_table',
    up: async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS instagram_cache (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username VARCHAR(255) UNIQUE NOT NULL,
          user_data JSONB NOT NULL,
          followers JSONB DEFAULT '[]',
          following JSONB DEFAULT '[]',
          last_full_update TIMESTAMP,
          last_followers_update TIMESTAMP,
          last_following_update TIMESTAMP,
          total_followers INTEGER DEFAULT 0,
          total_following INTEGER DEFAULT 0,
          update_frequency INTEGER DEFAULT 60,
          is_stale BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    name: '004_create_subscriptions_table',
    up: async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id SERIAL PRIMARY KEY,
          user_id UUID REFERENCES users(id) NOT NULL,
          plan VARCHAR(20) NOT NULL DEFAULT 'basic',
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          end_date TIMESTAMP NOT NULL,
          searches_used INTEGER DEFAULT 0,
          searches_limit INTEGER NOT NULL,
          stripe_subscription_id VARCHAR(255),
          stripe_customer_id VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    name: '005_create_migrations_table',
    up: async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          name VARCHAR(255) PRIMARY KEY,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    name: '006_add_results_to_search_history',
    up: async () => {
      await sequelize.query(`
        ALTER TABLE search_history 
        ADD COLUMN IF NOT EXISTS results JSONB DEFAULT NULL;
      `);
    }
  },
  {
    name: '007_add_profile_fields_to_users',
    up: async () => {
      await sequelize.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS first_name VARCHAR(50) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS last_name VARCHAR(50) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS website_url TEXT DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS marketing_emails BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS theme VARCHAR(10) DEFAULT 'auto',
        ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS last_login TIMESTAMP DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS login_attempts INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS lock_until TIMESTAMP DEFAULT NULL;
      `);
    }
  },
  {
    name: '008_remove_username_unique_constraint',
    up: async () => {
      await sequelize.query(`
        ALTER TABLE users 
        DROP CONSTRAINT IF EXISTS users_username_key;
      `);
    }
  }
];

// Функция для выполнения миграций
export const runMigrations = async () => {
  try {
    console.log('🔄 Running database migrations...');
    
    // Создаем таблицу миграций если её нет
    await Migration.sync();
    
    // Получаем список выполненных миграций
    const executedMigrations = await Migration.findAll();
    const executedNames = executedMigrations.map(m => m.name);
    
    // Выполняем только новые миграции
    for (const migration of migrations) {
      if (!executedNames.includes(migration.name)) {
        console.log(`📋 Running migration: ${migration.name}`);
        await migration.up();
        
        // Записываем выполненную миграцию
        await Migration.create({ name: migration.name });
        console.log(`✅ Migration completed: ${migration.name}`);
      }
    }
    
    console.log('🎉 All migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

export default runMigrations; 