// index.js - POLLING РЕЖИМ
const TelegramBot = require('./src/bot');
require('dotenv').config();

console.log('═══════════════════════════════════════');
console.log('🚀 ЗАПУСК WHATSAPP PROGRESS BOT');
console.log('📌 РЕЖИМ: POLLING');
console.log('📦 БИБЛИОТЕКА: BAILEYS');
console.log('═══════════════════════════════════════');

if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден!');
    process.exit(1);
}

console.log('🔍 Проверка переменных:');
console.log(`  ✅ BOT_TOKEN: ${process.env.BOT_TOKEN.substring(0, 10)}...`);
console.log(`  ✅ DATABASE_URL: ${process.env.DATABASE_URL ? 'установлен' : 'НЕ УСТАНОВЛЕН'}`);
console.log('═══════════════════════════════════════');

const bot = new TelegramBot();

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
        
        console.log('🔄 Запуск бота в POLLING режиме...');
        await bot.bot.launch();
        bot.isRunning = true;
        
        const me = await bot.bot.telegram.getMe();
        console.log('═══════════════════════════════════════');
        console.log(`✅ БОТ @${me.username} ЗАПУЩЕН В POLLING РЕЖИМЕ!`);
        console.log(`🆔 ID: ${me.id}`);
        console.log(`📦 Библиотека: Baileys`);
        console.log('═══════════════════════════════════════');
        console.log('💡 ОТПРАВЬТЕ /start В TELEGRAM');
        console.log('📨 Бот ожидает команды...');
        console.log('═══════════════════════════════════════');
        
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
