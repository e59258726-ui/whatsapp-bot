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
        this.clients = new Map();
        this.userStates = new Map();
        this.isRunning = false;

        this.bot.use(session());

        this.setupCommands();
        this.setupHandlers();
        this.setupActions();
        this.setupErrorHandler();

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
            [Markup.button.callback('👥 Пары', 'main_pairs')],
            [Markup.button.callback('⚙️ Настройки', 'main_settings')],
            [Markup.button.callback('🆘 Помощь', 'main_help')]
        ]);
    }

    getAuthMethodKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('📱 QR-код', 'auth_qr')],
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

        this.bot.command('pairs', async (ctx) => {
            console.log(`👥 /pairs от ${ctx.from.id}`);
            await this.showPairs(ctx);
        });

        this.bot.command('help', async (ctx) => {
            console.log(`🆘 /help от ${ctx.from.id}`);
            await this.showHelp(ctx);
        });
    }

    async startAddAccount(ctx) {
        this.userStates.set(ctx.from.id, { step: 'waiting_phone', phone: null });
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
            '/pairs - Список пар\n' +
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

        this.bot.action('main_pairs', async (ctx) => {
            await ctx.answerCbQuery();
            await this.showPairs(ctx);
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

        // Авторизация
        this.bot.action('auth_qr', async (ctx) => {
            await ctx.answerCbQuery();
            const userId = ctx.from.id;
            const state = this.userStates.get(userId);
            if (!state || !state.phone) {
                await ctx.reply('❌ Сессия истекла');
                return;
            }
            await ctx.reply('📱 Запускаю авторизацию через QR-код...');
            await this.startAuth(ctx, state.phone);
            this.userStates.delete(userId);
        });

        this.bot.action('auth_ready', async (ctx) => {
            await ctx.answerCbQuery();
            const userId = ctx.from.id;
            const state = this.userStates.get(userId);
            if (!state) {
                await ctx.reply('❌ Сессия истекла');
                return;
            }
            const client = this.clients.get(state.phone);
            if (!client) {
                await ctx.reply('❌ Клиент не найден');
                return;
            }
            if (await client.getAuthStatus()) {
                await this.db.updateAccountStatus(state.phone, true);
                await ctx.reply(`✅ Аккаунт ${state.phone} авторизован! 🎉`);
                this.userStates.delete(userId);
            } else {
                await ctx.reply('⏳ Авторизация не подтверждена');
            }
        });

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

        // Удаление аккаунта
        this.bot.action(/delete_(.+)/, async (ctx) => {
            const phone = ctx.match[1];
            await ctx.answerCbQuery('🗑️ Удаление...');
            try {
                const client = await this.db.pool.connect();
                await client.query('DELETE FROM accounts WHERE phone = $1', [phone]);
                client.release();
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

        // Настройки
        this.bot.action(/set_(\d+)/, async (ctx) => {
            const hours = parseInt(ctx.match[1]);
            await ctx.answerCbQuery(`✅ ${hours} часов`);
            config.PROGRESS_DURATION_HOURS = hours;
            await ctx.reply(`✅ Установлено время прогрева: ${hours} часов`);
        });

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
            const accounts = await this.db.getAccounts();
            const pairs = await this.db.getPairs();
            const status = this.service.isRunning ? '🟢 Активен' : '🔴 Остановлен';
            await ctx.reply(
                `📊 *Статистика*\n\n` +
                `🟢 Статус: ${status}\n` +
                `📱 Аккаунтов: ${accounts.length}\n` +
                `👥 Пар: ${pairs.length}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('❌ Ошибка:', error);
            await ctx.reply('❌ Ошибка получения статистики');
        }
    }

    async showPairs(ctx) {
        try {
            const pairs = await this.db.getPairs();
            if (pairs.length === 0) {
                await ctx.reply('👥 Нет пар');
                return;
            }
            let text = '👥 *Пары:*\n\n';
            for (const pair of pairs) {
                text += `💑 ${pair.phone1} ↔ ${pair.phone2}\n`;
            }
            await ctx.reply(text, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ Ошибка:', error);
            await ctx.reply('❌ Ошибка получения пар');
        }
    }

    async startAuth(ctx, phone) {
        try {
            console.log(`🔐 Авторизация ${phone}`);
            
            if (this.clients.has(phone)) {
                await this.clients.get(phone).stop();
                this.clients.delete(phone);
            }
            
            const client = new WhatsAppClient(phone, 'qr');
            this.clients.set(phone, client);
            this.userStates.set(ctx.from.id, { phone, step: 'waiting_auth' });

            client.on('qr', async (qrImage) => {
                try {
                    await ctx.replyWithPhoto(
                        { source: qrImage },
                        {
                            caption: `📱 *QR код для ${phone}*\nОтсканируйте в WhatsApp Web`,
                            parse_mode: 'Markdown',
                            ...this.getAuthKeyboard()
                        }
                    );
                } catch (error) {
                    console.error('❌ Ошибка отправки QR:', error);
                }
            });

            client.on('authenticated', async () => {
                console.log(`✅ ${phone} авторизован!`);
                await this.db.updateAccountStatus(phone, true);
                await ctx.reply(`✅ Аккаунт ${phone} авторизован! 🎉`);
                this.userStates.delete(ctx.from.id);
            });

            client.on('ready', () => {
                console.log(`🟢 ${phone} готов к работе`);
            });

            client.on('auth_failure', async (error) => {
                console.error(`❌ Ошибка ${phone}:`, error);
                await ctx.reply(`❌ Ошибка: ${error}`);
            });

            await client.start();

            setTimeout(async () => {
                if (!this.userStates.has(ctx.from.id)) return;
                const qr = await client.getQRCode();
                if (qr) {
                    await ctx.replyWithPhoto(
                        { source: qr },
                        {
                            caption: `📱 QR код для ${phone}`,
                            ...this.getAuthKeyboard()
                        }
                    );
                }
            }, 5000);

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
            await ctx.replyWithPhoto({ source: qr }, { caption: '📱 QR код', ...this.getAuthKeyboard() });
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
