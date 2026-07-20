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
// 2. TELEGRAM БОТ
// ============================================
const TOKEN = process.env.BOT_TOKEN;
const ADMIN = process.env.ADMIN_CHAT_ID;

// Проверка токена
if (!TOKEN) {
    console.error('❌ BOT_TOKEN не установлен!');
    process.exit(1);
}

if (!ADMIN) {
    console.error('❌ ADMIN_CHAT_ID не установлен!');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { 
    polling: true,
    parse_mode: null
});

// Логирование ошибок Telegram
bot.on('error', (error) => {
    console.error('❌ Ошибка Telegram:', error.message);
});

bot.on('polling_error', (error) => {
    console.error('❌ Ошибка polling:', error.message);
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
        
        const sock = makeWASocket({
            auth: state,
            browser: Browsers.macOS('Chrome'),
            phone: phoneNumber.replace('+', ''),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            // Включаем парный код
            getPairingCode: async (phone) => {
                console.log(`📱 Запрос парного кода для ${phone}`);
                return true;
            }
        });

        whatsapp = sock;
        whatsapp.ev.on('creds.update', saveCreds);

        // --- ОБРАБОТКА СОБЫТИЙ ---
        whatsapp.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, pairingCode } = update;

            // QR код (запасной вариант)
            if (qr) {
                console.log('📱 QR код получен');
                try {
                    const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
                    await bot.sendPhoto(ADMIN, qrImage, {
                        caption: `📱 Отсканируйте QR для ${phoneNumber}`
                    });
                    await bot.sendMessage(ADMIN, `📱 Текст QR:\n${qr}`);
                } catch (error) {
                    console.error('Ошибка отправки QR:', error);
                }
            }

            // ПАРНЫЙ КОД (ОСНОВНОЙ СПОСОБ!)
            if (pairingCode) {
                console.log(`🔑 Парный код для ${phoneNumber}: ${pairingCode}`);
                await bot.sendMessage(ADMIN, 
`🔑 ПАРНЫЙ КОД ДЛЯ ${phoneNumber}

Код: ${pairingCode}

ИНСТРУКЦИЯ:
1. Откройте WhatsApp на телефоне
2. Настройки → Связанные устройства
3. Нажмите "Связать по номеру телефона"
4. Введите номер: ${phoneNumber}
5. Введите код: ${pairingCode}

Это работает даже если QR не отображается!`
                );
            }

            // ПОДКЛЮЧЕНО
            if (connection === 'open') {
                console.log(`✅ ${phoneNumber} ПОДКЛЮЧЁН!`);
                isConnecting = false;
                await bot.sendMessage(ADMIN, `✅ ${phoneNumber} подключён к WhatsApp!`);
            }

            // ОТКЛЮЧЕНО
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

        // --- ОБРАБОТКА ВХОДЯЩИХ СООБЩЕНИЙ ---
        whatsapp.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (msg.key.fromMe) return;
                
                let text = '';
                let type = 'text';
                
                if (msg.message?.conversation) {
                    text = msg.message.conversation;
                } else if (msg.message?.extendedTextMessage?.text) {
                    text = msg.message.extendedTextMessage.text;
                } else if (msg.message?.imageMessage?.caption) {
                    text = msg.message.imageMessage.caption;
                    type = 'image';
                } else if (msg.message?.audioMessage) {
                    type = 'audio';
                    text = '[Аудио]';
                } else if (msg.message?.videoMessage) {
                    type = 'video';
                    text = '[Видео]';
                } else if (msg.message?.documentMessage) {
                    type = 'document';
                    text = '[Документ]';
                } else if (msg.message?.stickerMessage) {
                    type = 'sticker';
                    text = '[Стикер]';
                } else {
                    const msgType = Object.keys(msg.message || {})[0];
                    type = msgType;
                    text = `[${msgType}]`;
                }
                
                const from = msg.key.remoteJid;
                const isGroup = from.includes('@g.us');
                const sender = isGroup ? msg.key.participant : from;
                
                console.log(`📨 [${isGroup ? 'ГРУППА' : 'ЛИЧНОЕ'}] ${sender}: ${text}`);
                
                const prefix = isGroup ? '👥' : '💬';
                await bot.sendMessage(ADMIN, 
`${prefix} [${phoneNumber}]
От: ${sender}
Тип: ${type}

${text}`
                );
                
            } catch (error) {
                console.error('❌ Ошибка обработки сообщения:', error);
            }
        });

        // --- ОШИБКИ ---
        whatsapp.ev.on('error', (error) => {
            console.error('❌ Ошибка WhatsApp:', error.message);
            if (error.message && error.message.includes('404')) {
                bot.sendMessage(ADMIN, `⚠️ Ошибка 404 для ${phoneNumber}\nПопробуйте позже или используйте парный код.`);
            }
        });

    } catch (error) {
        console.error('❌ Ошибка запуска:', error);
        isConnecting = false;
        await bot.sendMessage(ADMIN, `❌ Ошибка: ${error.message}`);
    }
}

// ============================================
// 4. КОМАНДЫ TELEGRAM
// ============================================

// /start
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

// /add_account
bot.onText(/\/add_account/, async (msg) => {
    console.log(`📩 Команда /add_account от ${msg.from.id}`);
    await bot.sendMessage(msg.chat.id, '📱 Введите номер телефона:\nПример: +79637332642');
});

// /status
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

// /help
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

// --- ОБРАБОТКА НОМЕРА ТЕЛЕФОНА ---
bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    
    console.log(`📨 Сообщение от ${msg.from.id}: ${text}`);
    
    // Проверяем что это номер телефона (11-15 цифр, может начинаться с +)
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
    
    if (rss > 400) {
        console.warn(`⚠️ Критическая память: ${rss} MB!`);
    }
}, 60000);

// ============================================
// 6. ЗАПУСК
// ============================================
console.log('═'.repeat(50));
console.log('🚀 WhatsApp Bot (Baileys) ЗАПУЩЕН!');
console.log(`📱 BOT_TOKEN: ${TOKEN.substring(0, 15)}...`);
console.log(`👤 ADMIN_CHAT_ID: ${ADMIN}`);
console.log('📱 Отправьте /add_account в Telegram');
console.log('💡 Используйте ПАРНЫЙ КОД (8 цифр)');
console.log('═'.repeat(50));

// Отправляем приветствие админу
bot.sendMessage(ADMIN, 
`🚀 WhatsApp Bot (Baileys) ЗАПУЩЕН!

📌 /add_account - Добавить аккаунт
💡 Используйте ПАРНЫЙ КОД вместо QR!`
).catch(err => console.error('❌ Ошибка отправки приветствия:', err.message));
