// src/database.js
const { Pool } = require('pg');
const config = require('./config');

class Database {
    constructor() {
        this.pool = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            if (!config.DATABASE_URL) {
                throw new Error('DATABASE_URL не указан');
            }

            this.pool = new Pool({
                connectionString: config.DATABASE_URL,
                ssl: { rejectUnauthorized: false }
            });

            const client = await this.pool.connect();
            await this.createTables();
            client.release();
            this.isConnected = true;
            console.log('✅ Подключено к Neon PostgreSQL!');
            return true;
        } catch (error) {
            console.error('❌ Ошибка подключения к БД:', error);
            throw error;
        }
    }

    async createTables() {
        try {
            const client = await this.pool.connect();

            await client.query(`
                CREATE TABLE IF NOT EXISTS accounts (
                    id SERIAL PRIMARY KEY,
                    phone VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) DEFAULT 'WhatsApp',
                    is_authenticated BOOLEAN DEFAULT FALSE,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    from_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                    to_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                    content TEXT NOT NULL,
                    type VARCHAR(20) DEFAULT 'text',
                    sent_at TIMESTAMP DEFAULT NOW()
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS stats (
                    id SERIAL PRIMARY KEY,
                    date DATE DEFAULT CURRENT_DATE,
                    messages_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS settings (
                    key VARCHAR(50) PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);

            client.release();
            console.log('✅ Все таблицы созданы/проверены');
        } catch (error) {
            console.error('❌ Ошибка создания таблиц:', error);
            throw error;
        }
    }

    async addAccount(phone, name = 'WhatsApp') {
        try {
            const client = await this.pool.connect();
            const result = await client.query(
                'INSERT INTO accounts (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO UPDATE SET name = $2, updated_at = NOW() RETURNING *',
                [phone, name]
            );
            client.release();
            console.log(`✅ Аккаунт ${phone} добавлен/обновлен`);
            return result.rows[0];
        } catch (error) {
            console.error('❌ Ошибка добавления аккаунта:', error);
            throw error;
        }
    }

    async getAccounts() {
        try {
            const client = await this.pool.connect();
            const result = await client.query('SELECT * FROM accounts ORDER BY created_at DESC');
            client.release();
            return result.rows;
        } catch (error) {
            console.error('❌ Ошибка получения аккаунтов:', error);
            throw error;
        }
    }

    async getAccount(phone) {
        try {
            const client = await this.pool.connect();
            const result = await client.query('SELECT * FROM accounts WHERE phone = $1', [phone]);
            client.release();
            return result.rows[0] || null;
        } catch (error) {
            console.error('❌ Ошибка получения аккаунта:', error);
            throw error;
        }
    }

    async updateAccountStatus(phone, isAuthenticated) {
        try {
            const client = await this.pool.connect();
            await client.query(
                'UPDATE accounts SET is_authenticated = $1, updated_at = NOW() WHERE phone = $2',
                [isAuthenticated, phone]
            );
            client.release();
            console.log(`✅ Статус аккаунта ${phone} обновлен: ${isAuthenticated}`);
        } catch (error) {
            console.error('❌ Ошибка обновления статуса:', error);
            throw error;
        }
    }

    async deleteAccount(phone) {
        try {
            const client = await this.pool.connect();
            await client.query(`
                DELETE FROM messages 
                WHERE from_account_id = (SELECT id FROM accounts WHERE phone = $1)
                   OR to_account_id = (SELECT id FROM accounts WHERE phone = $1)
            `, [phone]);
            await client.query('DELETE FROM accounts WHERE phone = $1', [phone]);
            client.release();
            console.log(`✅ Аккаунт ${phone} удален вместе с сообщениями`);
        } catch (error) {
            console.error('❌ Ошибка удаления аккаунта:', error);
            throw error;
        }
    }

    async saveMessage(fromAccountId, toAccountId, content, type = 'text') {
        try {
            const client = await this.pool.connect();
            const result = await client.query(
                `INSERT INTO messages (from_account_id, to_account_id, content, type) 
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [fromAccountId, toAccountId, content, type]
            );
            client.release();
            return result.rows[0];
        } catch (error) {
            console.error('❌ Ошибка сохранения сообщения:', error);
            throw error;
        }
    }

    async getMessages(limit = 50) {
        try {
            const client = await this.pool.connect();
            const result = await client.query(
                `SELECT * FROM messages ORDER BY sent_at DESC LIMIT $1`,
                [limit]
            );
            client.release();
            return result.rows;
        } catch (error) {
            console.error('❌ Ошибка получения сообщений:', error);
            throw error;
        }
    }

    async getStats() {
        try {
            const client = await this.pool.connect();
            const result = await client.query(`
                SELECT 
                    COUNT(DISTINCT a.id) as total_accounts,
                    COUNT(DISTINCT a.id) FILTER (WHERE a.is_authenticated = true) as authenticated_accounts,
                    COALESCE(SUM(s.messages_count), 0) as total_messages
                FROM accounts a
                LEFT JOIN stats s ON true
            `);
            client.release();
            return result.rows[0];
        } catch (error) {
            console.error('❌ Ошибка получения статистики:', error);
            throw error;
        }
    }

    async incrementMessages(count = 1) {
        try {
            const client = await this.pool.connect();
            await client.query(
                `INSERT INTO stats (date, messages_count) 
                 VALUES (CURRENT_DATE, $1) 
                 ON CONFLICT (date) 
                 DO UPDATE SET messages_count = stats.messages_count + $1`,
                [count]
            );
            client.release();
        } catch (error) {
            console.error('❌ Ошибка обновления статистики:', error);
            throw error;
        }
    }

    async getSetting(key) {
        try {
            const client = await this.pool.connect();
            const result = await client.query('SELECT value FROM settings WHERE key = $1', [key]);
            client.release();
            return result.rows[0]?.value || null;
        } catch (error) {
            console.error('❌ Ошибка получения настройки:', error);
            return null;
        }
    }

    async setSetting(key, value) {
        try {
            const client = await this.pool.connect();
            await client.query(
                'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
                [key, value]
            );
            client.release();
            console.log(`✅ Настройка ${key} установлена: ${value}`);
        } catch (error) {
            console.error('❌ Ошибка установки настройки:', error);
            throw error;
        }
    }

    async disconnect() {
        try {
            if (this.pool) {
                await this.pool.end();
                this.isConnected = false;
                console.log('✅ Отключено от базы данных');
            }
        } catch (error) {
            console.error('❌ Ошибка отключения:', error);
        }
    }
}

module.exports = Database;
