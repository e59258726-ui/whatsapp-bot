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
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN = process.env.ADMIN_CHAT_ID;

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

        // ============================================
        // 4. ОБРАБОТКА СОБЫТИЙ
        // ============================================

        whatsapp.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr, pairingCode } = update;

            // --- QR КОД ---
            if (qr) {
                console.log('📱 QR код получен');
                const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
                await bot.sendPhoto(ADMIN, qrImage, {
                    caption: `📱 Отсканируйте QR для ${phoneNumber}`
                });
                await bot.sendMessage(ADMIN, `📱 Текст QR:\n\`${qr}\``, { parse_mode: 'Markdown' });
            }

            // --- ПАРНЫЙ КОД (8 ЦИФР) - РАБОТАЕТ ВСЕГДА! ---
            if (pairingCode) {
                console.log(`🔑 Парный код: ${pairingCode}`);
                await bot.sendMessage(ADMIN, `
🔑 *ПАРНЫЙ КОД ДЛЯ ${phoneNumber}*

\`${pairingCode}\`

📌 *ИНСТРУКЦИЯ:*
1. Откройте WhatsApp на телефоне
2. Настройки → Связанные устройства
3. Связать по номеру телефона
4. Введите код: ${pairingCode}

⚡ Это работает ДАЖЕ если QR не отображается!
                `, { parse_mode: 'Markdown' });
            }

            // --- ПОДКЛЮЧЕНО ---
            if (connection === 'open') {
                console.log(`✅ ${phoneNumber} ПОДКЛЮЧЁН!`);
                isConnecting = false;
                await bot.sendMessage(ADMIN, `✅ *${phoneNumber} подключён к WhatsApp!*`, { parse_mode: 'Markdown' });
            }

            // --- ОТКЛЮЧЕНО ---
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
                console.error('❌ Ошибка:', error);
            }
        });

        // --- ОШИБКИ ---
        whatsapp.ev.on('error', (error) => {
            console.error('❌ Ошибка:', error.message);
            if (error.message.includes('404')) {
                bot.sendMessage(ADMIN, `⚠️ Ошибка 404 для ${phoneNumber}\nПопробуйте позже или используйте парный код.`);
            }
        });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        isConnecting = false;
        await bot.sendMessage(ADMIN, `❌ Ошибка: ${error.message}`);
    }
}

// ============================================
// 5. КОМАНДЫ TELEGRAM
// ============================================

bot.onText(/\/start/, async (msg) => {
    await bot.sendMessage(msg.chat.id, `
🤖 *WhatsApp Bot (Baileys)*

📌 Команды:
/add_account - Добавить аккаунт
/status - Статус
/help - Помощь

⚡ *БЕСПЛАТНО!*
✅ Без браузера
✅ Парный код вместо QR
✅ 50-80 MB памяти
    `, { parse_mode: 'Markdown' });
});

bot.onText(/\/add_account/, async (msg) => {
    await bot.sendMessage(msg.chat.id, '📱 *Введите номер:*\n`+79637332642`', { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
    const used = process.memoryUsage();
    const rss = Math.round(used.rss / 1024 / 1024);
    const heap = Math.round(used.heapUsed / 1024 / 1024);
    await bot.sendMessage(msg.chat.id, `
📊 *СТАТУС*
Память: ${rss} MB
Heap: ${heap} MB
WhatsApp: ${whatsapp ? '✅' : '❌'}
Номер: ${currentPhone || 'Нет'}
    `, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id, `
📚 *ПОМОЩЬ*

1. /add_account - Добавить аккаунт
2. Введите номер: +79637332642
3. Получите ПАРНЫЙ КОД (8 цифр)
4. В WhatsApp: Настройки → Связанные устройства → Связать по номеру
5. Введите код
6. Готово! ✅

💡 *Парный код работает всегда!*
    `, { parse_mode: 'Markdown' });
});

// --- ОБРАБОТКА НОМЕРА ---
bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    
    if (text.match(/^\+?\d{11,15}$/)) {
        const phone = text.startsWith('+') ? text : `+${text}`;
        await bot.sendMessage(msg.chat.id, `🔄 Подключаю ${phone}...`);
        await startWhatsApp(phone);
    }
});

// ============================================
// 6. ЗАПУСК
// ============================================
console.log('═'.repeat(50));
console.log('🚀 WhatsApp Bot (Baileys) ЗАПУЩЕН!');
console.log('📱 Отправьте /add_account в Telegram');
console.log('💡 Используйте ПАРНЫЙ КОД (8 цифр)');
console.log('═'.repeat(50));

bot.sendMessage(ADMIN, `
🚀 *WhatsApp Bot (Baileys) ЗАПУЩЕН!*

📌 /add_account - Добавить аккаунт
💡 Используйте ПАРНЫЙ КОД вместо QR!
`, { parse_mode: 'Markdown' });
