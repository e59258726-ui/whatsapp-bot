// src/whatsapp.js - БЕЗ PINO
const makeWASocket = require('baileys').default;
const {
    useMultiFileAuthState,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    Browsers
} = require('baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class WhatsAppClient {
    constructor(phone, method = 'qr') {
        this.phone = phone;
        this.method = method;
        this.clientId = phone.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!this.clientId) this.clientId = `client_${Date.now()}`;

        console.log(`📱 Создание клиента для ${phone} (ID: ${this.clientId})`);

        this.authDir = path.join(process.cwd(), config.BAILEYS_AUTH_DIR || './auth_info_baileys', this.clientId);
        
        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
        }

        this.isAuthenticated = false;
        this.qrCode = null;
        this.socket = null;
        this.eventHandlers = {
            qr: [],
            code: [],
            authenticated: [],
            ready: [],
            auth_failure: [],
            message: [],
            disconnected: []
        };
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

    async getQRCode() {
        if (this.qrCode) {
            return await this.generateQRCode(this.qrCode);
        }
        return null;
    }

    async sendCode(code) {
        try {
            if (!this.socket) {
                throw new Error('Клиент не инициализирован');
            }
            console.log(`🔢 Код ${code} для ${this.phone}`);
            return true;
        } catch (error) {
            console.error(`❌ Ошибка отправки кода ${this.phone}:`, error);
            throw error;
        }
    }

    async start() {
        try {
            console.log(`🚀 Запуск Baileys клиента для ${this.phone}`);

            // Простой логгер без pino
            const logger = {
                log: (msg) => console.log(`📊 [Baileys] ${msg}`),
                info: (msg) => console.log(`ℹ️ [Baileys] ${msg}`),
                warn: (msg) => console.log(`⚠️ [Baileys] ${msg}`),
                error: (msg) => console.log(`❌ [Baileys] ${msg}`),
                trace: (msg) => console.log(`🔍 [Baileys] ${msg}`),
                debug: (msg) => console.log(`🐛 [Baileys] ${msg}`),
                fatal: (msg) => console.log(`💀 [Baileys] ${msg}`),
                child: () => logger,
                level: 'warn'
            };

            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

            this.socket = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger)
                },
                printQRInTerminal: true,
                logger: logger,
                browser: Browsers.macOS('Desktop'),
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                markOnlineOnConnect: false
            });

            this.socket.ev.on('creds.update', saveCreds);

            this.socket.ev.on('connection.update', async (update) => {
                const { connection, qr, lastDisconnect } = update;

                if (qr) {
                    console.log(`📱 QR код для ${this.phone} получен`);
                    this.qrCode = qr;
                    try {
                        const qrImage = await this.generateQRCode(qr);
                        await this.emit('qr', qrImage);
                    } catch (error) {
                        console.error('❌ Ошибка обработки QR:', error);
                    }
                }

                if (connection === 'open') {
                    console.log(`✅ ${this.phone} аутентифицирован!`);
                    this.isAuthenticated = true;
                    await this.emit('authenticated', {});
                    await this.emit('ready');
                }

                if (connection === 'close') {
                    const shouldReconnect = (
                        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
                    );
                    console.log(`🔴 ${this.phone} отключен:`, lastDisconnect?.error);

                    if (shouldReconnect) {
                        console.log(`🔄 Переподключение ${this.phone}...`);
                        setTimeout(() => this.start(), 5000);
                    } else {
                        console.log(`❌ ${this.phone} разлогинен`);
                        this.isAuthenticated = false;
                        await this.emit('disconnected', lastDisconnect?.error);
                    }
                }
            });

            this.socket.ev.on('messages.upsert', async (m) => {
                const msg = m.messages[0];
                if (msg.key.fromMe) return;
                if (!msg.message) return;

                const messageContent = msg.message.conversation ||
                    msg.message.extendedTextMessage?.text ||
                    msg.message.imageMessage?.caption ||
                    '';

                console.log(`💬 Сообщение для ${this.phone}: ${messageContent}`);
                await this.emit('message', {
                    from: msg.key.remoteJid,
                    body: messageContent,
                    raw: msg
                });
            });

            this.socket.ev.on('error', async (error) => {
                console.error(`❌ Ошибка ${this.phone}:`, error);
                await this.emit('auth_failure', error.message);
            });

            console.log(`✅ Клиент ${this.phone} инициализирован`);

        } catch (error) {
            console.error(`❌ Ошибка запуска ${this.phone}:`, error);
            await this.emit('auth_failure', error.message);
            throw error;
        }
    }

    async stop() {
        try {
            console.log(`⏹ Остановка ${this.phone}`);
            if (this.socket) {
                this.socket.end();
                this.socket = null;
                console.log(`✅ Клиент ${this.phone} остановлен`);
            }
        } catch (error) {
            console.error(`❌ Ошибка остановки ${this.phone}:`, error);
        }
    }

    async sendMessage(to, text) {
        try {
            if (!this.isAuthenticated || !this.socket) {
                throw new Error('Клиент не авторизован');
            }

            const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
            const result = await this.socket.sendMessage(jid, { text });
            console.log(`✅ Сообщение от ${this.phone} к ${to}`);
            return result;
        } catch (error) {
            console.error(`❌ Ошибка отправки от ${this.phone}:`, error);
            throw error;
        }
    }

    async getAuthStatus() {
        return this.isAuthenticated;
    }

    async getState() {
        try {
            if (this.socket) {
                return this.isAuthenticated ? 'CONNECTED' : 'DISCONNECTED';
            }
            return 'UNLAUNCHED';
        } catch (error) {
            return 'ERROR';
        }
    }

    async getInfo() {
        try {
            if (this.socket && this.isAuthenticated) {
                const user = this.socket.authState.creds?.me;
                return user || null;
            }
            return null;
        } catch (error) {
            return null;
        }
    }
}

module.exports = WhatsAppClient;
