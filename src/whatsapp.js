// src/whatsapp.js - ПОЛНЫЙ ИСПРАВЛЕННЫЙ КОНСТРУКТОР

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

    this.client = new Client({
        authStrategy: new LocalAuth({
            clientId: this.clientId,
            dataPath: sessionsDir
        }),
        puppeteer: {
            executablePath: executablePath || undefined,
            headless: 'new',
            // ===== НОВЫЕ ПАРАМЕТРЫ =====
            protocolTimeout: 120000, // ДОБАВЛЕНО
            timeout: 120000,         // ДОБАВЛЕНО
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
