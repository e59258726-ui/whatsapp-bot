// src/messages.js
const fs = require('fs');
const path = require('path');

class MessageLoader {
    constructor() {
        this.messages = [];
        this.loadMessages();
    }

    loadMessages() {
        try {
            const filePath = path.join(process.cwd(), 'messages.txt');
            
            if (!fs.existsSync(filePath)) {
                console.log('⚠️ Файл messages.txt не найден, создаю с стандартными сообщениями...');
                this.createDefaultMessages();
                return;
            }

            const content = fs.readFileSync(filePath, 'utf8');
            this.messages = content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            console.log(`✅ Загружено ${this.messages.length} сообщений из messages.txt`);
            
            if (this.messages.length === 0) {
                console.log('⚠️ Файл messages.txt пуст, создаю стандартные...');
                this.createDefaultMessages();
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки сообщений:', error);
            this.createDefaultMessages();
        }
    }

    createDefaultMessages() {
        this.messages = [
            'Привет! Как дела?',
            'Отличный день!',
            'Что нового?',
            'Как настроение?',
            'Чем занимаешься?',
            'Как погода?',
            'Улыбнись!',
            'Хорошего дня!',
            'Как прошёл день?',
            'Ты как?',
            'Всё хорошо?',
            'Какие новости?',
            'Приветик!',
            'Как успехи?',
            'Что слышно?'
        ];
        
        // Сохраняем в файл
        try {
            const filePath = path.join(process.cwd(), 'messages.txt');
            fs.writeFileSync(filePath, this.messages.join('\n'), 'utf8');
            console.log(`✅ Создан файл messages.txt с ${this.messages.length} сообщениями`);
        } catch (error) {
            console.error('❌ Ошибка создания messages.txt:', error);
        }
    }

    getRandomMessage() {
        if (this.messages.length === 0) {
            return 'Привет! Как дела?';
        }
        return this.messages[Math.floor(Math.random() * this.messages.length)];
    }

    getMessages(count = 1) {
        const shuffled = [...this.messages].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count);
    }

    // Добавить сообщение
    addMessage(message) {
        if (message && message.trim().length > 0) {
            this.messages.push(message.trim());
            this.saveMessages();
            console.log(`✅ Добавлено сообщение: "${message}"`);
        }
    }

    // Сохранить все сообщения
    saveMessages() {
        try {
            const filePath = path.join(process.cwd(), 'messages.txt');
            fs.writeFileSync(filePath, this.messages.join('\n'), 'utf8');
            console.log(`✅ Сохранено ${this.messages.length} сообщений`);
        } catch (error) {
            console.error('❌ Ошибка сохранения:', error);
        }
    }

    // Получить статистику
    getStats() {
        return {
            total: this.messages.length,
            lastMessage: this.messages[this.messages.length - 1] || 'Нет сообщений'
        };
    }
}

module.exports = MessageLoader;
