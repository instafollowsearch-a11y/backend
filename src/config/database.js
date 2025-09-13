import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

// PostgreSQL connection
const sequelize = new Sequelize(
  process.env.DATABASE_URL,
  {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: process.env.NODE_ENV === 'production' ? {
        require: true,
        rejectUnauthorized: false
      } : false
    },
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  }
);

// Test database connections
const connectDB = async () => {
  try {
    // Debug: Log database connection parameters
    
    
    // Test PostgreSQL connection
    await sequelize.authenticate();
    console.log('📊 PostgreSQL Connected successfully');
    
    // Импортируем модели для правильной синхронизации
    import('../models/index.js');
    
    // Run migrations instead of sync
    if (process.env.NODE_ENV === 'development') {
      const { runMigrations } = await import('./migrations.js');
      await runMigrations();
    }

  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async () => {
  try {
    await sequelize.close();
    console.log('🔌 Database connections closed');
  } catch (error) {
    console.error('❌ Error closing database connections:', error);
  }
};

// Handle shutdown signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

export { sequelize, connectDB };
export default sequelize;