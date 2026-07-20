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

        await this.autoCreatePairs();
        await this.runProgressLoop();
    }

    async autoCreatePairs() {
        try {
            console.log('🔄 Автоматическое создание пар...');
            
            const accounts = await this.db.getAccounts();
            const authorized = accounts.filter(a => a.is_authenticated);
            
            if (authorized.length < 2) {
                console.log(`⚠️ Нужно минимум 2 аккаунта. Сейчас: ${authorized.length}`);
                return;
            }
            
            const shuffled = authorized.sort(() => Math.random() - 0.5);
            
            let pairsCreated = 0;
            for (let i = 0; i < shuffled.length - 1; i += 2) {
                const acc1 = shuffled[i];
                const acc2 = shuffled[i + 1];
                
                try {
                    const existing = await this.db.pool.query(
                        'SELECT * FROM pairs WHERE (account1_id = $1 AND account2_id = $2) OR (account1_id = $2 AND account2_id = $1)',
                        [acc1.id, acc2.id]
                    );
                    
                    if (existing.rows.length === 0) {
                        await this.db.createPair(acc1.id, acc2.id);
                        pairsCreated++;
                        console.log(`✅ Пара создана: ${acc1.phone} ↔ ${acc2.phone}`);
                    }
                } catch (error) {
                    console.error(`❌ Ошибка создания пары:`, error);
                }
            }
            
            console.log(`✅ Создано ${pairsCreated} пар`);
            
        } catch (error) {
            console.error('❌ Ошибка autoCreatePairs:', error);
        }
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
                console.log('⚠️ Нет активных пар. Создаю автоматически...');
                await this.autoCreatePairs();
                setTimeout(() => this.runProgressLoop(), 5000);
                return;
            }

            console.log(`📨 Найдено ${activePairs.length} активных пар`);

            for (const pair of activePairs) {
                if (!this.isRunning) break;

                try {
                    const messageType = this.getRandomMessageType();
                    const message = await this.generateMessage(pair, messageType);
                    
                    await this.sendMessageToPair(pair, message);
                    this.messagesSent++;
                    
                    console.log(`💬 [${messageType}] ${pair.phone1} → ${pair.phone2}: ${message.substring(0, 50)}...`);
                    
                    const delay = Math.floor(Math.random() * 30000) + 10000;
                    await this.sleep(delay);
                } catch (error) {
                    console.error(`❌ Ошибка для пары ${pair.id}:`, error);
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

    getRandomMessageType() {
        const types = ['text', 'smile', 'voice', 'photo'];
        return types[Math.floor(Math.random() * types.length)];
    }

    async generateMessage(pair, type) {
        const phone1 = pair.phone1 || pair.account1?.phone || 'Аккаунт 1';
        const phone2 = pair.phone2 || pair.account2?.phone || 'Аккаунт 2';
        
        try {
            switch (type) {
                case 'text':
                    return await this.gemini.generateTextMessage(phone1, phone2);
                case 'smile':
                    return await this.gemini.generateSmileMessage(phone1, phone2);
                case 'voice':
                    return await this.gemini.generateVoiceMessage(phone1, phone2);
                case 'photo':
                    return await this.gemini.generatePhotoMessage(phone1, phone2);
                default:
                    return await this.gemini.generateTextMessage(phone1, phone2);
            }
        } catch (error) {
            console.error('❌ Ошибка генерации сообщения:', error);
            return this.getFallbackMessage();
        }
    }

    getFallbackMessage() {
        const messages = [
            '😊 Привет! Как дела?',
            '❤️ Отличный день!',
            '🔥 Классно!',
            '✨ Невероятно!',
            '🎉 Супер!'
        ];
        return messages[Math.floor(Math.random() * messages.length)];
    }

    async sendMessageToPair(pair, message) {
        try {
            console.log(`📨 [${pair.id}] ${message}`);
            await this.db.incrementMessages(pair.id);
        } catch (error) {
            console.error(`❌ Ошибка отправки:`, error);
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
