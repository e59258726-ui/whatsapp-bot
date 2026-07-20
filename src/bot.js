// src/bot.js
const { Telegraf, Markup, session } = require('telegraf');
const config = require('./config');
const Database = require('./database');
const ProgressService = require('./service');
const WhatsAppClient = require('./whatsapp');

class TelegramBot {
    constructor() {
        if (!config.BOT_TOKEN) {
            console.error('❌ BOT_TOKEN не найден!');
            throw new Error('BOT_TOKEN is required');
        }

        this.bot = new Telegraf(config.BOT_TOKEN);
        this.db = new Database();
        this.service = new ProgressService(this.db);
        this.service.setBot(this);
        this.clients = new Map();
        this.service.setClients(this.clients);
        this.userStates = new Map();
        this.isRunning = false;

        this.bot.use(session());

        this.setupCommands();
        this.setupHandlers();
        this.setupActions();
        this.setupErrorHandler();

        setInterval(() => {
            this.checkAccounts();
        }, 5 * 60 * 1000);

        setInterval(() => {
            const used = process.memoryUsage();
            console.log(`📊 Общая память: RSS=${Math.round(used.rss / 1024 / 1024)}MB, Heap=${Math.round(used.heapUsed / 1024 / 1024)}MB`);
            console.log(`📱 Активных клиентов: ${this.clients.size}`);
        }, 60000);

        console.log('✅ Бот инициализирован');
    }

    setupErrorHandler() {
        this.bot.catch((err, ctx) => {
            console.error(`❌ Ошибка:`, err);
            ctx.reply('❌ Произошла ошибка').catch(() => {});
        });

        process.on('unhandledRejection', (error) => {
            console.error('❌ Необработанная ошибка:', error);
        });

        process.on('uncaughtException', (error) => {
            console.error('❌ Неперехваченная ошибка:', error);
        });
    }

    getMainKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('📊 Статистика', 'main_stats')],
            [Markup.button.callback('▶️ Запустить прогрев', 'main_start')],
            [Markup.button.callback('⏹ Остановить прогрев', 'main_stop')],
            [Markup.button.callback('➕ Добавить аккаунт', 'main_add')],
            [Markup.button.callback('📋 Аккаунты', 'main_accounts')],
            [Markup.button.callback('🔍 Проверить аккаунты', 'main_check')],
            [Markup.button.callback('📊 Статус прогрева', 'main_progress_status')],
            [Markup.button.callback('⚙️ Настройки', 'main_settings')],
            [Markup.button.callback('🆘 Помощь', 'main_help')]
        ]);
    }

    getAuthMethodKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('📱 QR-код', 'auth_qr')],
            [Markup.button.callback('🔢 Код 8 цифр', 'auth_code')],
            [Markup.button.callback('❌ Отмена', 'auth_cancel')]
        ]);
    }

    getAuthKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('✅ Всё готово', 'auth_ready')],
            [Markup.button.callback('🔄 Показать QR', 'auth_show_qr')],
            [Markup.button.callback('❌ Отмена', 'auth_cancel')]
        ]);
    }

    getSettingsKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('🕐 6 часов', 'set_6')],
            [Markup.button.callback('🕐 12 часов', 'set_12')],
            [Markup.button.callback('🕐 24 часа', 'set_24')],
            [Markup.button.callback('🕐 48 часов', 'set_48')],
            [Markup.button.callback('🔙 Назад', 'back_main')]
        ]);
    }

    setupCommands() {
        this.bot.use(async (ctx, next) => {
            console.log(`📨 [${new Date().toISOString()}] Сообщение:`, {
                from: ctx.from?.id,
                username: ctx.from?.username,
                text: ctx.message?.text,
                type: ctx.updateType
            });
            try {
                await next();
            } catch (error) {
                console.error('❌ Ошибка в middleware:', error);
            }
        });

        this.bot.command('start', async (ctx) => {
            console.log(`✅ /start от ${ctx.from.id}`);
            await ctx.reply(
                '🤖 *WhatsApp Progress Bot*\n\n' +
                '📱 Управляй прогревом аккаунтов WhatsApp!\n' +
                '🗄️ Данные сохраняются в базе данных\n\n' +
                '📌 *Выберите действие в меню:*',
                {
                    parse_mode: 'Markdown',
                    ...this.getMainKeyboard()
                }
            );
        });

        this.bot.command('add_account', async (ctx) => {
            console.log(`➕ /add_account от ${ctx.from.id}`);
            await this.startAddAccount(ctx);
        });

        this.bot.command('stats', async (ctx) => {
            console.log(`📊 /stats от ${ctx.from.id}`);
            await this.showStats(ctx);
        });

        this.bot.command('start_progress', async (ctx) => {
            console.log(`▶️ /start_progress от ${ctx.from.id}`);
            await this.startProgress(ctx);
        });

        this.bot.command('stop_progress', async (ctx) => {
            console.log(`⏹ /stop_progress от ${ctx.from.id}`);
            await this.stopProgress(ctx);
        });

        this.bot.command('accounts', async (ctx) => {
            console.log(`📋 /accounts от ${ctx.from.id}`);
            await this.showAccounts(ctx);
        });

        this.bot.command('check', async (ctx) => {
            console.log(`🔍 /check от ${ctx.from.id}`);
            await ctx.reply('🔄 Проверяю состояние аккаунтов...');
            await this.checkAccounts();
            await ctx.reply('✅ Проверка завершена. Результаты в логах.');
        });

        this.bot.command('progress_status', async (ctx) => {
            console.log(`📊 /progress_status от ${ctx.from.id}`);
            await this.showProgressStatus(ctx);
        });

        this.bot.command('help', async (ctx) => {
            console.log(`🆘 /help от ${ctx.from.id}`);
            await this.showHelp(ctx);
        });
    }

    async startAddAccount(ctx) {
        this.userStates.set(ctx.from.id, { step: 'waiting_phone', phone: null, name: null });
        await ctx.reply(
            '📱 *Добавление аккаунта*\n\n' +
            'Введите номер телефона в международном формате:\n' +
            'Пример: `+79637332642`\n\n' +
            'Или нажмите кнопку "❌ Отмена"',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Отмена', 'add_cancel')]
                ])
            }
        );
    }

    async startProgress(ctx) {
        if (this.service.isRunning) {
            await ctx.reply('⚠️ Прогрев уже запущен!');
            return;
        }
        await ctx.reply('🔄 Запускаю прогрев...');
        await this.service.start();
        await ctx.reply('✅ Прогрев запущен!');
    }

    async stopProgress(ctx) {
        if (!this.service.isRunning) {
            await ctx.reply('⚠️ Прогрев не запущен!');
            return;
        }
        await this.service.stop();
        await ctx.reply('⏹ Прогрев остановлен!');
    }

    async showHelp(ctx) {
        await ctx.reply(
            '🆘 *Команды:*\n\n' +
            '/start - Главное меню\n' +
            '/add_account - Добавить аккаунт\n' +
            '/stats - Статистика\n' +
            '/accounts - Список аккаунтов\n' +
            '/check - Проверить аккаунты\n' +
            '/progress_status - Статус прогрева\n' +
            '/start_progress - Запустить прогрев\n' +
            '/stop_progress - Остановить прогрев\n' +
            '/help - Помощь',
            { parse_mode: 'Markdown' }
        );
    }

    setupHandlers() {
        this.bot.on('text', async (ctx) => {
            const userId = ctx.from.id;
            const state = this.userStates.get(userId);
            const text = ctx.message.text;

            console.log(`📝 Текст от ${userId}: "${text}"`);

            if (!state) return;

            if (state.step === 'waiting_phone') {
                const phone = text.trim();
                if (!phone.match(/^\+?\d{10,15}$/)) {
                    await ctx.reply(
                        '❌ Неверный формат. Используйте +79637332642',
                        Markup.inlineKeyboard([
                            [Markup.button.callback('❌ Отмена', 'add_cancel')]
                        ])
                    );
                    return;
                }
                const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
                
                try {
                    await this.db.addAccount(normalizedPhone, 'WhatsApp');
                    await ctx.reply(`✅ Аккаунт ${normalizedPhone} добавлен!`);
                    
                    await ctx.reply(
                        `🔐 *Выберите метод авторизации для ${normalizedPhone}:*`,
                        { parse_mode: 'Markdown', ...this.getAuthMethodKeyboard() }
                    );
                    
                    state.phone = normalizedPhone;
                    state.step = 'waiting_auth_method';
                    this.userStates.set(userId, state);
                } catch (error) {
                    console.error('❌ Ошибка добавления аккаунта:', error);
                    await ctx.reply(`❌ Ошибка: ${error.message}`);
                    this.userStates.delete(userId);
                }
                return;
            }

            if (state.step === 'waiting_code') {
                const code = text.trim().replace(/[-\s]/g, '').toUpperCase();
                console.log(`🔢 Получен код: "${code}"`);
                
                if (!code.match(/^[A-Z0-9]{8}$/)) {
                    await ctx.reply(
                        '❌ *Неверный формат кода!*\n\n' +
                        'Введите 8-значный код из WhatsApp Web:\n' +
                        'Пример: `ZT1TSGK2` или `ZT1T-SGK2`',
                        {
                            parse_mode: 'Markdown',
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback('❌ Отмена', 'auth_cancel')]
                            ])
                        }
                    );
                    return;
                }
                
                const formattedCode = code.slice(0, 4) + '-' + code.slice(4);
                const client = this.clients.get(state.phone);
                if (client) {
                    try {
                        await ctx.reply(`🔄 Отправляю код ${formattedCode}...`);
                        await client.sendCode(code);
                        await ctx.reply(`✅ Код ${formattedCode} отправлен!\n⏳ Ожидайте подтверждения...`);
                    } catch (error) {
                        await ctx.reply(`❌ Ошибка: ${error.message}`);
                    }
                } else {
                    await ctx.reply('❌ Клиент не найден');
                }
                this.userStates.delete(userId);
                return;
            }
        });
    }

    setupActions() {
        // Главное меню
        this.bot.action('main_stats', async (ctx) => {
            await ctx.answerCbQuery();
            await this.showStats(ctx);
        });

        this.bot.action('main_start', async (ctx) => {
            await ctx.answerCbQuery();
            await this.startProgress(ctx);
        });

        this.bot.action('main_stop', async (ctx) => {
            await ctx.answerCbQuery();
            await this.stopProgress(ctx);
        });

        this.bot.action('main_add', async (ctx) => {
            await ctx.answerCbQuery();
            await this.startAddAccount(ctx);
        });

        this.bot.action('main_accounts', async (ctx) => {
            await ctx.answerCbQuery();
            await this.showAccounts(ctx);
        });

        this.bot.action('main_check', async (ctx) => {
            await ctx.answerCbQuery();
            await ctx.reply('🔄 Проверяю состояние аккаунтов...');
            await this.checkAccounts();
            await ctx.reply('✅ Проверка завершена. Результаты в логах.');
        });

        this.bot.action('main_progress_status', async (ctx) => {
            await ctx.answerCbQuery();
            await this.showProgressStatus(ctx);
        });

        this.bot.action('main_settings', async (ctx) => {
            await ctx.answerCbQuery();
            await ctx.reply(
                '⚙️ *Настройки*\n\nВыберите время прогрева:',
                { parse_mode: 'Markdown', ...this.getSettingsKeyboard() }
            );
        });

        this.bot.action('main_help', async (ctx) => {
            await ctx.answerCbQuery();
            await this.showHelp(ctx);
        });

        // Добавление аккаунта
        this.bot.action('add_cancel', async (ctx) => {
            await ctx.answerCbQuery();
            this.userStates.delete(ctx.from.id);
            await ctx.reply('❌ Отменено', this.getMainKeyboard());
        });

        // === АВТОРИЗАЦИЯ: QR ===
        this.bot.action('auth_qr', async (ctx) => {
            await ctx.answerCbQuery();
            const userId = ctx.from.id;
            const state = this.userStates.get(userId);
            if (!state || !state.phone) {
                await ctx.reply('❌ Сессия истекла. Начните заново через /add_account');
                return;
            }
            await ctx.reply('📱 Запускаю авторизацию через QR-код...');
            await this.startAuth(ctx, state.phone, state.name || 'WhatsApp', 'qr');
        });

        // === АВТОРИЗАЦИЯ: КОД 8 ЦИФР ===
        this.bot.action('auth_code', async (ctx) => {
            await ctx.answerCbQuery();
            const userId = ctx.from.id;
            const state = this.userStates.get(userId);
            if (!state || !state.phone) {
                await ctx.reply('❌ Сессия истекла. Начните заново через /add_account');
                return;
            }
            await ctx.reply(
                '🔢 *Генерация 8-значного кода...*\n\n' +
                '⏳ Пожалуйста, подождите несколько секунд...',
                { parse_mode: 'Markdown' }
            );
            await this.startAuth(ctx, state.phone, state.name || 'WhatsApp', 'code');
        });

        // === АВТОРИЗАЦИЯ: ВСЁ ГОТОВО ===
        this.bot.action('auth_ready', async (ctx) => {
            await ctx.answerCbQuery();
            const userId = ctx.from.id;
            const state = this.userStates.get(userId);
            
            if (!state || !state.phone) {
                await ctx.reply('❌ Сессия истекла. Начните заново через /add_account');
                return;
            }
            
            const client = this.clients.get(state.phone);
            if (!client) {
                await ctx.reply('❌ Клиент не найден. Попробуйте заново через /add_account');
                this.userStates.delete(userId);
                return;
            }
            
            const isAuth = await client.getAuthStatus();
            if (isAuth) {
                await this.db.updateAccountStatus(state.phone, true);
                await ctx.reply(`✅ Аккаунт ${state.phone} успешно авторизован! 🎉`);
                this.userStates.delete(userId);
            } else {
                await ctx.reply(
                    '⏳ Авторизация еще не подтверждена.\n\n' +
                    'Убедитесь, что вы отсканировали QR-код или ввели код.\n' +
                    'Если вы уже сделали это, подождите еще немного.',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('🔄 Проверить еще раз', 'auth_ready')],
                        [Markup.button.callback('❌ Отмена', 'auth_cancel')]
                    ])
                );
            }
        });

        // === АВТОРИЗАЦИЯ: ПОКАЗАТЬ QR ===
        this.bot.action('auth_show_qr', async (ctx) => {
            await ctx.answerCbQuery();
            const userId = ctx.from.id;
            const state = this.userStates.get(userId);
            if (!state || !state.phone) {
                await ctx.reply('❌ Нет активной сессии');
                return;
            }
            await this.sendQRCode(ctx, state.phone);
        });

        // === АВТОРИЗАЦИЯ: ОТМЕНА ===
        this.bot.action('auth_cancel', async (ctx) => {
            await ctx.answerCbQuery();
            const userId = ctx.from.id;
            const state = this.userStates.get(userId);
            if (state && state.phone) {
                const client = this.clients.get(state.phone);
                if (client) {
                    await client.stop();
                    this.clients.delete(state.phone);
                }
            }
            this.userStates.delete(userId);
            await ctx.reply('❌ Отменено', this.getMainKeyboard());
        });

        // === УДАЛЕНИЕ АККАУНТА ===
        this.bot.action(/delete_(.+)/, async (ctx) => {
            const phone = ctx.match[1];
            await ctx.answerCbQuery('🗑️ Удаление...');
            try {
                await this.db.deleteAccount(phone);
                if (this.clients.has(phone)) {
                    await this.clients.get(phone).stop();
                    this.clients.delete(phone);
                }
                await ctx.reply(`✅ Аккаунт ${phone} удален!`);
                await this.showAccounts(ctx);
            } catch (error) {
                await ctx.reply(`❌ Ошибка: ${error.message}`);
            }
        });

        // === НАСТРОЙКИ ===
        this.bot.action(/set_(\d+)/, async (ctx) => {
            const hours = parseInt(ctx.match[1]);
            await ctx.answerCbQuery(`✅ ${hours} часов`);
            config.PROGRESS_DURATION_HOURS = hours;
            await ctx.reply(`✅ Установлено время прогрева: ${hours} часов`);
        });

        // === НАЗАД ===
        this.bot.action('back_main', async (ctx) => {
            await ctx.answerCbQuery();
            await ctx.reply('Главное меню:', this.getMainKeyboard());
        });
    }

    async showAccounts(ctx) {
        try {
            const accounts = await this.db.getAccounts();
            if (accounts.length === 0) {
                await ctx.reply('📭 Нет аккаунтов');
                return;
            }
            const buttons = [];
            for (const acc of accounts) {
                const status = acc.is_authenticated ? '🟢' : '🔴';
                buttons.push([Markup.button.callback(`${status} ${acc.phone}`, `delete_${acc.phone}`)]);
            }
            buttons.push([Markup.button.callback('🔙 Назад', 'back_main')]);
            await ctx.reply(
                '📋 *Список аккаунтов*\n\n' +
                '🟢 - авторизован\n' +
                '🔴 - не авторизован\n\n' +
                '👆 *Нажмите на номер чтобы удалить*',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard(buttons)
                }
            );
        } catch (error) {
            console.error('❌ Ошибка:', error);
            await ctx.reply('❌ Ошибка получения списка');
        }
    }

    async showStats(ctx) {
        try {
            const stats = await this.db.getStats();
            const accounts = await this.db.getAccounts();
            const progressStats = await this.service.getStats();
            
            const status = this.service.isRunning ? '🟢 Активен' : '🔴 Остановлен';
            const progressStatus = this.service.isComplete ? '✅ Завершен' : status;
            
            await ctx.reply(
                `📊 *Статистика*\n\n` +
                `🟢 Статус прогрева: ${progressStatus}\n` +
                `📱 Аккаунтов: ${stats.total_accounts || 0}\n` +
                `🟢 Авторизовано: ${stats.authenticated_accounts || 0}\n` +
                `💬 Отправлено: ${stats.total_messages || 0}\n` +
                `⏱️ Время прогрева: ${Math.round(progressStats.durationHours * 60) || 0} минут\n` +
                `📨 Сообщений за сессию: ${progressStats.messagesSent || 0}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('❌ Ошибка:', error);
            await ctx.reply('❌ Ошибка получения статистики');
        }
    }

    async showProgressStatus(ctx) {
        try {
            const stats = await this.service.getStats();
            
            let message = `📊 *Статус прогрева*\n\n`;
            
            if (this.service.isRunning) {
                message += `🟢 Прогрев запущен\n`;
                message += `💬 Отправлено: ${stats.messagesSent} сообщений\n`;
                message += `👥 Аккаунтов: ${stats.totalAccounts || 0}\n`;
                message += `⏱️ Время: ${Math.round(stats.durationHours * 60)} минут\n`;
            } else if (this.service.isComplete) {
                message += `✅ Прогрев завершен!\n`;
                message += `💬 Отправлено: ${stats.messagesSent} сообщений\n`;
                message += `⏱️ Время: ${Math.round(stats.durationHours * 60)} минут\n`;
                message += `😴 Аккаунтам нужно отдохнуть!\n`;
            } else {
                message += `🔴 Прогрев не запущен\n`;
                message += `🔄 Запустить: /start_progress\n`;
            }
            
            await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ Ошибка:', error);
            await ctx.reply('❌ Ошибка получения статуса');
        }
    }

    async checkAccounts() {
        try {
            console.log('🔍 Проверка состояния аккаунтов...');
            
            const accounts = await this.db.getAccounts();
            const authorized = accounts.filter(a => a.is_authenticated);
            
            if (authorized.length === 0) {
                console.log('📭 Нет активных аккаунтов для проверки');
                return;
            }
            
            console.log(`📱 Проверяю ${authorized.length} аккаунтов...`);
            
            for (const account of authorized) {
                const client = this.clients.get(account.phone);
                
                if (!client) {
                    console.log(`⚠️ Клиент не найден для ${account.phone}`);
                    await this.handleLostSession(account);
                    continue;
                }
                
                try {
                    const isAuth = await Promise.race([
                        client.getAuthStatus(),
                        new Promise((resolve) => setTimeout(() => resolve(false), 10000))
                    ]);
                    
                    if (!isAuth) {
                        console.log(`⚠️ Аккаунт ${account.phone} не авторизован`);
                        await this.handleLostSession(account);
                    } else {
                        console.log(`✅ Аккаунт ${account.phone} активен`);
                    }
                } catch (error) {
                    console.error(`❌ Ошибка проверки ${account.phone}:`, error);
                    await this.handleLostSession(account);
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка проверки аккаунтов:', error);
        }
    }

    async handleLostSession(account) {
        try {
            console.log(`🔴 Сессия потеряна для ${account.phone}`);
            
            await this.db.updateAccountStatus(account.phone, false);
            
            if (this.clients.has(account.phone)) {
                await this.clients.get(account.phone).stop();
                this.clients.delete(account.phone);
            }
            
            await this.sendNotification(
                `⚠️ *Сессия WhatsApp истекла для ${account.phone}!*\n\n` +
                `📌 Причина: Аккаунт вышел из системы\n` +
                `🔄 Требуется повторная авторизация\n\n` +
                `📱 Чтобы восстановить доступ:\n` +
                `1️⃣ Нажмите "➕ Добавить аккаунт"\n` +
                `2️⃣ Введите номер ${account.phone}\n` +
                `3️⃣ Выберите метод авторизации\n` +
                `4️⃣ Отсканируйте QR-код или введите код`
            );
            
            console.log(`✅ Уведомление отправлено для ${account.phone}`);
            
        } catch (error) {
            console.error(`❌ Ошибка обработки сессии ${account.phone}:`, error);
        }
    }

    async sendNotification(message) {
        try {
            const adminChatId = process.env.ADMIN_CHAT_ID || 8946090726;
            await this.bot.telegram.sendMessage(adminChatId, message, {
                parse_mode: 'Markdown'
            });
        } catch (error) {
            console.error('❌ Ошибка отправки уведомления:', error);
        }
    }

    async startAuth(ctx, phone, name, method = 'qr') {
        try {
            console.log(`🔐 Авторизация ${phone} (метод: ${method})`);
            
            if (this.clients.has(phone)) {
                await this.clients.get(phone).stop();
                this.clients.delete(phone);
            }
            
            const client = new WhatsAppClient(phone, method);
            this.clients.set(phone, client);
            
            this.userStates.set(ctx.from.id, { 
                phone, 
                name: name || 'WhatsApp',
                step: 'waiting_auth' 
            });

            if (method === 'qr') {
                let qrSent = false;
                
                client.on('qr', async (qrImage) => {
                    if (qrSent) return;
                    qrSent = true;
                    try {
                        await ctx.replyWithPhoto(
                            { source: qrImage },
                            {
                                caption: `📱 *QR код для ${phone}*\nОтсканируйте в WhatsApp Web\n\nПосле сканирования нажмите "✅ Всё готово"`,
                                parse_mode: 'Markdown',
                                ...this.getAuthKeyboard()
                            }
                        );
                    } catch (error) {
                        console.error('❌ Ошибка отправки QR:', error);
                    }
                });
                
                setTimeout(async () => {
                    if (!this.userStates.has(ctx.from.id)) return;
                    if (qrSent) return;
                    const qr = await client.getQRCode();
                    if (qr) {
                        qrSent = true;
                        await ctx.replyWithPhoto(
                            { source: qr },
                            {
                                caption: `📱 QR код para ${phone}\n\nПосле сканирования нажмите "✅ Всё готово"`,
                                ...this.getAuthKeyboard()
                            }
                        );
                    }
                }, 3000);
                
                await client.start();
            }

            if (method === 'code') {
                await client.start();
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                try {
                    console.log(`🔢 Генерация кода para ${phone}...`);
                    const code = await client.requestPairingCode(phone);
                    console.log(`✅ Код получен: ${code}`);
                    
                    await ctx.reply(
                        `🔢 *Ваш 8-значный код para ${phone}:*\n\n` +
                        `\`${code}\`\n\n` +
                        `📱 Откройте WhatsApp на телефоне\n` +
                        `1️⃣ Нажмите на три точки (⋮)\n` +
                        `2️⃣ Выберите "WhatsApp Web"\n` +
                        `3️⃣ Введите этот код\n\n` +
                        `⏳ Код действителен несколько минут\n\n` +
                        `После ввода нажмите "✅ Всё готово"`,
                        {
                            parse_mode: 'Markdown',
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback('✅ Всё готово', 'auth_ready')],
                                [Markup.button.callback('🔄 Новый код', 'auth_code')],
                                [Markup.button.callback('❌ Отмена', 'auth_cancel')]
                            ])
                        }
                    );
                } catch (error) {
                    console.error('❌ Ошибка получения кода:', error);
                    await ctx.reply(`❌ Ошибка получения кода: ${error.message}`);
                    this.clients.delete(phone);
                    this.userStates.delete(ctx.from.id);
                    return;
                }
            }

            client.on('authenticated', async () => {
                console.log(`✅ ${phone} авторизован!`);
                await this.db.updateAccountStatus(phone, true);
                await ctx.reply(`✅ Аккаунт ${phone} успешно авторизован! 🎉`);
                this.userStates.delete(ctx.from.id);
            });

            client.on('disconnected', async (data) => {
                const reason = data?.reason || 'Неизвестно';
                const isBan = data?.isBan || false;
                
                console.log(`🔴 ${phone} отключен: ${reason}`);
                
                let message = `⚠️ *Сессия WhatsApp истекла para ${phone}!*\n\n`;
                
                if (isBan) {
                    message += `🚫 *Аккаунт забанен WhatsApp!*\n\n` +
                               `📌 Причина: ${reason} (Бан)\n` +
                               `❌ Аккаунт не может быть восстановлен автоматически\n\n` +
                               `🔄 Para восстановления:\n` +
                               `1️⃣ Удалите аккаунт через "❌ Удалить аккаунт"\n` +
                               `2️⃣ Добавьте заново через "➕ Добавить аккаунт"`;
                } else {
                    message += `🔄 Бот автоматически переподключается...\n` +
                               `⏳ Пожалуйста, подождите 5-10 секунд.\n\n` +
                               `📌 Причина: ${reason}`;
                }
                
                await ctx.reply(message, { parse_mode: 'Markdown' });
                
                this.clients.delete(phone);
                this.userStates.delete(ctx.from.id);
            });

            client.on('auth_failure', async (error) => {
                console.error(`❌ Ошибка ${phone}:`, error);
                
                await ctx.reply(
                    `❌ *Ошибка авторизации para ${phone}!*\n\n` +
                    `🔄 Бот автоматически переподключается...\n` +
                    `⏳ Пожалуйста, подождите 5-10 секунд.\n\n` +
                    `📌 Ошибка: ${error.message || error}`,
                    { parse_mode: 'Markdown' }
                );
                
                this.clients.delete(phone);
                this.userStates.delete(ctx.from.id);
            });

            client.on('ready', async () => {
                console.log(`🟢 ${phone} готов к работе`);
                await ctx.reply(
                    `✅ *Аккаунт ${phone} успешно переподключен!* 🎉\n\n` +
                    `🟢 Сессия активна и готова к работе.`,
                    { parse_mode: 'Markdown' }
                );
            });

        } catch (error) {
            console.error('❌ Ошибка авторизации:', error);
            await ctx.reply(`❌ Ошибка: ${error.message}`);
            if (this.clients.has(phone)) {
                await this.clients.get(phone).stop();
                this.clients.delete(phone);
            }
            this.userStates.delete(ctx.from.id);
        }
    }

    async sendQRCode(ctx, phone) {
        const client = this.clients.get(phone);
        if (!client) {
            await ctx.reply('❌ Клиент не найден');
            return;
        }
        const qr = await client.getQRCode();
        if (qr) {
            await ctx.replyWithPhoto(
                { source: qr },
                { 
                    caption: '📱 QR код',
                    ...this.getAuthKeyboard()
                }
            );
        } else {
            await ctx.reply('❌ QR код не найден');
        }
    }

    async start() {
        try {
            console.log('🚀 Запуск бота...');
            await this.db.connect();
            console.log('✅ База данных подключена');
            await this.bot.launch();
            this.isRunning = true;
            console.log('🚀 Бот запущен!');
        } catch (error) {
            console.error('❌ Ошибка:', error);
            throw error;
        }
    }

    async stop() {
        try {
            console.log('⏹ Остановка...');
            if (this.bot && this.isRunning) {
                try {
                    await this.bot.stop();
                    console.log('✅ Бот остановлен');
                } catch (error) {
                    if (error.message !== 'Bot is not running!') {
                        console.error('❌ Ошибка остановки бота:', error);
                    }
                }
            }
            if (this.db) {
                await this.db.disconnect();
            }
            for (const [phone, client] of this.clients) {
                await client.stop();
            }
            this.clients.clear();
            console.log('⏹ Бот остановлен');
        } catch (error) {
            console.error('❌ Ошибка при остановке:', error);
        }
    }
}

module.exports = TelegramBot;
