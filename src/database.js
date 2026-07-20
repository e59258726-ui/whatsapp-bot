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
                CREATE TABLE IF NOT EXISTS pairs (
                    id SERIAL PRIMARY KEY,
                    account1_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                    account2_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(account1_id, account2_id)
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    pair_id INTEGER REFERENCES pairs(id) ON DELETE CASCADE,
                    from_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                    to_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                    content TEXT NOT NULL,
                    sent_at TIMESTAMP DEFAULT NOW(),
                    is_delivered BOOLEAN DEFAULT FALSE,
                    is_read BOOLEAN DEFAULT FALSE
                )
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS stats (
                    id SERIAL PRIMARY KEY,
                    pair_id INTEGER REFERENCES pairs(id) ON DELETE CASCADE,
                    date DATE DEFAULT CURRENT_DATE,
                    messages_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(pair_id, date)
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

    async getPairs() {
        try {
            const client = await this.pool.connect();
            const result = await client.query(`
                SELECT 
                    p.*,
                    a1.phone as phone1,
                    a2.phone as phone2
                FROM pairs p
                JOIN accounts a1 ON p.account1_id = a1.id
                JOIN accounts a2 ON p.account2_id = a2.id
                ORDER BY p.created_at DESC
            `);
            client.release();
            return result.rows;
        } catch (error) {
            console.error('❌ Ошибка получения пар:', error);
            throw error;
        }
    }

    async createPair(account1Id, account2Id) {
        try {
            const client = await this.pool.connect();
            const result = await client.query(
                'INSERT INTO pairs (account1_id, account2_id) VALUES ($1, $2) ON CONFLICT (account1_id, account2_id) DO NOTHING RETURNING *',
                [account1Id, account2Id]
            );
            client.release();
            console.log(`✅ Пара создана: ${account1Id} ↔ ${account2Id}`);
            return result.rows[0];
        } catch (error) {
            console.error('❌ Ошибка создания пары:', error);
            throw error;
        }
    }

    async getStats(pairId) {
        try {
            const client = await this.pool.connect();
            let query = 'SELECT * FROM stats ORDER BY date DESC LIMIT 30';
            let params = [];
            if (pairId) {
                query = 'SELECT * FROM stats WHERE pair_id = $1 ORDER BY date DESC LIMIT 30';
                params = [pairId];
            }
            const result = await client.query(query, params);
            client.release();
            return result.rows;
        } catch (error) {
            console.error('❌ Ошибка получения статистики:', error);
            throw error;
        }
    }

    async incrementMessages(pairId, count = 1) {
        try {
            const client = await this.pool.connect();
            await client.query(
                'INSERT INTO stats (pair_id, date, messages_count) VALUES ($1, CURRENT_DATE, $2) ON CONFLICT (pair_id, date) DO UPDATE SET messages_count = stats.messages_count + $2',
                [pairId, count]
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
