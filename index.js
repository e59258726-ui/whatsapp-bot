require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

// ============================================
// 1. HTTP СЕРВЕР ДЛЯ RENDER
// ============================================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('🤖 Bot is running'));
app.get('/health', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => console.log(`🌐 HTTP сервер на порту ${PORT}`));

// ============================================
// 2. TELEGRAM БОТ (без Markdown ошибок)
// ============================================
const TOKEN = process.env.BOT_TOKEN;
const ADMIN = process.env.ADMIN_CHAT_ID;

// Создаём бота с отключенным parse_mode по умолчанию
const bot = new TelegramBot(TOKEN, { 
    polling: true,
    parse_mode: null // ОТКЛЮЧАЕМ MARKDOWN ПО УМОЛЧАНИЮ
});

// Логирование ошибок
bot.on('error', (error) => {
    console.error('❌ Ошибка Telegram:', error.message);
});

bot.on('polling_error', (error) => {
    console.error('❌ Ошибка polling:', error.message);
    // Если 409 - перезапускаем polling
    if (error.message && error.message.includes('409')) {
        console.log('🔄 Перезапуск polling...');
        setTimeout(() => {
            bot.stopPolling();
            setTimeout(() => bot.startPolling(), 2000);
        }, 1000);
    }
});

// ============================================
// 3. WHATSAPP КЛИЕНТ (BAILEYS)
// ============================================
let whatsapp = null;
let isConnecting = false;
let currentPhone = null;

async function startWhatsApp(phoneNumber) {
    if (isConnecting) {
        await bot.sendMessage(ADMIN, '⏳ Уже подключаюсь...');
        return;
    }
    
    isConnecting = true;
    currentPhone = phoneNumber;

    try {
        console.log(`🚀 Запуск WhatsApp для ${phoneNumber}...`);
        await bot.sendMessage(ADMIN, `🔄 Подключаю ${phoneNumber}...`);

        const { state, saveCreds } = await useMultiFileAuthState('sessions');
        
        whatsapp = makeWASocket({
            auth: state,
            browser: Browsers.macOS('Chrome'),
            phone: phoneNumber.replace('+', ''),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        });

        whatsapp.ev.on('creds.update', saveCreds);

        // --- ОБРАБОТКА СОБЫТИЙ ---
        whatsapp.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, pairingCode } = update;

            if (qr) {
                console.log('📱 QR код получен');
                try {
                    const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
                    await bot.sendPhoto(ADMIN, qrImage, {
                        caption: `📱 Отсканируйте QR для ${phoneNumber}`
                    });
                } catch (error) {
                    console.error('Ошибка отправки QR:', error);
                }
            }

            if (pairingCode) {
                console.log(`🔑 Парный код: ${pairingCode}`);
                await bot.sendMessage(ADMIN, 
                    `🔑 ПАРНЫЙ КОД ДЛЯ ${phoneNumber}\n\nКод: ${pairingCode}\n\nИНСТРУКЦИЯ:\n1. Откройте WhatsApp на телефоне\n2. Настройки → Связанные устройства\n3. Связать по номеру телефона\n4. Введите код: ${pairingCode}\n\nЭто работает даже если QR не отображается!`
                );
            }

            if (connection === 'open') {
                console.log(`✅ ${phoneNumber} ПОДКЛЮЧЁН!`);
                isConnecting = false;
                await bot.sendMessage(ADMIN, `✅ ${phoneNumber} подключён к WhatsApp!`);
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
                console.log(`🔴 Отключён (код: ${statusCode})`);
                
                if (statusCode !== DisconnectReason.loggedOut) {
                    await bot.sendMessage(ADMIN, `⚠️ ${phoneNumber} отключён. Переподключение через 10 сек...`);
                    isConnecting = false;
                    setTimeout(() => startWhatsApp(phoneNumber), 10000);
                } else {
                    isConnecting = false;
                    await bot.sendMessage(ADMIN, `🚫 ${phoneNumber} вышел из системы.\nОтправьте /add_account заново`);
                }
            }
        });

        // --- ОБРАБОТКА СООБЩЕНИЙ ---
        whatsapp.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (msg.key.fromMe) return;
                
                let text = '';
                if (msg.message?.conversation) {
                    text = msg.message.conversation;
                } else if (msg.message?.extendedTextMessage?.text) {
                    text = msg.message.extendedTextMessage.text;
                } else {
                    text = `[${Object.keys(msg.message || {})[0]}]`;
                }
                
                const from = msg.key.remoteJid;
                console.log(`📨 ${from}: ${text}`);
                await bot.sendMessage(ADMIN, `📨 ${from}:\n${text}`);
            } catch (error) {
                console.error('❌ Ошибка обработки сообщения:', error);
            }
        });

        // --- ОШИБКИ ---
        whatsapp.ev.on('error', (error) => {
            console.error('❌ Ошибка WhatsApp:', error.message);
        });

    } catch (error) {
        console.error('❌ Ошибка запуска:', error);
        isConnecting = false;
        await bot.sendMessage(ADMIN, `❌ Ошибка: ${error.message}`);
    }
}

