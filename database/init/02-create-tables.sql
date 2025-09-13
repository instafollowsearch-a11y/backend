-- Создание таблиц для RecentFollow

-- Таблица пользователей
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(30) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'user',
    
    -- Подписка
    subscription_plan subscription_plan DEFAULT 'free',
    subscription_status subscription_status DEFAULT 'active',
    subscription_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    subscription_end_date TIMESTAMP,
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    
    -- Использование
    searches_today INTEGER DEFAULT 0,
    searches_this_month INTEGER DEFAULT 0,
    total_searches INTEGER DEFAULT 0,
    last_search_date TIMESTAMP,
    
    -- Профиль
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    avatar_url TEXT,
    bio TEXT,
    website_url TEXT,
    
    -- Настройки
    email_notifications BOOLEAN DEFAULT TRUE,
    marketing_emails BOOLEAN DEFAULT FALSE,
    theme theme_type DEFAULT 'auto',
    
    -- Безопасность
    is_email_verified BOOLEAN DEFAULT FALSE,
    email_verification_token VARCHAR(255),
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP,
    last_login TIMESTAMP,
    login_attempts INTEGER DEFAULT 0,
    lock_until TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица истории поиска
CREATE TABLE search_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_username VARCHAR(255) NOT NULL,
    search_type search_type DEFAULT 'both',
    ip_address INET NOT NULL,
    user_agent TEXT,
    
    -- Результаты поиска
    new_followers JSONB DEFAULT '[]',
    new_following JSONB DEFAULT '[]',
    total_new_followers INTEGER DEFAULT 0,
    total_new_following INTEGER DEFAULT 0,
    
    -- Метаданные
    processing_time INTEGER, -- в миллисекундах
    data_source VARCHAR(50) DEFAULT 'scraper',
    cache_hit BOOLEAN DEFAULT FALSE,
    last_updated TIMESTAMP,
    
    status search_status DEFAULT 'pending',
    error_message TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица кэша Instagram данных
CREATE TABLE instagram_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) UNIQUE NOT NULL,
    
    -- Данные пользователя
    user_data JSONB NOT NULL,
    followers JSONB DEFAULT '[]',
    following JSONB DEFAULT '[]',
    
    -- Метаданные
    last_full_update TIMESTAMP,
    last_followers_update TIMESTAMP,
    last_following_update TIMESTAMP,
    total_followers INTEGER DEFAULT 0,
    total_following INTEGER DEFAULT 0,
    update_frequency INTEGER DEFAULT 60, -- в минутах
    is_stale BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица для логов API запросов
CREATE TABLE api_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT,
    request_body JSONB,
    response_status INTEGER,
    response_time INTEGER, -- в миллисекундах
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Триггеры для автоматического обновления updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_search_history_updated_at BEFORE UPDATE ON search_history 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_instagram_cache_updated_at BEFORE UPDATE ON instagram_cache 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Индексы для оптимизации
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_subscription_plan ON users(subscription_plan);
CREATE INDEX idx_users_last_login ON users(last_login);

CREATE INDEX idx_search_history_user_id ON search_history(user_id);
CREATE INDEX idx_search_history_target_username ON search_history(target_username);
CREATE INDEX idx_search_history_ip_address ON search_history(ip_address);
CREATE INDEX idx_search_history_created_at ON search_history(created_at);
CREATE INDEX idx_search_history_status ON search_history(status);

CREATE INDEX idx_instagram_cache_username ON instagram_cache(username);
CREATE INDEX idx_instagram_cache_last_full_update ON instagram_cache(last_full_update);
CREATE INDEX idx_instagram_cache_is_stale ON instagram_cache(is_stale);

CREATE INDEX idx_api_logs_user_id ON api_logs(user_id);
CREATE INDEX idx_api_logs_endpoint ON api_logs(endpoint);
CREATE INDEX idx_api_logs_created_at ON api_logs(created_at);