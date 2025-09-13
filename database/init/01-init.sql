-- Инициализация базы данных RecentFollow
-- Создание расширений и настройка

-- Включение расширений
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Создание типов данных
CREATE TYPE user_role AS ENUM ('user', 'premium', 'admin');
CREATE TYPE subscription_plan AS ENUM ('free', 'premium', 'professional');
CREATE TYPE subscription_status AS ENUM ('active', 'inactive', 'cancelled');
CREATE TYPE search_type AS ENUM ('followers', 'following', 'both');
CREATE TYPE search_status AS ENUM ('pending', 'completed', 'failed', 'rate_limited');
CREATE TYPE theme_type AS ENUM ('light', 'dark', 'auto');

-- Функция для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';