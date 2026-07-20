// index.js
const TelegramBot = require('./src/bot');
const express = require('express');
require('dotenv').config();

console.log('═══════════════════════════════════════');
console.log('🚀 ЗАПУСК WHATSAPP PROGRESS BOT');
console.log('📌 РЕЖИМ: POLLING + HTTP');
console.log('📚 БИБЛИОТЕКА: whatsapp-web.js');
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

// === 1. СОЗДАЕМ БОТА И HTTP СЕРВЕР ===
const bot = new TelegramBot();
const app = express();

// === 2. НАСТРАИВАЕМ HTTP ЭНДПОИНТЫ ===
app.get('/', (req, res) => {
    res.send(`
        <h1>🤖 WhatsApp Progress Bot</h1>
        <p>Status: <strong>🟢 Running</strong></p>
        <p>Mode: <strong>Polling</strong></p>
        <p>Library: <strong>whatsapp-web.js</strong></p>
        <p>Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB</p>
        <p>Clients: ${bot.clients ? bot.clients.size : 0}</p>
        <p>Uptime: ${Math.round(process.uptime())}s</p>
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
    res.send('✅ Webhook endpoint (polling mode)');
});

// === 3. ЗАПУСКАЕМ HTTP СЕРВЕР ===
const port = process.env.PORT || 10000;
const server = app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 HTTP сервер запущен на порту ${port}`);
});

// === 4. ЗАПУСКАЕМ БОТА ===
async function startBot() {
    try {
        console.log('🔄 Удаление вебхука...');
        await bot.bot.telegram.deleteWebhook();
        console.log('✅ Вебхук удален');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('🔄 Сброс offset...');
        await bot.bot.telegram.getUpdates({ offset: -1, limit: 100 });
        console.log('✅ Offset сброшен');
        
        console.log('🔄 Подключение к базе данных...');
        await bot.db.connect();
        console.log('✅ База данных подключена');
        
        console.log('🔄 Запуск бота...');
        await bot.bot.launch();
        bot.isRunning = true;
        
        const me = await bot.bot.telegram.getMe();
        console.log('═══════════════════════════════════════');
        console.log(`✅ БОТ @${me.username} ЗАПУЩЕН!`);
        console.log(`🆔 ID: ${me.id}`);
        console.log(`🌐 HTTP сервер: порт ${port}`);
        console.log('═══════════════════════════════════════');
        console.log('💡 ОТПРАВЬТЕ /start В TELEGRAM');
        console.log('═══════════════════════════════════════');

        // Мониторинг памяти
        setInterval(() => {
            const mem = process.memoryUsage();
            console.log(`📊 Память: RSS=${Math.round(mem.rss / 1024 / 1024)}MB, Heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB`);
            console.log(`📱 Клиентов: ${bot.clients.size}`);
        }, 30000);

    } catch (error) {
        console.error('❌ Ошибка при запуске бота:', error);
        
        if (error.message && error.message.includes('409: Conflict')) {
            console.log('⚠️ Конфликт 409. Повторная попытка через 5 секунд...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            try {
                await bot.bot.telegram.deleteWebhook();
                await bot.bot.launch();
                bot.isRunning = true;
                const me = await bot.bot.telegram.getMe();
                console.log(`✅ БОТ @${me.username} ПЕРЕЗАПУЩЕН!`);
            } catch (retryError) {
                console.error('❌ Ошибка перезапуска:', retryError);
                process.exit(1);
            }
        } else {
            process.exit(1);
        }
    }
}

// === 5. ЗАПУСКАЕМ ВСЕ ===
startBot();

// === 6. ОБРАБОТКА ЗАВЕРШЕНИЯ ===
process.on('SIGINT', async () => {
    console.log('\n⏹ Получен SIGINT');
    server.close(() => {
        console.log('✅ HTTP сервер остановлен');
    });
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n⏹ Получен SIGTERM');
    server.close(() => {
        console.log('✅ HTTP сервер остановлен');
    });
    await bot.stop();
    process.exit(0);
});
