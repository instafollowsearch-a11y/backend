import { sequelize } from '../src/config/database.js';
import { QueryTypes } from 'sequelize';

async function addStripeCustomerIdColumn() {
  try {
    console.log('Adding stripe_customer_id column to users table...');
    
    await sequelize.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
    `, { type: QueryTypes.RAW });
    
    console.log('✅ stripe_customer_id column added successfully');
    
    // Add index for better performance
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id 
      ON users(stripe_customer_id);
    `, { type: QueryTypes.RAW });
    
    console.log('✅ Index created for stripe_customer_id column');
    
  } catch (error) {
    console.error('❌ Error adding stripe_customer_id column:', error);
    throw error;
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    
    await addStripeCustomerIdColumn();
    
    console.log('🎉 Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
