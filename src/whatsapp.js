// src/whatsapp.js
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

        // === ПОИСК MICROSOFT EDGE ===
        const executablePath = this.findBrowser();
        
        if (executablePath && (executablePath.includes('edge') || executablePath.includes('msedge'))) {
            console.log(`🔧 Используется Microsoft Edge: ${executablePath}`);
        } else if (executablePath) {
            console.log(`🔧 Используется Chromium: ${executablePath}`);
        } else {
            console.log(`🔧 Используется встроенный Chromium`);
        }

        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: this.clientId,
                dataPath: sessionsDir
            }),
            puppeteer: {
                executablePath: executablePath || undefined,
                headless: true,
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
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-web-security',
                    '--disable-features=BlockInsecurePrivateNetworkRequests',
                    '--metrics-recording-only',
                    '--no-first-run',
                    '--hide-scrollbars',
                    '--mute-audio',
                    '--js-flags="--max-old-space-size=256"'
                ],
                defaultViewport: null,
                ignoreHTTPSErrors: true,
                timeout: 60000,
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
        this.eventHandlers = {
            qr: [],
            code: [],
            authenticated: [],
            ready: [],
            auth_failure: [],
            message: [],
            disconnected: []
        };

        this.memoryCleanupInterval = setInterval(() => {
            if (global.gc) {
                global.gc();
                console.log(`🧹 GC для ${this.phone}`);
            }
        }, 60000);
    }

    // ============================================
    // ПОИСК MICROSOFT EDGE (ПРИОРИТЕТ)
    // ============================================
    findBrowser() {
        const possiblePaths = [
            // === MICROSOFT EDGE (ПРИОРИТЕТ) ===
            '/usr/bin/microsoft-edge-stable',
            '/usr/bin/microsoft-edge',
            '/usr/bin/microsoft-edge-beta',
            '/usr/bin/edge',
            '/usr/bin/msedge',
            '/opt/microsoft/msedge/msedge',
            '/usr/lib/microsoft-edge/microsoft-edge',
            // Windows
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            // MacOS
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            
            // === CHROMIUM (ЗАПАСНОЙ) ===
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/chrome',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            
            // === ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ===
            process.env.PUPPETEER_EXECUTABLE_PATH,
            process.env.EDGE_PATH,
            process.env.CHROME_PATH,
            process.env.CHROME_BIN
        ];

        console.log('🔍 Поиск браузера (приоритет: Microsoft Edge)...');
        
        for (const p of possiblePaths) {
            if (p && fs.existsSync(p)) {
                const isEdge = p.toLowerCase().includes('edge') || p.toLowerCase().includes('msedge');
                console.log(`✅ Найден браузер: ${p} ${isEdge ? '(Microsoft Edge)' : '(Chromium)'}`);
                return p;
            }
        }

        // Пробуем найти через which (приоритет Edge)
        try {
            const { execSync } = require('child_process');
            const cmds = [
                'microsoft-edge-stable',
                'microsoft-edge', 
                'msedge', 
                'edge',
                'chromium-browser', 
                'chromium', 
                'chrome'
            ];
            
            for (const cmd of cmds) {
                try {
                    const result = execSync(`which ${cmd}`, { encoding: 'utf8' }).trim();
                    if (result && fs.existsSync(result)) {
                        const isEdge = cmd.includes('edge') || cmd.includes('msedge');
                        console.log(`✅ Найден через which: ${result} ${isEdge ? '(Microsoft Edge)' : '(Chromium)'}`);
                        return result;
                    }
                } catch (e) {}
            }
        } catch (error) {}

        // Windows: поиск через where
        try {
            const { execSync } = require('child_process');
            if (process.platform === 'win32') {
                const result = execSync('where msedge', { encoding: 'utf8' }).trim();
                if (result && fs.existsSync(result)) {
                    console.log(`✅ Найден Edge через where: ${result}`);
                    return result;
                }
            }
        } catch (error) {}

        console.log('❌ Microsoft Edge не найден, используется встроенный Chromium');
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
