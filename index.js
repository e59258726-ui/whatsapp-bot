// index.js - с HTTP сервером для Render
const TelegramBot = require('./src/bot');
const express = require('express');
require('dotenv').config();

console.log('═══════════════════════════════════════');
console.log('🚀 ЗАПУСК WHATSAPP PROGRESS BOT');
console.log('📌 РЕЖИМ: POLLING + HTTP');
console.log('📚 БИБЛИОТЕКА: whatsapp-web.js');
console.log('📊 ОПТИМИЗАЦИЯ: включена');
console.log('═══════════════════════════════════════');

if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден!');
    process.exit(1);
}

console.log('🔍 Проверка переменных:');
console.log(`  ✅ BOT_TOKEN: ${process.env.BOT_TOKEN.substring(0, 10)}...`);
console.log(`  ✅ DATABASE_URL: ${process.env.DATABASE_URL ? 'установлен' : 'НЕ УСТАНОВЛЕН'}`);
console.log(`  ✅ GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'установлен' : 'не установлен'}`);
console.log('═══════════════════════════════════════');

// Показываем память
const mem = process.memoryUsage();
console.log('📊 Начальная память:');
console.log(`  RSS: ${Math.round(mem.rss / 1024 / 1024)} MB`);
console.log(`  Heap: ${Math.round(mem.heapUsed / 1024 / 1024)} MB`);
console.log('═══════════════════════════════════════');

const bot = new TelegramBot();
const app = express();

// === HTTP СЕРВЕР ДЛЯ RENDER ===
app.get('/', (req, res) => {
    res.send(`
        <h1>🤖 WhatsApp Progress Bot</h1>
        <p>Status: <strong>🟢 Running</strong></p>
        <p>Mode: <strong>Polling</strong></p>
        <p>Library: <strong>whatsapp-web.js</strong></p>
        <p>Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB</p>
        <p>Accounts: ${bot.clients ? bot.clients.size : 0}</p>
        <p>Uptime: ${Math.round(process.uptime())} seconds</p>
        <p><a href="https://t.me/${process.env.BOT_USERNAME || 'kfjfefj_bot'}">Open Telegram Bot</a></p>
    `);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        mode: 'polling',
        library: 'whatsapp-web.js',
        timestamp: new Date().toISOString(),
        memory: {
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
            heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        },
        clients: bot.clients ? bot.clients.size : 0,
        uptime: Math.round(process.uptime())
    });
});

app.get('/webhook', (req, res) => {
    res.send('✅ Webhook endpoint is working! (Polling mode)');
});

async function startBot() {
    try {
        console.log('🔄 Удаление вебхука...');
        await bot.bot.telegram.deleteWebhook();
        console.log('✅ Вебхук удален');
        
        console.log('🔄 Сброс offset...');
        await bot.bot.telegram.getUpdates({ offset: -1, limit: 100 });
        console.log('✅ Offset сброшен');
        
        console.log('🔄 Подключение к базе данных...');
        await bot.db.connect();
        console.log('✅ База данных подключена');
        
        console.log('🔄 Запуск бота...');
        await bot.bot.launch();
        bot.isRunning = true;
        
        // Запускаем HTTP сервер
        const port = process.env.PORT || 10000;
        app.listen(port, '0.0.0.0', () => {
            console.log(`🌐 HTTP сервер запущен на порту ${port}`);
        });
        
        const me = await bot.bot.telegram.getMe();
        console.log('═══════════════════════════════════════');
        console.log(`✅ БОТ @${me.username} ЗАПУЩЕН!`);
        console.log(`🆔 ID: ${me.id}`);
        console.log(`📚 Библиотека: whatsapp-web.js`);
        console.log(`📊 Оптимизация: включена`);
        console.log(`🌐 HTTP сервер: порт ${port}`);
        console.log('═══════════════════════════════════════');
        console.log('💡 ОТПРАВЬТЕ /start В TELEGRAM');
        console.log('📨 Бот ожидает команды...');
        console.log('═══════════════════════════════════════');

        // Мониторинг памяти каждые 30 секунд
        setInterval(() => {
            const mem = process.memoryUsage();
            console.log(`📊 Память: RSS=${Math.round(mem.rss / 1024 / 1024)}MB, Heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB`);
        }, 30000);

    } catch (error) {
        console.error('❌ Ошибка при запуске:', error);
        process.exit(1);
    }
}

startBot();

process.on('SIGINT', async () => {
    console.log('\n⏹ Остановка...');
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n⏹ Остановка...');
    await bot.stop();
    process.exit(0);
});
