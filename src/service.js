// src/service.js
const GeminiAI = require('./gemini');
const config = require('./config');

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
        this.isActive = false;
        this.isResting = false;
        this.cycleActiveTime = config.CYCLE_ACTIVE_TIME || 10 * 60 * 1000;
        this.cycleRestTime = config.CYCLE_REST_TIME || 10 * 60 * 1000;
        this.cycleTimer = null;
        this.maxMessagesPerCycle = 30;
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
        console.log(`⏱️ Активен: ${this.cycleActiveTime / 60000} минут`);
        console.log(`⏱️ Отдых: ${this.cycleRestTime / 60000} минут`);
        
        this.isRunning = true;
        this.startTime = new Date();
        this.messagesSent = 0;
        this.isComplete = false;
        this.processedAccounts = 0;
        this.isResting = false;
        
        await this.runCycle();
    }

    async runCycle() {
        if (!this.isRunning) return;

        try {
            const elapsedHours = (Date.now() - this.startTime) / (1000 * 60 * 60);
            if (elapsedHours >= config.PROGRESS_DURATION_HOURS) {
                console.log(`✅ Время прогрева (${config.PROGRESS_DURATION_HOURS} часов) истекло`);
                this.isComplete = true;
                this.isRunning = false;
                await this.sendCompleteNotification(Math.round(elapsedHours * 60));
                return;
            }

            // ===== ВСЕ АККАУНТЫ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ =====
            const allAccounts = await this.db.getAccounts(); // БЕЗ user_id - все аккаунты
            const authorized = allAccounts.filter(a => a.is_authenticated);

            console.log(`📱 Всего аккаунтов в БД: ${allAccounts.length}`);
            console.log(`📱 Авторизованных: ${authorized.length}`);

            if (authorized.length < 2) {
                console.log(`⚠️ Нужно минимум 2 аккаунта. Сейчас: ${authorized.length}`);
                
                let accountsList = '';
                for (const acc of allAccounts) {
                    const status = acc.is_authenticated ? '🟢' : '🔴';
                    accountsList += `  ${status} ${acc.phone} (пользователь ${acc.user_id})\n`;
                }
                
                await this.sendNotification(
                    `⚠️ *Недостаточно аккаунтов для прогрева!*\n\n` +
                    `📱 Нужно минимум 2 аккаунта.\n` +
                    `📱 Сейчас: ${authorized.length}\n\n` +
                    `📋 *Все аккаунты в системе:*\n${accountsList || '  Нет аккаунтов'}\n\n` +
                    `➕ Добавьте аккаунты через "➕ Добавить аккаунт"\n` +
                    `🔐 Авторизуйте их через QR или код`
                );
                this.isRunning = false;
                return;
            }

            this.totalAccounts = authorized.length;
            console.log(`📨 Найдено ${authorized.length} аккаунтов`);

            console.log(`🟢 АКТИВНАЯ ФАЗА: отправка сообщений...`);
            this.isActive = true;
            this.isResting = false;
            
            let accountsList = '';
            for (const acc of authorized) {
                accountsList += `  🟢 ${acc.phone}\n`;
            }
            
            await this.sendNotification(
                `🟢 *АККАУНТЫ АКТИВНЫ!*\n\n` +
                `📱 Начинается общение между ${authorized.length} аккаунтами.\n\n` +
                `📋 *Аккаунты:*\n${accountsList}\n\n` +
                `⏱️ Активная фаза: ${this.cycleActiveTime / 60000} минут.\n` +
                `⏰ Осталось: ${Math.round(config.PROGRESS_DURATION_HOURS - elapsedHours)} часов\n\n` +
                `💬 Аккаунты начали переписываться!`
            );

            await this.runActivePhase(authorized);

            console.log(`🔴 ФАЗА ОТДЫХА: ${this.cycleRestTime / 60000} минут...`);
            this.isActive = false;
            this.isResting = true;
            
            await this.closeAllBrowsers();
            
            await this.sendNotification(
                `😴 *АККАУНТЫ ОТДЫХАЮТ!*\n\n` +
                `⏱️ Фаза отдыха: ${this.cycleRestTime / 60000} минут.\n` +
                `🔄 Браузеры закрыты для экономии памяти.\n` +
                `⏰ Осталось: ${Math.round(config.PROGRESS_DURATION_HOURS - elapsedHours)} часов\n\n` +
                `⏳ Продолжим через ${this.cycleRestTime / 60000} минут...`
            );

            await this.sleep(this.cycleRestTime);

            if (this.isRunning) {
                console.log(`🔄 НОВЫЙ ЦИКЛ...`);
                await this.runCycle();
            }

        } catch (error) {
            console.error('❌ Ошибка в цикле:', error);
            if (this.isRunning) {
                setTimeout(() => this.runCycle(), 10000);
            }
        }
    }

    async runActivePhase(authorized) {
        const startTime = Date.now();
        const activeDuration = this.cycleActiveTime;
        let messageCount = 0;

        console.log(`📨 Найдено ${authorized.length} аккаунтов`);

        const shuffled = authorized.sort(() => Math.random() - 0.5);
        let index = 0;

        while (this.isRunning && this.isActive) {
            const elapsed = Date.now() - startTime;
            if (elapsed >= activeDuration) {
                console.log(`⏰ Время активной фазы истекло`);
                break;
            }

            if (messageCount >= this.maxMessagesPerCycle) {
                console.log(`📨 Достигнут лимит сообщений за фазу (${this.maxMessagesPerCycle})`);
                break;
            }

            const fromAccount = shuffled[index % shuffled.length];
            const toAccount = shuffled[(index + 1) % shuffled.length];

            try {
                const messageType = this.getRandomMessageType();
                const message = await this.generateMessage(fromAccount, toAccount, messageType);
                
                await this.sendMessage(fromAccount, toAccount, message, messageType);
                this.messagesSent++;
                messageCount++;
                
                console.log(`💬 [${messageType}] ${fromAccount.phone} → ${toAccount.phone}: ${message.substring(0, 50)}...`);
                
                const delay = Math.floor(Math.random() * 10000) + 5000;
                await this.sleep(delay);
                
                index++;

            } catch (error) {
                console.error(`❌ Ошибка отправки:`, error);
                await this.sleep(5000);
            }
        }

        console.log(`✅ Активная фаза завершена. Отправлено ${messageCount} сообщений`);
    }

    async closeAllBrowsers() {
        console.log(`🔄 Закрытие всех браузеров...`);
        for (const [phone, client] of this.clientsMap) {
            try {
                await client.closeBrowser();
                console.log(`✅ Браузер закрыт для ${phone}`);
            } catch (error) {
                console.error(`❌ Ошибка закрытия ${phone}:`, error);
            }
        }
    }

    async stop() {
        if (!this.isRunning && !this.isComplete) {
            console.log('⚠️ Прогрев не запущен');
            return;
        }

        console.log('⏹ Остановка сервиса прогрева');
        this.isRunning = false;
        this.isActive = false;
        this.isResting = false;
        
        await this.closeAllBrowsers();
        
        if (!this.isComplete) {
            await this.sendStopNotification();
        }
        
        if (this.cycleTimer) {
            clearTimeout(this.cycleTimer);
            this.cycleTimer = null;
        }
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
                `📋 *Аккаунты:*\n${accountsList || '  Нет активных аккаунтов'}\n\n` +
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

    // ============================================
    // ОТПРАВКА СООБЩЕНИЯ
    // ============================================
    async sendMessage(fromAccount, toAccount, message, type) {
        if (!this.isActive) {
            console.log(`⏸️ Пропускаем сообщение (режим отдыха)`);
            return;
        }

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
                console.log(`❌ Клиент ${fromAccount.phone} НЕ АВТОРИЗОВАН`);
                await this.db.updateAccountStatus(fromAccount.phone, false);
                return;
            }
            
            try {
                const isAuth = await fromClient.getAuthStatus();
                if (!isAuth) {
                    console.log(`❌ Аккаунт ${fromAccount.phone} не активен в WhatsApp`);
                    await this.db.updateAccountStatus(fromAccount.phone, false);
                    return;
                }
            } catch (error) {
                console.log(`⚠️ Не удалось проверить статус ${fromAccount.phone}`);
            }
            
            try {
                await fromClient.sendMessage(toAccount.phone, message);
                console.log(`✅ Сообщение отправлено: ${fromAccount.phone} → ${toAccount.phone}`);
                await this.db.saveMessage(fromAccount.id, toAccount.id, message, type);
                await this.db.incrementMessages();
            } catch (sendError) {
                console.error(`❌ Ошибка отправки:`, sendError);
                if (sendError.message.includes('Не авторизован') || sendError.message.includes('closed')) {
                    await this.db.updateAccountStatus(fromAccount.phone, false);
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
