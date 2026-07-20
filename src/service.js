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
        this.totalAccounts = 0;
        this.processedAccounts = 0;
        this.isComplete = false;
        this.bot = null;
        this.clientsMap = null;
    }

    setBot(bot) {
        this.bot = bot;
    }

    setClients(clients) {
        this.clientsMap = clients;
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
        this.isComplete = false;
        this.processedAccounts = 0;

        await this.runProgressLoop();
    }

    async runProgressLoop() {
        if (!this.isRunning) return;

        try {
            const accounts = await this.db.getAccounts();
            const authorized = accounts.filter(a => a.is_authenticated);

            if (authorized.length < 2) {
                console.log(`⚠️ Нужно минимум 2 аккаунта. Сейчас: ${authorized.length}`);
                if (this.bot) {
                    await this.sendNotification(
                        `⚠️ *Недостаточно аккаунтов для прогрева!*\n\n` +
                        `📱 Нужно минимум 2 аккаунта.\n` +
                        `📱 Сейчас: ${authorized.length}\n\n` +
                        `➕ Добавьте аккаунты через "➕ Добавить аккаунт"`
                    );
                }
                this.isRunning = false;
                return;
            }

            this.totalAccounts = authorized.length;
            console.log(`📨 Найдено ${authorized.length} аккаунтов`);

            const shuffled = authorized.sort(() => Math.random() - 0.5);
            let processed = 0;
            
            for (let i = 0; i < shuffled.length; i++) {
                if (!this.isRunning) break;

                const fromAccount = shuffled[i];
                const toAccount = shuffled[(i + 1) % shuffled.length];

                try {
                    const messageType = this.getRandomMessageType();
                    const message = await this.generateMessage(fromAccount, toAccount, messageType);
                    
                    await this.sendMessage(fromAccount, toAccount, message, messageType);
                    this.messagesSent++;
                    processed++;
                    this.processedAccounts = processed;
                    
                    console.log(`💬 [${messageType}] ${fromAccount.phone} → ${toAccount.phone}: ${message.substring(0, 50)}...`);
                    
                    const delay = Math.floor(Math.random() * 30000) + 10000;
                    await this.sleep(delay);
                    
                } catch (error) {
                    console.error(`❌ Ошибка при отправке от ${fromAccount.phone}:`, error);
                }
            }

            if (processed >= shuffled.length && this.isRunning) {
                console.log('✅ Все аккаунты обработаны!');
                await this.completeProgress();
                return;
            }

            if (processed < shuffled.length && this.isRunning) {
                console.log(`⏳ Осталось ${shuffled.length - processed} аккаунтов`);
                setTimeout(() => this.runProgressLoop(), 5000);
            }

        } catch (error) {
            console.error('❌ Ошибка в цикле прогрева:', error);
            if (this.isRunning) {
                setTimeout(() => this.runProgressLoop(), 10000);
            }
        }
    }

    async completeProgress() {
        this.isRunning = false;
        this.isComplete = true;
        
        const duration = Math.round((new Date() - this.startTime) / 1000 / 60);
        
        console.log(`✅ Прогрев завершен! Отправлено ${this.messagesSent} сообщений за ${duration} минут`);
        await this.sendCompleteNotification(duration);
    }

    async sendCompleteNotification(duration) {
        try {
            if (!this.bot) return;
            
            const accounts = await this.db.getAccounts();
            const authorized = accounts.filter(a => a.is_authenticated);
            
            let accountsList = '';
            for (const acc of authorized) {
                accountsList += `  🟢 ${acc.phone}\n`;
            }
            
            const message = 
                `✅ *ПРОГРЕВ ЗАВЕРШЕН!*\n\n` +
                `📊 *Статистика:*\n` +
                `  📱 Аккаунтов: ${authorized.length}\n` +
                `  💬 Отправлено: ${this.messagesSent} сообщений\n` +
                `  ⏱️ Время: ${duration} минут\n\n` +
                `📋 *Аккаунты:*\n${accountsList}\n\n` +
                `😴 *Аккаунтам нужно отдохнуть!*\n` +
                `⏳ Рекомендуется подождать 1-2 часа перед следующим прогревом.\n\n` +
                `🔄 Чтобы запустить снова: /start_progress`;
            
            await this.sendNotification(message);
            
        } catch (error) {
            console.error('❌ Ошибка отправки уведомления:', error);
        }
    }

    async sendNotification(message) {
        try {
            if (!this.bot) return;
            const adminChatId = process.env.ADMIN_CHAT_ID || 8946090726;
            await this.bot.bot.telegram.sendMessage(adminChatId, message, {
                parse_mode: 'Markdown'
            });
        } catch (error) {
            console.error('❌ Ошибка отправки уведомления:', error);
        }
    }

    async stop() {
        if (!this.isRunning && !this.isComplete) {
            console.log('⚠️ Прогрев не запущен');
            return;
        }

        console.log('⏹ Остановка сервиса прогрева');
        this.isRunning = false;
        
        if (!this.isComplete) {
            await this.sendStopNotification();
        }
        
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async sendStopNotification() {
        try {
            if (!this.bot) return;
            
            const message = 
                `⏹ *ПРОГРЕВ ОСТАНОВЛЕН ВРУЧНУЮ!*\n\n` +
                `📊 *Статистика:*\n` +
                `  💬 Отправлено: ${this.messagesSent} сообщений\n` +
                `  ⏱️ Время: ${Math.round((new Date() - this.startTime) / 1000 / 60)} минут\n\n` +
                `🔄 Запустить снова: /start_progress`;
            
            await this.sendNotification(message);
        } catch (error) {
            console.error('❌ Ошибка отправки уведомления:', error);
        }
    }

    getRandomMessageType() {
        const types = ['text', 'smile', 'voice', 'photo'];
        return types[Math.floor(Math.random() * types.length)];
    }

    async generateMessage(fromAccount, toAccount, type) {
        const fromPhone = fromAccount.phone;
        const toPhone = toAccount.phone;
        
        try {
            switch (type) {
                case 'text':
                    return await this.gemini.generateTextMessage(fromPhone, toPhone);
                case 'smile':
                    return await this.gemini.generateSmileMessage(fromPhone, toPhone);
                case 'voice':
                    return await this.gemini.generateVoiceMessage(fromPhone, toPhone);
                case 'photo':
                    return await this.gemini.generatePhotoMessage(fromPhone, toPhone);
                default:
                    return await this.gemini.generateConversation(fromPhone, toPhone);
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

    async sendMessage(fromAccount, toAccount, message, type) {
        try {
            console.log(`📨 [${type}] ${fromAccount.phone} → ${toAccount.phone}: ${message}`);
            
            if (!this.clientsMap) {
                console.log('❌ Клиенты не доступны');
                return;
            }
            
            const fromClient = this.clientsMap.get(fromAccount.phone);
            
            if (!fromClient) {
                console.log(`❌ Клиент не найден для ${fromAccount.phone}`);
                await this.db.updateAccountStatus(fromAccount.phone, false);
                return;
            }
            
            if (!fromClient.isAuthenticated) {
                console.log(`❌ Клиент ${fromAccount.phone} не авторизован`);
                await this.db.updateAccountStatus(fromAccount.phone, false);
                return;
            }
            
            try {
                await fromClient.sendMessage(toAccount.phone, message);
                console.log(`✅ Сообщение отправлено: ${fromAccount.phone} → ${toAccount.phone}`);
                await this.db.saveMessage(fromAccount.id, toAccount.id, message, type);
                await this.db.incrementMessages();
            } catch (sendError) {
                console.error(`❌ Ошибка отправки:`, sendError);
                if (sendError.message.includes('Не авторизован')) {
                    await this.db.updateAccountStatus(fromAccount.phone, false);
                    if (this.bot) {
                        await this.bot.sendNotification(
                            `⚠️ Аккаунт ${fromAccount.phone} потерял авторизацию!`
                        );
                    }
                }
            }
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
            isComplete: this.isComplete,
            messagesSent: this.messagesSent,
            startTime: this.startTime,
            durationHours: this.startTime ? 
                (new Date() - this.startTime) / (1000 * 60 * 60) : 0,
            totalAccounts: this.totalAccounts,
            processedAccounts: this.processedAccounts
        };
    }
}

module.exports = ProgressService;
