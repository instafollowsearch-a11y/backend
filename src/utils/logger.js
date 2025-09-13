// Simple logger utility for development
export const logger = {
  info: (message, data = null) => {
    console.log(`ℹ️  [INFO] ${new Date().toISOString()} - ${message}`);
    if (data) console.log(data);
  },
  
  error: (message, error = null) => {
    console.error(`❌ [ERROR] ${new Date().toISOString()} - ${message}`);
    if (error) console.error(error);
  },
  
  warn: (message, data = null) => {
    console.warn(`⚠️  [WARN] ${new Date().toISOString()} - ${message}`);
    if (data) console.warn(data);
  },
  
  success: (message, data = null) => {
    console.log(`✅ [SUCCESS] ${new Date().toISOString()} - ${message}`);
    if (data) console.log(data);
  }
};

export default logger;