// src/gemini.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');

class GeminiAI {
    constructor() {
        this.genAI = config.GEMINI_API_KEY ? new GoogleGenerativeAI(config.GEMINI_API_KEY) : null;
        this.model = this.genAI ? this.genAI.getGenerativeModel({ model: 'gemini-pro' }) : null;
        console.log(`✅ Gemini AI ${this.genAI ? 'инициализирован' : 'недоступен'}`);
    }

    async generateMessage(prompt) {
        if (!this.model) {
            return this.getFallbackMessage();
        }

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('❌ Ошибка генерации сообщения:', error);
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
}

module.exports = GeminiAI;
