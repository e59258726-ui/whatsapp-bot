// src/gemini.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');
const MessageLoader = require('./messages');

class GeminiAI {
    constructor() {
        this.genAI = config.GEMINI_API_KEY ? new GoogleGenerativeAI(config.GEMINI_API_KEY) : null;
        this.model = this.genAI ? this.genAI.getGenerativeModel({ 
            model: config.GEMINI_MODEL || 'gemini-1.5-flash'
        }) : null;
        
        // Загружаем сообщения из файла
        this.messageLoader = new MessageLoader();
        
        console.log(`✅ Gemini AI ${this.genAI ? 'инициализирован' : 'недоступен'}`);
        console.log(`📦 Модель: ${config.GEMINI_MODEL || 'gemini-1.5-flash'}`);
        console.log(`📝 Загружено сообщений: ${this.messageLoader.messages.length}`);
    }

    // ============================================
    // ИСПОЛЬЗУЕМ СООБЩЕНИЯ ИЗ TXT ФАЙЛА
    // ============================================
    async generateMessage(prompt, retries = 2) {
        // Сначала пробуем Gemini
        if (this.model && Math.random() < 0.3) { // 30% запросов к Gemini
            for (let i = 0; i < retries; i++) {
                try {
                    const result = await this.model.generateContent(prompt);
                    const response = await result.response;
                    return response.text();
                } catch (error) {
                    console.log(`⚠️ Gemini ошибка (${i+1}/${retries}): ${error.message}`);
                    if (i < retries - 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }
        }
        
        // Если Gemini не доступен - используем сообщения из файла
        return this.messageLoader.getRandomMessage();
    }

    // ============================================
    // ГЕНЕРАЦИЯ РАЗНЫХ ТИПОВ СООБЩЕНИЙ ИЗ ФАЙЛА
    // ============================================
    async generateTextMessage(account1, account2) {
        // Используем сообщения из файла
        const message = this.messageLoader.getRandomMessage();
        return message;
    }

    async generateSmileMessage(account1, account2) {
        const smiles = ['😊', '😂', '❤️', '✨', '🎉', '💕', '🔥', '👋', '🙌', '😍', '🥰', '💖'];
        const count = Math.floor(Math.random() * 4) + 2;
        let result = '';
        for (let i = 0; i < count; i++) {
            result += smiles[Math.floor(Math.random() * smiles.length)];
        }
        return result;
    }

    async generateVoiceMessage(account1, account2) {
        const voices = [
            '🎤 Привет! Как слышно?',
            '🎤 Ой, привет! Давно не слышались!',
            '🎤 Слушай, есть идея...',
            '🎤 Я сейчас в дороге, перезвоню позже',
            '🎤 Ого, круто! Расскажи подробнее!',
            '🎤 Я так рада тебя слышать!',
            '🎤 Кстати, у меня новость!',
            '🎤 Погода сегодня просто класс!',
            '🎤 Я скучаю! Давай созвонимся!',
            '🎤 Ой, я вспомнил! Слушай...'
        ];
        return voices[Math.floor(Math.random() * voices.length)];
    }

    async generatePhotoMessage(account1, account2) {
        const photos = [
            '📸 Смотри, какое фото!',
            '📸 Я сегодня такое видел!',
            '📸 Фото с прогулки!',
            '📸 Посмотри, что я нашел!',
            '📸 Угадай, где я?',
            '📸 Моя новая фотография!',
            '📸 Невероятный закат!',
            '📸 Тебе должно понравиться!'
        ];
        return photos[Math.floor(Math.random() * photos.length)];
    }

    async generateConversation(account1, account2) {
        const message = this.messageLoader.getRandomMessage();
        return message;
    }

    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    // ============================================
    getFallbackMessage() {
        return this.messageLoader.getRandomMessage();
    }

    // Добавить сообщение в файл
    addMessage(message) {
        this.messageLoader.addMessage(message);
    }

    // Получить статистику
    getStats() {
        return this.messageLoader.getStats();
    }
}

module.exports = GeminiAI;
