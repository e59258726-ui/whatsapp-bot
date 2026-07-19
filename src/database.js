const { Pool } = require('pg');
const config = require('./config');

class Database {
    constructor() {
        this.pool = null;
        this.connected = false;
    }

    async connect() {
        try {
            if (!config.DATABASE_URL) {
                console.log('⚠️ DATABASE_URL не найден, используем SQLite');
                // Здесь можно добавить SQLite
                return;
            }

            this.pool = new Pool({
                connectionString: config.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            await this.pool.connect();
            await this.createTables();
            this.connected = true;
            console.log('✅ Подключено к Neon PostgreSQL!');
        } catch (error) {
            console.error('❌ Ошибка подключения к БД:', error);
            throw error;
        }
    }

    async createTables() {
        const queries = [
            `
            CREATE TABLE IF NOT EXISTS accounts (
                id SERIAL PRIMARY KEY,
                phone VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(100),
                is_authenticated BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            `,
            `
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                phone VARCHAR(20),
                step VARCHAR(50),
                data JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            `,
            `
            CREATE TABLE IF NOT EXISTS pairs (
                id SERIAL PRIMARY KEY,
                phone1 VARCHAR(20) NOT NULL,
                phone2 VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            `
        ];

        for (const query of queries) {
            try {
                await this.pool.query(query);
            } catch (error) {
                console.error('❌ Ошибка создания таблицы:', error);
            }
        }
        console.log('✅ Все таблицы созданы/проверены');
    }

    async addAccount(phone, name = null) {
        const query = `
            INSERT INTO accounts (phone, name, is_authenticated, is_active)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (phone) 
            DO UPDATE SET 
                name = EXCLUDED.name,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;
        const result = await this.pool.query(query, [phone, name, false, true]);
        return result.rows[0];
    }

    async getAccounts() {
        const result = await this.pool.query(
            'SELECT * FROM accounts ORDER BY created_at DESC'
        );
        return result.rows;
    }

    async updateAccountStatus(phone, isAuthenticated) {
        const query = `
            UPDATE accounts 
            SET is_authenticated = $1, updated_at = CURRENT_TIMESTAMP
            WHERE phone = $2
        `;
        await this.pool.query(query, [isAuthenticated, phone]);
    }

    async deleteAccount(phone) {
        await this.pool.query('DELETE FROM accounts WHERE phone = $1', [phone]);
    }

    async getPairs() {
        const result = await this.pool.query(
            'SELECT * FROM pairs ORDER BY created_at DESC'
        );
        return result.rows;
    }

    async addPair(phone1, phone2) {
        const query = `
            INSERT INTO pairs (phone1, phone2)
            VALUES ($1, $2)
            ON CONFLICT (phone1, phone2) DO NOTHING
        `;
        await this.pool.query(query, [phone1, phone2]);
    }

    async getUserState(userId) {
        const result = await this.pool.query(
            'SELECT * FROM sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
            [userId]
        );
        return result.rows[0] || null;
    }

    async setUserState(userId, data) {
        const existing = await this.getUserState(userId);
        if (existing) {
            await this.pool.query(
                'UPDATE sessions SET data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [JSON.stringify(data), existing.id]
            );
        } else {
            await this.pool.query(
                'INSERT INTO sessions (user_id, data) VALUES ($1, $2)',
                [userId, JSON.stringify(data)]
            );
        }
    }

    async clearUserState(userId) {
        await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    }

    async disconnect() {
        if (this.pool) {
            await this.pool.end();
            this.connected = false;
            console.log('🔌 База данных отключена');
        }
    }

    isConnected() {
        return this.connected;
    }
}

module.exports = Database;
