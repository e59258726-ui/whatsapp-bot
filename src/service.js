// src/service.js - автоматическое создание пар
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

        // Автоматически создаем пары из всех аккаунтов
        await this.autoCreatePairs();
        
        await this.runProgressLoop();
    }

    // ============================================
    // АВТОМАТИЧЕСКОЕ СОЗДАНИЕ ПАР
    // ============================================
    async autoCreatePairs() {
        try {
            console.log('🔄 Автоматическое создание пар...');
            
            // Получаем все авторизованные аккаунты
            const accounts = await this.db.getAccounts();
            const authorized = accounts.filter(a => a.is_authenticated);
            
            if (authorized.length < 2) {
                console.log(`⚠️ Нужно минимум 2 аккаунта. Сейчас: ${authorized.length}`);
                return;
            }
            
            // Перемешиваем аккаунты для случайных пар
            const shuffled = authorized.sort(() => Math.random() - 0.5);
            
            // Создаем пары
            let pairsCreated = 0;
            for (let i = 0; i < shuffled.length - 1; i += 2) {
                const acc1 = shuffled[i];
                const acc2 = shuffled[i + 1];
                
                try {
                    // Проверяем, есть ли уже такая пара
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

            // Для каждой пары отправляем сообщение
            for (const pair of activePairs) {
                if (!this.isRunning) break;

                try {
                    // Случайный тип сообщения
                    const messageType = this.getRandomMessageType();
                    
                    // Генерируем сообщение
                    const message = await this.generateMessage(pair, messageType);
                    
                    // Отправляем от первого ко второму
                    await this.sendMessageToPair(pair, message);
                    this.messagesSent++;
                    
                    console.log(`💬 [${messageType}] ${pair.phone1} → ${pair.phone2}: ${message.substring(0, 30)}...`);
                    
                    // Задержка между сообщениями
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

    // ============================================
    // ТИПЫ СООБЩЕНИЙ
    // ============================================
    getRandomMessageType() {
        const types = ['text', 'smile', 'voice', 'photo'];
        return types[Math.floor(Math.random() * types.length)];
    }

    // ============================================
    // ГЕНЕРАЦИЯ СООБЩЕНИЙ
    // ============================================
    async generateMessage(pair, type) {
        const phone1 = pair.phone1 || pair.account1?.phone;
        const phone2 = pair.phone2 || pair.account2?.phone;
        
        switch (type) {
            case 'text':
                return await this.gemini.generateConversation(
                    `Аккаунт ${phone1}`,
                    `Аккаунт ${phone2}`
                );
            
            case 'smile':
                return this.getRandomSmile();
            
            case 'voice':
                return this.getRandomVoiceMessage();
            
            case 'photo':
                return this.getRandomPhotoMessage();
            
            default:
                return await this.gemini.generateConversation(phone1, phone2);
        }
    }

    // ============================================
    // СМАЙЛИКИ
    // ============================================
    getRandomSmile() {
        const smiles = [
            '😊', '😂', '🤣', '❤️', '💕', '✨', '🔥', '👍', '👋', '🙌',
            '🎉', '💪', '🤗', '😍', '🥰', '😘', '💋', '💖', '💗', '💝',
            '🌟', '⭐', '🌈', '☀️', '🌸', '🌺', '🌻', '🌹', '🌷', '🌼',
            '🎶', '🎵', '🎧', '🎼', '🎤', '🎸', '🎹', '🎺', '🎷', '🎻',
            '📸', '📹', '🎥', '📽️', '🎬', '🎭', '🎪', '🎨', '🎯', '🎲',
            '🚀', '🛸', '👽', '🤖', '👾', '🦄', '🐉', '🐲', '🐳', '🐬'
        ];
        return smiles[Math.floor(Math.random() * smiles.length)];
    }

    // ============================================
    // ГОЛОСОВЫЕ СООБЩЕНИЯ
    // ============================================
    getRandomVoiceMessage() {
        const voices = [
            '🎤 Привет! Как дела?',
            '🎤 Ой, привет! Давно не слышались!',
            '🎤 Слушай, есть идея...',
            '🎤 А давай встретимся?',
            '🎤 Я сейчас в дороге, перезвоню позже',
            '🎤 Ого, круто! Расскажи подробнее!',
            '🎤 Ты не поверишь, что случилось!',
            '🎤 Я так рада тебя слышать!',
            '🎤 Ну как ты вообще?',
            '🎤 А помнишь, как мы...',
            '🎤 Кстати, у меня новость!',
            '🎤 Ты уже видел это видео?',
            '🎤 Погода сегодня просто класс!',
            '🎤 Я скучаю! Давай созвонимся!'
        ];
        return voices[Math.floor(Math.random() * voices.length)];
    }

    // ============================================
    // ФОТО СООБЩЕНИЯ
    // ============================================
    getRandomPhotoMessage() {
        const photos = [
            '📸 Смотри, какое фото!',
            '📸 Я сегодня такое видел!',
            '📸 Это просто шедевр!',
            '📸 Фото с прогулки!',
            '📸 Посмотри, что я нашел!',
            '📸 Как тебе это фото?',
            '📸 Угадай, где я?',
            '📸 Это было недавно!',
            '📸 Моя новая фотография!',
            '📸 Делитесь впечатлениями!',
            '📸 Это я вчера снял!',
            '📸 Невероятный закат!',
            '📸 Просто красиво!',
            '📸 Тебе должно понравиться!'
        ];
        return photos[Math.floor(Math.random() * photos.length)];
    }

    // ============================================
    // ОТПРАВКА СООБЩЕНИЯ
    // ============================================
    async sendMessageToPair(pair, message) {
        try {
            // Здесь можно реализовать реальную отправку через WhatsApp
            console.log(`📨 [${pair.id}] ${message}`);
            
            // Обновляем статистику
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
