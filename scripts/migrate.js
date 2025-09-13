import dotenv from 'dotenv';
import { connectDB } from '../src/config/database.js';
import runMigrations from '../src/config/migrations.js';

dotenv.config();

const runMigrationScript = async () => {
  try {
    console.log('🚀 Starting migration script...');
    
    // Подключаемся к базе данных
    await connectDB();
    
    // Запускаем миграции
    await runMigrations();
    
    console.log('✅ Migration script completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration script failed:', error);
    process.exit(1);
  }
};

runMigrationScript(); 