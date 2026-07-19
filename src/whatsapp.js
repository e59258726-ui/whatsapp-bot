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
    }

    async start() {
        console.log(`🚀 Запуск клиента для ${this.phone} (метод: ${this.method})`);

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

        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: `./sessions/${this.phone}`
            }),
            puppeteer: puppeteerConfig,
            qrMaxRetries: 3,
            takeoverOnConflict: true,
            takeoverTimeoutMs: 0
        });

        // ✅ QR-КОД
        this.client.on('qr', async (qr) => {
            console.log('📱 QR-код сгенерирован');
            this.qrCode = qr;

            if (this.telegramCtx && this.method === 'qr') {
                try {
                    const qrImage = await QRCode.toBuffer(qr);
                    await this.telegramCtx.replyWithPhoto(
                        { source: qrImage },
                        {
                            caption: `📱 <b>QR код для связывания</b>\n\nАккаунт: <b>${this.phone}</b>\n\n📲 Отсканируйте в WhatsApp Web\n⏳ Действует 2 минуты`,
                            parse_mode: 'HTML'
                        }
                    );
                    console.log(`✅ QR-код отправлен в Telegram для ${this.phone}`);
                } catch (error) {
                    console.error('❌ Ошибка отправки QR:', error);
                }
            }
        });

        // ✅ 8-ЗНАЧНЫЙ КОД
        this.client.on('pairing_code', async (code) => {
            console.log(`🔢 Парный код для ${this.phone}: ${code}`);
            this.pairingCode = code;

            if (this.telegramCtx && this.method === 'code') {
                try {
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
                }
            }
        });

        this.client.on('authenticated', () => {
            console.log(`✅ ${this.phone} авторизован!`);
            this.isAuthenticated = true;
            this.emit('authenticated');
        });

        this.client.on('ready', () => {
            console.log(`🟢 ${this.phone} готов`);
            this.isReady = true;
            this.emit('ready');
        });

        this.client.on('auth_failure', (error) => {
            console.error(`❌ Ошибка ${this.phone}:`, error);
            this.emit('auth_failure', error);
        });

        this.client.on('disconnected', (reason) => {
            console.log(`🔌 ${this.phone} отключен:`, reason);
            this.isAuthenticated = false;
            this.isReady = false;
            this.emit('disconnected', reason);
        });

        await this.client.initialize();
        console.log(`✅ Клиент ${this.phone} инициализирован`);
    }

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

    async getPairingCode() {
        return this.pairingCode;
    }

    isAuthenticated() {
        return this.isAuthenticated;
    }

    isReady() {
        return this.isReady;
    }

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
