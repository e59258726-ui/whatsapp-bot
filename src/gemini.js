// src/gemini.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');

class GeminiAI {
    constructor() {
        this.genAI = config.GEMINI_API_KEY ? new GoogleGenerativeAI(config.GEMINI_API_KEY) : null;
        this.model = this.genAI ? this.genAI.getGenerativeModel({ 
            model: config.GEMINI_MODEL || 'gemini-1.5-pro'
        }) : null;
        console.log(`✅ Gemini AI ${this.genAI ? 'инициализирован' : 'недоступен'}`);
        console.log(`📦 Модель: ${config.GEMINI_MODEL || 'gemini-1.5-pro'}`);
    }

    async generateMessage(prompt) {
        if (!this.model) {
            console.log('⚠️ Gemini не доступен, использую fallback');
            return this.getFallbackMessage();
        }

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('❌ Ошибка генерации:', error);
            return this.getFallbackMessage();
        }
    }

    getFallbackMessage() {
        const messages = [
            'Привет! Как дела?',
            'Что нового?',
            'Как прошел день?',
            'Есть планы на вечер?',
            'Как настроение?',
            'Чем занимаешься?',
            'Как погода?',
            'Что делаешь?'
        ];
        return messages[Math.floor(Math.random() * messages.length)];
    }

    async generateConversation(account1, account2) {
        const prompt = `Сгенерируй естественный диалог между двумя людьми. 
        Первый человек: ${account1}
        Второй человек: ${account2}
        Диалог должен быть дружеским, неформальным, на русском языке.
        Ответ должен быть в формате: "Имя: сообщение"
        Напиши только ответ второго человека.`;

        return await this.generateMessage(prompt);
    }

    async generateTextMessage(account1, account2) {
        const prompt = `Напиши дружеское сообщение от ${account1} к ${account2}. 
        Сообщение должно быть естественным и неформальным на русском языке.
        Длина: 1-2 предложения. Напиши только текст сообщения.`;

        return await this.generateMessage(prompt);
    }

    async generateSmileMessage(account1, account2) {
        const prompt = `Напиши сообщение от ${account1} к ${account2} используя только смайлики. 
        Используй 3-5 смайликов для выражения эмоций.`;

        const result = await this.generateMessage(prompt);
        return result || '😊😍❤️✨🎉';
    }

    async generateVoiceMessage(account1, account2) {
        const prompt = `Напиши голосовое сообщение от ${account1} к ${account2}.
        Сообщение должно быть разговорным, как в голосовом чате.
        Длина: 1-2 предложения. Напиши только текст.`;

        return await this.generateMessage(prompt);
    }

    async generatePhotoMessage(account1, account2) {
        const prompt = `Напиши сообщение от ${account1} к ${account2} с описанием фото.
        Длина: 1-2 предложения. Напиши только текст сообщения.`;

        return await this.generateMessage(prompt);
    }
}

module.exports = GeminiAI;
