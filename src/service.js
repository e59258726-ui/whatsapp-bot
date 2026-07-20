// src/service.js
const GeminiAI = require('./gemini');

class ProgressService {
    constructor(db) {
        this.db = db;
        this.isRunning = false;
        this.gemini = new GeminiAI();
        this.messagesSent = 0;
        this.startTime = null;
        this.interval = null;
    }

    async start() {
        if (this.isRunning) {
            console.log('⚠️ Прогрев уже запущен');
            return;
        }

        console.log('🚀 Запуск сервиса прогрева');
        this.isRunning = true;
        this.startTime = new Date();
        this.messagesSent = 0;

        await this.runProgressLoop();
    }

    async stop() {
        if (!this.isRunning) {
            console.log('⚠️ Прогрев не запущен');
            return;
        }

        console.log('⏹ Остановка сервиса прогрева');
        this.isRunning = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async runProgressLoop() {
        if (!this.isRunning) return;

        try {
            const pairs = await this.db.getPairs();
            const activePairs = pairs.filter(p => p.is_active);

            if (activePairs.length === 0) {
                console.log('⚠️ Нет активных пар для прогрева');
                setTimeout(() => this.runProgressLoop(), 30000);
                return;
            }

            console.log(`📨 Найдено ${activePairs.length} активных пар`);

            for (const pair of activePairs) {
                if (!this.isRunning) break;

                try {
                    await this.sendMessageForPair(pair);
                    this.messagesSent++;
                    
                    const delay = Math.floor(Math.random() * 30000) + 10000;
                    await this.sleep(delay);
                } catch (error) {
                    console.error(`❌ Ошибка отправки для пары ${pair.id}:`, error);
                }
            }

            if (this.isRunning) {
                setTimeout(() => this.runProgressLoop(), 5000);
            }
        } catch (error) {
            console.error('❌ Ошибка в цикле прогрева:', error);
            if (this.isRunning) {
                setTimeout(() => this.runProgressLoop(), 10000);
            }
        }
    }

    async sendMessageForPair(pair) {
        try {
            const message = await this.gemini.generateConversation(
                `Аккаунт ${pair.phone1}`,
                `Аккаунт ${pair.phone2}`
            );

            console.log(`💬 Сообщение для пары ${pair.id}: ${message}`);
            await this.db.incrementMessages(pair.id);
            
        } catch (error) {
            console.error(`❌ Ошибка отправки сообщения для пары ${pair.id}:`, error);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getStats() {
        return {
            isRunning: this.isRunning,
            messagesSent: this.messagesSent,
            startTime: this.startTime,
            durationHours: this.startTime ? 
                (new Date() - this.startTime) / (1000 * 60 * 60) : 0
        };
    }
}

module.exports = ProgressService;
