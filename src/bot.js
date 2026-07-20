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
            this.autoCheckAccounts();
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
                '🗄️ Данные сохраняются в базе данных\n' +
                '🔒 У каждого пользователя свои аккаунты\n\n' +
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
            await this.autoCheckAccounts();
            await ctx.reply('✅ Проверка завершена. Результаты в логах.');
        });

        this.bot.command('progress_status', async (ctx) => {
            console.log(`📊 /progress_status от ${ctx.from.id}`);
            await this.showProgressStatus(ctx);
        });

        this.bot.command('restart_clients', async (ctx) => {
            console.log(`🔄 /restart_clients от ${ctx.from.id}`);
            await this.restartClients(ctx);
        });

        this.bot.command('fix', async (ctx) => {
            console.log(`🔧 /fix от ${ctx.from.id}`);
            await ctx.reply('🔄 Восстанавливаю клиентов...');
            const userId = ctx.from.id;
            const accounts = await this.db.getAccounts(userId);
            if (accounts.length === 0) {
                await ctx.reply('📭 У вас нет аккаунтов');
                return;
            }
            let fixed = 0, failed = 0;
            for (const account of accounts) {
                try {
                    const restored = await this.restoreClient(account.phone);
                    if (restored) fixed++;
                    else failed++;
                } catch (error) {
                    failed++;
                }
            }
            await ctx.reply(
                `✅ *Восстановление завершено!*\n\n🟢 Успешно: ${fixed}\n🔴 Ошибок: ${failed}`,
                { parse_mode: 'Markdown' }
            );
        });

        this.bot.command('test_send', async (ctx) => {
            const userId = ctx.from.id;
            const accounts = await this.db.getAccounts(userId);
            const authorized = accounts.filter(a => a.is_authenticated);
            
            if (authorized.length < 2) {
                await ctx.reply('❌ Нужно минимум 2 аккаунта для теста');
                return;
            }
            
            await ctx.reply('🔄 Отправляю тестовое сообщение...');
            
            const fromAccount = authorized[0];
            const toAccount = authorized[1];
            const client = this.clients.get(fromAccount.phone);
            
            if (!client) {
                await ctx.reply('❌ Клиент не найден');
                return;
            }
            
            try {
                const testMessage = `🧪 Тестовое сообщение от ${fromAccount.phone} к ${toAccount.phone} в ${new Date().toLocaleTimeString()}`;
                await client.sendMessage(toAccount.phone, testMessage);
                await ctx.reply(`✅ Тестовое сообщение отправлено!\n\n📨 ${fromAccount.phone} → ${toAccount.phone}\n💬 ${testMessage}`);
            } catch (error) {
                await ctx.reply(`❌ Ошибка: ${error.message}`);
            }
        });

        this.bot.command('help', async (ctx) => {
            console.log(`🆘 /help от ${ctx.from.id}`);
            await this.showHelp(ctx);
        });
    }

    async startAddAccount(ctx) {
        const userId = ctx.from.id;
        this.userStates.set(userId, { step: 'waiting_phone', phone: null, name: null });
        await ctx.reply(
            '📱 *Добавление аккаунта*\n\n' +
            'Введите номер телефона в международном формате:\n' +
            'Пример: `+79637332642`\n\n' +
            '⚠️ *Важно:* Этот номер будет привязан к вашему аккаунту.\n' +
            'Другие пользователи не увидят ваш номер.',
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
            '/restart_clients - Перезапустить клиентов\n' +
            '/fix - Восстановить клиентов\n' +
            '/test_send - Тестовая отправка\n' +
            '/start_progress - Запустить прогрев\n' +
            '/stop_progress - Остановить прогрев\n' +
            '/help - Помощь',
            { parse_mode: 'Markdown' }
        );
    }

    async restartClients(ctx) {
        const userId = ctx.from.id;
        await ctx.reply('🔄 Перезапускаю клиентов WhatsApp...');
        const accounts = await this.db.getAccounts(userId);
        const authorized = accounts.filter(a => a.is_authenticated);
        if (authorized.length === 0) {
            await ctx.reply('❌ У вас нет авторизованных аккаунтов');
            return;
        }
        let successCount = 0, failCount = 0;
        for (const account of authorized) {
            try {
                if (this.clients.has(account.phone)) {
                    await this.clients.get(account.phone).stop();
                    this.clients.delete(account.phone);
                }
                const client = new WhatsAppClient(account.phone, 'qr');
                this.clients.set(account.phone, client);
                client.on('ready', async () => {
                    console.log(`🟢 ${account.phone} готов`);
                    await this.db.updateAccountStatus(account.phone, true);
                });
                client.on('auth_failure', async (error) => {
                    console.error(`❌ Ошибка ${account.phone}:`, error);
                    await this.db.updateAccountStatus(account.phone, false);
                });
                await client.start();
                successCount++;
            } catch (error) {
                failCount++;
            }
        }
        await ctx.reply(
            `✅ *Перезапуск завершен!*\n\n🟢 Успешно: ${successCount}\n🔴 Ошибок: ${failCount}`,
            { parse_mode: 'Markdown' }
        );
    }

    async autoCheckAccounts() {
        try {
            console.log('═══════════════════════════════════════');
            console.log('🔍 АВТОПРОВЕРКА АККАУНТОВ');
            console.log(`📅 ${new Date().toLocaleString()}`);
            console.log('═══════════════════════════════════════');
            
            const allAccounts = await this.db.getAccounts();
            if (allAccounts.length === 0) {
                console.log('📭 Нет аккаунтов');
                return;
            }
            
            console.log(`📱 Всего аккаунтов: ${allAccounts.length}`);
            let changes = [], onlineCount = 0, offlineCount = 0, autoFixed = 0;
            
            for (const account of allAccounts) {
                const client = this.clients.get(account.phone);
                let currentStatus = account.is_authenticated;
                let newStatus = currentStatus;
                let statusCheck = 'не проверен';
                
                if (client) {
                    try {
                        const isAuth = await Promise.race([
                            client.getAuthStatus(),
                            new Promise((resolve) => setTimeout(() => resolve(false), 10000))
                        ]);
                        newStatus = isAuth;
                        statusCheck = isAuth ? '✅ активен' : '❌ не активен';
                    } catch (error) {
                        newStatus = false;
                        statusCheck = `⚠️ ошибка`;
                        const restored = await this.restoreClient(account.phone);
                        if (restored) {
                            newStatus = true;
                            statusCheck = '✅ восстановлен';
                            autoFixed++;
                        }
                    }
                } else {
                    console.log(`🔧 Создание клиента для ${account.phone}...`);
                    const restored = await this.restoreClient(account.phone);
                    if (restored) {
                        newStatus = true;
                        statusCheck = '✅ создан';
                        autoFixed++;
                    } else {
                        newStatus = false;
                        statusCheck = '❌ не создан';
                    }
                }
                
                if (newStatus) onlineCount++;
                else offlineCount++;
                
                if (currentStatus !== newStatus) {
                    console.log(`🔄 Изменение статуса ${account.phone}: ${currentStatus} → ${newStatus}`);
                    await this.db.updateAccountStatus(account.phone, newStatus);
                    changes.push({ phone: account.phone, oldStatus: currentStatus, newStatus: newStatus });
                }
                console.log(`  📱 ${account.phone}: ${statusCheck} (БД: ${currentStatus ? '✅' : '❌'})`);
            }
            
            console.log('═══════════════════════════════════════');
            console.log(`📊 ИТОГО: ${allAccounts.length} аккаунтов`);
            console.log(`  🟢 В сети: ${onlineCount}`);
            console.log(`  🔴 Не в сети: ${offlineCount}`);
            console.log(`  🔄 Изменений: ${changes.length}`);
            console.log(`  🔧 Автовосстановлено: ${autoFixed}`);
            console.log('═══════════════════════════════════════');
            
            if (changes.length > 0) {
                await this.sendStatusChangesNotification(changes);
            }
            
            if (autoFixed > 0) {
                await this.sendNotification(
                    `🔧 *Автовосстановление*\n\n✅ Восстановлено: ${autoFixed}`
                );
            }
            
            if (onlineCount === 0 && allAccounts.length > 0) {
                await this.sendNotification(
                    `⚠️ ВНИМАНИЕ!\n\nВсе аккаунты (${allAccounts.length}) вышли из системы!\n\n🔄 Требуется повторная авторизация.`
                );
            }
            
            console.log('✅ Автопроверка завершена');
        } catch (error) {
            console.error('❌ Ошибка автопроверки:', error);
        }
    }

    async restoreClient(phone) {
        try {
            console.log(`🔧 Восстановление ${phone}...`);
            if (this.clients.has(phone)) {
                try { await this.clients.get(phone).stop(); } catch (e) {}
                this.clients.delete(phone);
            }
            const client = new WhatsAppClient(phone, 'qr');
            this.clients.set(phone, client);
            return new Promise((resolve) => {
                let resolved = false;
                const timeout = setTimeout(() => {
                    if (!resolved) resolve(false);
                }, 30000);
                client.on('ready', async () => {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timeout);
                    console.log(`🟢 ${phone} готов`);
                    await this.db.updateAccountStatus(phone, true);
                    resolve(true);
                });
                client.on('auth_failure', async (error) => {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timeout);
                    console.error(`❌ Ошибка ${phone}:`, error);
                    await this.db.updateAccountStatus(phone, false);
                    resolve(false);
                });
                client.start().catch(async (error) => {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timeout);
                    console.error(`❌ Ошибка запуска ${phone}:`, error);
                    await this.db.updateAccountStatus(phone, false);
                    resolve(false);
                });
            });
        } catch (error) {
            console.error(`❌ Ошибка восстановления ${phone}:`, error);
            return false;
        }
    }

    async sendStatusChangesNotification(changes) {
        try {
            let message = '🔄 Изменение статуса аккаунтов:\n\n';
            for (const change of changes) {
                const icon = change.newStatus ? '✅ ВОШЕЛ' : '❌ ВЫШЕЛ';
                const emoji = change.newStatus ? '🟢' : '🔴';
                message += `${emoji} ${change.phone}\n   Статус: ${icon}\n\n`;
            }
            message += `📅 ${new Date().toLocaleString()}`;
            await this.bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID || 8946090726, message);
        } catch (error) {
            console.error('❌ Ошибка отправки уведомления:', error);
        }
    }

    async sendNotification(message) {
        try {
            await this.bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID || 8946090726, message);
        } catch (error) {
            console.error('❌ Ошибка отправки уведомления:', error);
        }
    }

    async showAccounts(ctx) {
        try {
            const userId = ctx.from.id;
            const accounts = await this.db.getAccounts(userId);
            if (accounts.length === 0) {
                await ctx.reply('📭 У вас нет аккаунтов');
                return;
            }
            const buttons = [];
            for (const acc of accounts) {
                const status = acc.is_authenticated ? '🟢' : '🔴';
                buttons.push([Markup.button.callback(`${status} ${acc.phone}`, `account_${acc.phone}`)]);
            }
            buttons.push([Markup.button.callback('🔙 Назад', 'back_main')]);
            await ctx.reply(
                '📋 *Ваши аккаунты*\n\n🟢 - авторизован\n🔴 - не авторизован\n\n👆 *Нажмите на номер для управления:*\n   📱 Авторизовать аккаунт\n   🗑️ Удалить аккаунт',
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
            const userId = ctx.from.id;
            const accounts = await this.db.getAccounts(userId);
            const progressStats = await this.service.getStats();
            const status = this.service.isRunning ? '🟢 Активен' : '🔴 Остановлен';
            const progressStatus = this.service.isComplete ? '✅ Завершен' : status;
            await ctx.reply(
                `📊 *Статистика*\n\n🟢 Статус: ${progressStatus}\n📱 Аккаунтов: ${accounts.length}\n🟢 Авторизовано: ${accounts.filter(a => a.is_authenticated).length}\n💬 Отправлено: ${stats.total_messages || 0}\n⏱️ Время: ${Math.round(progressStats.durationHours * 60) || 0} минут\n📨 Сообщений за сессию: ${progressStats.messagesSent || 0}`,
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
                message += `🟢 Прогрев запущен\n💬 Отправлено: ${stats.messagesSent}\n👥 Аккаунтов: ${stats.totalAccounts || 0}\n⏱️ Время: ${Math.round(stats.durationHours * 60)} минут`;
            } else if (this.service.isComplete) {
                message += `✅ Прогрев завершен!\n💬 Отправлено: ${stats.messagesSent}\n⏱️ Время: ${Math.round(stats.durationHours * 60)} минут\n😴 Аккаунтам нужно отдохнуть!`;
            } else {
                message += `🔴 Прогрев не запущен\n🔄 Запустить: /start_progress`;
            }
            await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ Ошибка:', error);
            await ctx.reply('❌ Ошибка получения статуса');
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
            this.userStates.set(ctx.from.id, { phone, name: name || 'WhatsApp', step: 'waiting_auth' });

            if (method === 'qr') {
                let qrSent = false;
                client.on('qr', async (qrImage) => {
                    if (qrSent) return;
                    qrSent = true;
                    try {
                        await ctx.replyWithPhoto(
                            { source: qrImage },
                            {
                                caption: `📱 QR код для ${phone}\nОтсканируйте в WhatsApp Web`,
                                parse_mode: 'Markdown',
                                ...this.getAuthKeyboard()
                            }
                        );
                    } catch (error) {}
                });
                setTimeout(async () => {
                    if (!this.userStates.has(ctx.from.id)) return;
                    if (qrSent) return;
                    const qr = await client.getQRCode();
                    if (qr) {
                        qrSent = true;
                        await ctx.replyWithPhoto(
                            { source: qr },
                            { caption: `📱 QR код для ${phone}`, ...this.getAuthKeyboard() }
                        );
                    }
                }, 3000);
                await client.start();
            }

            if (method === 'code') {
                await client.start();
                await new Promise(resolve => setTimeout(resolve, 3000));
                try {
                    const code = await client.requestPairingCode(phone);
                    await ctx.reply(
                        `🔢 Ваш 8-значный код для ${phone}:\n\n\`${code}\`\n\n📱 Введите его в WhatsApp Web`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (error) {
                    console.error('❌ Ошибка получения кода:', error);
                    await ctx.reply(`❌ Ошибка: ${error.message}`);
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
                let message = `⚠️ Сессия истекла для ${phone}!\n\n`;
                if (isBan) {
                    message += `🚫 Аккаунт забанен!\n📌 Причина: ${reason}`;
                } else {
                    message += `🔄 Бот переподключается...`;
                }
                await ctx.reply(message);
                this.clients.delete(phone);
                this.userStates.delete(ctx.from.id);
            });

            client.on('auth_failure', async (error) => {
                console.error(`❌ Ошибка ${phone}:`, error);
                await ctx.reply(`❌ Ошибка: ${error.message}`);
                this.clients.delete(phone);
                this.userStates.delete(ctx.from.id);
            });

            client.on('ready', async () => {
                console.log(`🟢 ${phone} готов`);
                await ctx.reply(`✅ Аккаунт ${phone} готов к работе!`);
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
        if (!client) return;
        const qr = await client.getQRCode();
        if (qr) {
            await ctx.replyWithPhoto({ source: qr }, { caption: '📱 QR код', ...this.getAuthKeyboard() });
        }
    }

    async start() {
        try {
            console.log('🚀 Запуск бота...');
            await this.db.connect();
            console.log('✅ База данных подключена');
            
            const accounts = await this.db.getAccounts();
            const authorized = accounts.filter(a => a.is_authenticated);
            if (authorized.length > 0) {
                for (const account of authorized) {
                    try {
                        if (!this.clients.has(account.phone)) {
                            const client = new WhatsAppClient(account.phone, 'qr');
                            this.clients.set(account.phone, client);
                            client.on('ready', async () => {
                                console.log(`🟢 ${account.phone} готов`);
                                await this.db.updateAccountStatus(account.phone, true);
                            });
                            client.on('auth_failure', async (error) => {
                                console.error(`❌ Ошибка ${account.phone}:`, error);
                                await this.db.updateAccountStatus(account.phone, false);
                            });
                            await client.start();
                            console.log(`✅ Клиент ${account.phone} запущен`);
                        }
                    } catch (error) {
                        console.error(`❌ Ошибка запуска ${account.phone}:`, error);
                    }
                }
            }
            
            setTimeout(() => this.autoCheckAccounts(), 10000);
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
            if (this.db) await this.db.disconnect();
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
