const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const EventEmitter = require('events');

class WhatsAppClient extends EventEmitter {
    constructor(phone, method = 'qr') {
        super();
        this.phone = phone;
        this.method = method;
        this.client = null;
        this.qrCode = null;
        this.pairingCode = null;
        this.isAuthenticated = false;
        this.isReady = false;
        this.telegramCtx = null;
        this.telegramBot = null;
    }

    async start() {
        console.log(`🚀 Запуск клиента для ${this.phone} (метод: ${this.method})`);
        
        // Настройки для Puppeteer
        const puppeteerConfig = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920x1080',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        };

        // Создаем клиент
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: `./sessions/${this.phone}`
            }),
            puppeteer: puppeteerConfig,
            // Для парного кода
            qrMaxRetries: 3,
            takeoverOnConflict: true,
            takeoverTimeoutMs: 0
        });

        // ✅ ОБРАБОТЧИК QR-КОДА
        this.client.on('qr', async (qr) => {
            console.log('📱 QR-код сгенерирован');
            this.qrCode = qr;
            
            // Отправляем QR только если выбран метод QR
            if (this.telegramCtx && this.method === 'qr') {
                try {
                    const qrImage = await QRCode.toBuffer(qr);
                    await this.telegramCtx.replyWithPhoto(
                        { source: qrImage },
                        {
                            caption: `📱 <b>QR код для связывания</b>\n\n` +
                                    `Аккаунт: <b>${this.phone}</b>\n\n` +
                                    `📲 Отсканируйте в WhatsApp Web\n` +
                                    `⏳ Код действителен 2 минуты\n\n` +
                                    `Или выберите <b>"Связать по номеру телефона"</b>`,
                            parse_mode: 'HTML',
                            ...this.getAuthKeyboard()
                        }
                    );
                    console.log(`✅ QR-код отправлен в Telegram для ${this.phone}`);
                } catch (error) {
                    console.error('❌ Ошибка отправки QR:', error);
                    await this.telegramCtx.reply('❌ Ошибка отправки QR-кода. Попробуйте метод "Код из WhatsApp"');
                }
            } else if (this.method === 'qr') {
                console.log('⚠️ telegramCtx не установлен! QR не отправлен');
            }
        });

        // ✅ ОБРАБОТЧИК ПАРНОГО КОДА (8-значный код)
        this.client.on('pairing_code', async (code) => {
            console.log(`🔢 Парный код для ${this.phone}: ${code}`);
            this.pairingCode = code;
            
            // Отправляем код только если выбран метод code
            if (this.telegramCtx && this.method === 'code') {
                try {
                    // Форматируем код: HZ5F-3VF9
                    const formattedCode = code.slice(0, 4) + '-' + code.slice(4);
                    
                    await this.telegramCtx.replyWithHTML(`
<b>🔐 Введите код на телефоне</b>

Связывание аккаунта WhatsApp <b>${this.phone}</b>

<b><code>${formattedCode}</code></b>

<b>📱 Инструкция:</b>
1️⃣ Откройте WhatsApp <b>на своем телефоне</b>
2️⃣ На Android нажмите Меню (⋮) / На iPhone нажмите Настройки
3️⃣ Нажмите <b>Связанные устройства</b>, затем <b>Связывание устройства</b>
4️⃣ Нажмите <b>"Связать по номеру телефона"</b>
5️⃣ Введите код: <b>${formattedCode}</b>

⏳ Код действителен 2 минуты
                    `);
                    console.log(`✅ Код ${formattedCode} отправлен в Telegram для ${this.phone}`);
                } catch (error) {
                    console.error('❌ Ошибка отправки кода:', error);
                    await this.telegramCtx.reply(`❌ Ошибка отправки кода: ${error.message}`);
                }
            } else if (this.method === 'code') {
                console.log('⚠️ telegramCtx не установлен! Код не отправлен');
            }
        });

        // ✅ АВТОРИЗАЦИЯ УСПЕШНА
        this.client.on('authenticated', (session) => {
            console.log(`✅ ${this.phone} авторизован!`);
            this.isAuthenticated = true;
            this.emit('authenticated', session);
        });

        // ✅ КЛИЕНТ ГОТОВ
        this.client.on('ready', () => {
            console.log(`🟢 ${this.phone} готов к работе`);
            this.isReady = true;
            this.emit('ready');
        });

        // ✅ ОШИБКА АВТОРИЗАЦИИ
        this.client.on('auth_failure', (error) => {
            console.error(`❌ Ошибка авторизации ${this.phone}:`, error);
            this.emit('auth_failure', error);
        });

        // ✅ ОТКЛЮЧЕНИЕ
        this.client.on('disconnected', (reason) => {
            console.log(`🔌 ${this.phone} отключен:`, reason);
            this.isAuthenticated = false;
            this.isReady = false;
            this.emit('disconnected', reason);
        });

        // ✅ ИЗМЕНЕНИЕ КОДА
        this.client.on('change_code', (newCode) => {
            console.log(`🔄 Код изменен для ${this.phone}: ${newCode}`);
            this.pairingCode = newCode;
        });

        // Запускаем клиент
        try {
            await this.client.initialize();
            console.log(`✅ Клиент ${this.phone} инициализирован`);
        } catch (error) {
            console.error(`❌ Ошибка инициализации ${this.phone}:`, error);
            throw error;
        }
    }

    // Получить QR-код
    async getQRCode() {
        if (this.qrCode) {
            try {
                return await QRCode.toBuffer(this.qrCode);
            } catch (error) {
                console.error('❌ Ошибка генерации QR:', error);
                return null;
            }
        }
        return null;
    }

    // Получить парный код
    async getPairingCode() {
        return this.pairingCode;
    }

    // Проверить авторизацию
    isAuthenticated() {
        return this.isAuthenticated;
    }

    // Проверить готовность
    isReady() {
        return this.isReady;
    }

    // Клавиатура для авторизации
    getAuthKeyboard() {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Всё готово', callback_data: 'auth_ready' }],
                    [{ text: '🔄 Показать QR', callback_data: 'auth_show_qr' }],
                    [{ text: '❌ Отмена', callback_data: 'auth_cancel' }]
                ]
            }
        };
    }

    // Остановка клиента
    async stop() {
        if (this.client) {
            try {
                await this.client.destroy();
                console.log(`⏹ ${this.phone} остановлен`);
            } catch (error) {
                console.error(`❌ Ошибка остановки ${this.phone}:`, error);
            }
        }
    }
}

module.exports = WhatsAppClient;