// ============================================
// 4. КОМАНДЫ TELEGRAM (БЕЗ MARKDOWN)
// ============================================

bot.onText(/\/start/, async (msg) => {
    console.log(`📩 Команда /start от ${msg.from.id}`);
    await bot.sendMessage(msg.chat.id, 
`🤖 WhatsApp Bot (Baileys)

Команды:
/add_account - Добавить аккаунт
/status - Статус
/help - Помощь

БЕСПЛАТНО!
- Без браузера
- Парный код вместо QR
- 50-80 MB памяти`
    );
});

bot.onText(/\/add_account/, async (msg) => {
    console.log(`📩 Команда /add_account от ${msg.from.id}`);
    await bot.sendMessage(msg.chat.id, '📱 Введите номер телефона:\nПример: +79637332642');
});

bot.onText(/\/status/, async (msg) => {
    console.log(`📩 Команда /status от ${msg.from.id}`);
    const used = process.memoryUsage();
    const rss = Math.round(used.rss / 1024 / 1024);
    const heap = Math.round(used.heapUsed / 1024 / 1024);
    await bot.sendMessage(msg.chat.id, 
`📊 СТАТУС

Память: ${rss} MB
Heap: ${heap} MB
WhatsApp: ${whatsapp ? '✅' : '❌'}
Номер: ${currentPhone || 'Нет'}`
    );
});

bot.onText(/\/help/, async (msg) => {
    console.log(`📩 Команда /help от ${msg.from.id}`);
    await bot.sendMessage(msg.chat.id, 
`📚 ПОМОЩЬ

1. /add_account - Добавить аккаунт
2. Введите номер: +79637332642
3. Получите ПАРНЫЙ КОД (8 цифр)
4. В WhatsApp: Настройки → Связанные устройства → Связать по номеру
5. Введите код
6. Готово!

Парный код работает всегда!`
    );
});

// --- ОБРАБОТКА НОМЕРА ---
bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    
    console.log(`📨 Сообщение от ${msg.from.id}: ${text}`);
    
    if (text.match(/^\+?\d{11,15}$/)) {
        const phone = text.startsWith('+') ? text : `+${text}`;
        await bot.sendMessage(msg.chat.id, `🔄 Подключаю ${phone}...`);
        await startWhatsApp(phone);
    }
});

// ============================================
// 5. МОНИТОРИНГ ПАМЯТИ
// ============================================
setInterval(() => {
    const used = process.memoryUsage();
    const rss = Math.round(used.rss / 1024 / 1024);
    console.log(`📊 Память: ${rss} MB`);
}, 60000);

// ============================================
// 6. ЗАПУСК
// ============================================
console.log('═'.repeat(50));
console.log('🚀 WhatsApp Bot (Baileys) ЗАПУЩЕН!');
console.log('📱 Отправьте /add_account в Telegram');
console.log('💡 Используйте ПАРНЫЙ КОД (8 цифр)');
console.log('═'.repeat(50));

// Отправляем приветствие админу (БЕЗ MARKDOWN)
bot.sendMessage(ADMIN, 
`🚀 WhatsApp Bot (Baileys) ЗАПУЩЕН!

📌 /add_account - Добавить аккаунт
💡 Используйте ПАРНЫЙ КОД вместо QR!`
);
