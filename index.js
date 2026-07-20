// index.js
const TelegramBot = require('./src/bot');
const express = require('express');
require('dotenv').config();

console.log('═══════════════════════════════════════');
console.log('🚀 ЗАПУСК WHATSAPP PROGRESS BOT');
console.log('📌 РЕЖИМ: WEBHOOK');
console.log('📦 БИБЛИОТЕКА: BAILEYS');
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

const bot = new TelegramBot();
const app = express();
app.use(express.json());

app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path}`);
    next();
});

async function startBot() {
    try {
        console.log('🔄 Подключение к базе данных...');
        await bot.db.connect();
        console.log('✅ База данных подключена');

        const webhookUrl = `https://whatsapp-bot-f96e.onrender.com/webhook`;
        console.log(`🔗 Установка вебхука: ${webhookUrl}`);

        await bot.bot.telegram.deleteWebhook();
        console.log('✅ Старый вебхук удален');

        await bot.bot.telegram.setWebhook(webhookUrl);
        console.log('✅ Новый вебхук установлен');

        const webhookInfo = await bot.bot.telegram.getWebhookInfo();
        console.log('📊 Информация о вебхуке:', JSON.stringify(webhookInfo, null, 2));

        app.post('/webhook', async (req, res) => {
            try {
                console.log('📨 Получено обновление');
                await bot.bot.handleUpdate(req.body);
                res.sendStatus(200);
            } catch (error) {
                console.error('❌ Ошибка вебхука:', error);
                res.sendStatus(500);
            }
        });

        app.get('/webhook', (req, res) => res.send('✅ Webhook работает!'));
        app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
        app.get('/', (req, res) => res.send('<h1>🤖 WhatsApp Progress Bot</h1><p>🟢 Running</p>'));

        const port = process.env.PORT || 10000;
        app.listen(port, '0.0.0.0', () => {
            console.log(`🌐 Сервер на порту ${port}`);
            console.log(`🔗 Webhook: ${webhookUrl}`);
        });

        const me = await bot.bot.telegram.getMe();
        console.log('═══════════════════════════════════════');
        console.log(`✅ БОТ @${me.username} ЗАПУЩЕН!`);
        console.log(`🆔 ID: ${me.id}`);
        console.log(`📦 Библиотека: Baileys`);
        console.log('═══════════════════════════════════════');
        console.log('💡 ОТПРАВЬТЕ /start В TELEGRAM');
        console.log('═══════════════════════════════════════');

    } catch (error) {
        console.error('❌ Ошибка:', error);
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
