// src/whatsapp.js - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

class WhatsAppClient {
    constructor(phone, method = 'qr') {
        this.phone = phone;
        this.method = method;
        this.clientId = phone.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!this.clientId) this.clientId = `client_${Date.now()}`;

        console.log(`📱 Создание клиента для ${phone} (ID: ${this.clientId})`);

        const sessionsDir = path.join(process.cwd(), 'sessions');
        if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

        const sessionPath = path.join(sessionsDir, `session-${this.clientId}`);
        if (fs.existsSync(sessionPath)) {
            console.log(`🔄 Удаляем старую сессию для ${this.phone}`);
            try {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            } catch (error) {
                console.log(`⚠️ Не удалось удалить сессию: ${error.message}`);
            }
        }

        const executablePath = this.findBrowser();

        // === ОПТИМИЗИРОВАННЫЕ НАСТРОЙКИ PUPPETEER ===
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: this.clientId,
                dataPath: sessionsDir
            }),
            puppeteer: {
                executablePath: executablePath || undefined,
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-extensions',
                    '--disable-plugins',
                    '--disable-images',
                    '--disable-sync',
                    '--disable-translate',
                    '--disable-default-apps',
                    '--disable-component-extensions-with-background-pages',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-back-forward-cache',
                    '--disable-client-side-phishing-detection',
                    '--disable-crash-reporter',
                    '--disable-domain-reliability',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-features=BlockInsecurePrivateNetworkRequests',
                    '--disable-features=OutOfBlinkCors',
                    '--disable-features=TranslateUI',
                    '--max_old_space_size=128',
                    '--js-flags="--max-old-space-size=128"',
                    '--memory-pressure-off',
                    '--max-web-workers=1',
                    '--renderer-process-limit=1',
                    '--no-first-run',
                    '--safebrowsing-disable-auto-update',
                    '--metrics-recording-only',
                    '--hide-scrollbars',
                    '--mute-audio'
                ],
                defaultViewport: null,
                ignoreHTTPSErrors: true,
                timeout: 30000,
                dumpio: false,
                handleSIGINT: false,
                handleSIGTERM: false,
                handleSIGHUP: false,
                pipe: true
            }
        });

        this.isAuthenticated = false;
        this.qrCode = null;
        this.browser = null;
        this.messageCount = 0;
        this.MAX_MESSAGES = 100;
        this.eventHandlers = {
            qr: [],
            code: [],
            authenticated: [],
            ready: [],
            auth_failure: [],
            message: [],
            disconnected: []
        };

        this.memoryMonitor = setInterval(() => {
            const used = process.memoryUsage();
            console.log(`📊 Память ${this.phone}: RSS=${Math.round(used.rss / 1024 / 1024)}MB, Heap=${Math.round(used.heapUsed / 1024 / 1024)}MB`);
        }, 60000);

        this.memoryCleanupInterval = setInterval(() => {
            if (global.gc) {
                global.gc();
                console.log(`🧹 GC вызван для ${this.phone}`);
            }
        }, 60000);
    }

    findBrowser() {
        const possiblePaths = [
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/chrome',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            process.env.PUPPETEER_EXECUTABLE_PATH,
            process.env.CHROME_PATH,
            process.env.CHROME_BIN
        ];

        console.log('🔍 Поиск браузера...');
        for (const p of possiblePaths) {
            if (p && fs.existsSync(p)) {
                console.log(`✅ Найден браузер: ${p}`);
                return p;
            }
        }

        try {
            const { execSync } = require('child_process');
            const cmds = ['chromium-browser', 'chromium', 'chrome'];
            for (const cmd of cmds) {
                try {
                    const result = execSync(`which ${cmd}`, { encoding: 'utf8' }).trim();
                    if (result && fs.existsSync(result)) {
                        console.log(`✅ Найден через which: ${result}`);
                        return result;
                    }
                } catch (e) {}
            }
        } catch (error) {}

        console.log('❌ Браузер не найден');
        return null;
    }

    on(event, handler) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].push(handler);
        }
    }

    async emit(event, data) {
        if (this.eventHandlers[event]) {
            for (const handler of this.eventHandlers[event]) {
                try {
                    await handler(data);
                } catch (error) {
                    console.error(`❌ Ошибка в обработчике ${event}:`, error);
                }
            }
        }
    }

    async sendCode(code) {
        try {
            if (!this.client) {
                throw new Error('Клиент не инициализирован');
            }
            const cleanCode = code.replace(/[-\s]/g, '').toUpperCase();
            console.log(`🔢 Отправка кода ${cleanCode} для ${this.phone}`);
            await this.client.sendCode(cleanCode);
            console.log(`✅ Код ${cleanCode} отправлен для ${this.phone}`);
            return true;
        } catch (error) {
            console.error(`❌ Ошибка отправки кода ${this.phone}:`, error);
            throw error;
        }
    }

    async generateQRCode(qrData) {
        try {
            return await qrcode.toBuffer(qrData, {
                type: 'png',
                width: 250,
                margin: 1,
                color: { dark: '#000000', light: '#ffffff' }
            });
        } catch (error) {
            console.error('❌ Ошибка генерации QR:', error);
            throw error;
        }
    }

    async closeBrowser() {
        try {
            if (this.client && this.client.pupBrowser) {
                this.browser = this.client.pupBrowser;
            }
            if (this.browser) {
                console.log(`🔄 Закрытие браузера для ${this.phone}...`);
                await this.browser.close();
                this.browser = null;
                console.log(`✅ Браузер закрыт для ${this.phone}`);
                if (global.gc) global.gc();
            }
        } catch (error) {
            console.error(`❌ Ошибка закрытия браузера ${this.phone}:`, error);
        }
    }

    async start() {
        try {
            console.log(`🚀 Запуск клиента для ${this.phone}`);

            if (this.client && this.client.pupBrowser) {
                try {
                    const isConnected = await this.client.pupBrowser.isConnected();
                    if (isConnected) {
                        console.log(`⚠️ Браузер уже запущен для ${this.phone}, закрываем...`);
                        await this.client.pupBrowser.close();
                        console.log(`✅ Старый браузер закрыт для ${this.phone}`);
                    }
                } catch (error) {
                    console.log(`⚠️ Ошибка проверки браузера: ${error.message}`);
                }
            }

            this.client.on('qr', async (qrData) => {
                console.log(`📱 QR код для ${this.phone}`);
                this.qrCode = qrData;
                if (this.method === 'qr') {
                    try {
                        const qrImage = await this.generateQRCode(qrData);
                        await this.emit('qr', qrImage);
                    } catch (error) {
                        console.error('❌ Ошибка QR:', error);
                    }
                }
            });

            this.client.on('authenticated', async (session) => {
                console.log(`✅ ${this.phone} аутентифицирован`);
                this.isAuthenticated = true;
                this.messageCount = 0;
                await this.emit('authenticated', session);
            });

            this.client.on('ready', async () => {
                console.log(`🟢 ${this.phone} готов`);
                await this.emit('ready');
            });

            this.client.on('auth_failure', async (error) => {
                console.error(`❌ Ошибка ${this.phone}:`, error);
                this.isAuthenticated = false;
                await this.emit('auth_failure', error);
                await this.closeBrowser();
            });

            this.client.on('message', async (message) => {
                console.log(`💬 Сообщение для ${this.phone}:`, message.body);
                this.messageCount++;
                
                if (this.messageCount >= this.MAX_MESSAGES) {
                    console.log(`🔄 Перезапуск клиента ${this.phone} для освобождения памяти...`);
                    await this.closeBrowser();
                    this.messageCount = 0;
                    setTimeout(() => this.start(), 5000);
                }
                
                await this.emit('message', message);
            });

            this.client.on('disconnected', async (reason) => {
                console.log(`🔴 ${this.phone} отключен:`, reason);
                this.isAuthenticated = false;
                await this.emit('disconnected', reason);
                await this.closeBrowser();
            });

            this.client.on('change_state', async (state) => {
                console.log(`📊 ${this.phone} состояние:`, state);
                if (['CONFLICT', 'UNPAIRED', 'UNLAUNCHED'].includes(state)) {
                    await this.closeBrowser();
                }
            });

            await this.client.initialize();
            console.log(`✅ Клиент ${this.phone} инициализирован`);

            if (this.client.pupBrowser) {
                this.browser = this.client.pupBrowser;
            }
        } catch (error) {
            console.error(`❌ Ошибка запуска ${this.phone}:`, error);
            await this.closeBrowser();
            throw error;
        }
    }

    async getQRCode() {
        if (this.qrCode) {
            return await this.generateQRCode(this.qrCode);
        }
        return null;
    }

    async stop() {
        try {
            console.log(`⏹ Остановка ${this.phone}`);
            if (this.memoryMonitor) {
                clearInterval(this.memoryMonitor);
                this.memoryMonitor = null;
            }
            if (this.memoryCleanupInterval) {
                clearInterval(this.memoryCleanupInterval);
                this.memoryCleanupInterval = null;
            }
            await this.closeBrowser();
            if (this.client) {
                await this.client.destroy();
                console.log(`✅ Клиент ${this.phone} остановлен`);
            }
            if (global.gc) global.gc();
        } catch (error) {
            console.error(`❌ Ошибка остановки ${this.phone}:`, error);
        }
    }

    async sendMessage(to, text) {
        try {
            if (!this.isAuthenticated) throw new Error('Не авторизован');
            const chatId = to.includes('@') ? to : `${to}@c.us`;
            const result = await this.client.sendMessage(chatId, text);
            console.log(`✅ Сообщение от ${this.phone} к ${to}`);
            return result;
        } catch (error) {
            console.error(`❌ Ошибка отправки от ${this.phone}:`, error);
            throw error;
        }
    }

    async getAuthStatus() {
        try {
            if (this.client) {
                const state = await this.client.getState();
                this.isAuthenticated = state === 'CONNECTED';
                return this.isAuthenticated;
            }
            return false;
        } catch (error) {
            console.error('❌ Ошибка статуса:', error);
            return false;
        }
    }
}

module.exports = WhatsAppClient;
