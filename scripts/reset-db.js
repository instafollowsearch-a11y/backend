import dotenv from 'dotenv';
import { sequelize } from '../src/config/database.js';

dotenv.config();

const resetDatabase = async () => {
  try {
    console.log('⚠️  WARNING: This will delete ALL data from the database!');
    console.log('This script should only be used in development.');
    
    // Проверяем, что мы в режиме разработки
    if (process.env.NODE_ENV !== 'development') {
      console.error('❌ This script can only be run in development mode');
      process.exit(1);
    }
    
    // Подключаемся к базе данных
    await sequelize.authenticate();
    console.log('📊 Database connected');
    
    // Удаляем все таблицы
    console.log('🗑️  Dropping all tables...');
    await sequelize.drop();
    console.log('✅ All tables dropped');
    
    // Создаем таблицы заново
    console.log('📋 Creating tables...');
    await sequelize.sync({ force: true });
    console.log('✅ Tables created');
    
    console.log('🎉 Database reset completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database reset failed:', error);
    process.exit(1);
  }
};

resetDatabase(); 