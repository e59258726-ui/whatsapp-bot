const { Telegraf, Markup, session } = require('telegraf');
const config = require('./config');
const Database = require('./database');
const WhatsAppClient = require('./whatsapp');

class TelegramBot {
    constructor() {
        if (!config.BOT_TOKEN) {
            console.error('❌ BOT_TOKEN не найден!');
            throw new Error('BOT_TOKEN is required');
        }

        this.bot = new Telegraf(config.BOT_TOKEN);
        this.db = new Database();
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
    }

    getMainKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('📊 Статистика', 'main_stats')],
            [Markup.button.callback('➕ Добавить аккаунт', 'main_add')],
            [Markup.button.callback('📋 Аккаунты', 'main_accounts')],
            [Markup.button.callback('👥 Пары', 'main_pairs')],
            [Markup.button.callback('🆘 Помощь', 'main_help')]
        ]);
    }

    getAuthMethodKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('📱 QR-код', 'auth_qr')],
            [Markup.button.callback('🔢 Код из WhatsApp', 'auth_code')],
            [Markup.button.callback('❌ Отмена', 'auth_cancel')]
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
                '📱 Управляй аккаунтами WhatsApp!\n' +
                '🗄️ Данные сохраняются в базе данных\n\n' +
                '📌 *Выберите действие в меню:*',
                {
                    parse_mode: 'Markdown',
                    ...this.getMainKeyboard()
                }
            );
        });

        this.bot.command('help', async (ctx) => {
            await ctx.reply(
                '🆘 *Команды:*\n\n' +
                '/start - Главное меню\n' +
                '/add_account - Добавить аккаунт\n' +
                '/stats - Статистика\n' +
                '/accounts - Список аккаунтов\n' +
                '/help - Помощь',
                { parse_mode: 'Markdown' }
            );
        });
    }

    setupHandlers() {
        this.bot.on('text', async (ctx) => {
            const userId = ctx.from.id;
            const state = this.userStates.get(userId);
            const text = ctx.message.text;

            console.log(`📝 Текст от ${userId}: "${text}"`);

            if (!state || state.step !== 'waiting_phone') return;

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
                await this.db.addAccount(normalizedPhone);
                await ctx.reply(`✅ Аккаунт ${normalizedPhone} добавлен!`);

                await ctx.reply(
                    `🔐 *Выберите метод авторизации для ${normalizedPhone}:*`,
                    {
                        parse_mode: 'Markdown',
                        ...this.getAuthMethodKeyboard()
                    }
                );

                this.userStates.set(userId, {
                    phone: normalizedPhone,
                    step: 'waiting_auth_method'
                });

            } catch (error) {
                console.error('❌ Ошибка добавления аккаунта:', error);
                await ctx.reply(`❌ Ошибка: ${error.message}`);
                this.userStates.delete(userId);
            }
        });
    }

    setupActions() {
        // Главное меню
        this.bot.action('main_stats', async (ctx) => {
            await ctx.answerCbQuery();
            await this.showStats(ctx);
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

        this.bot.action('main_help', async (ctx) => {
            await ctx.answerCbQuery();
            await ctx.reply('🆘 Помощь: /help');
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
                await ctx.reply('❌ Сессия истекла. Начните заново с /start');
                await ctx.reply('Главное меню:', this.getMainKeyboard());
                return;
            }

            await ctx.reply('📱 Запускаю авторизацию через QR-код...');
            await this.startAuth(ctx, state.phone, 'qr');
        });

        this.bot.action('auth_code', async (ctx) => {
            await ctx.answerCbQuery();
            const userId = ctx.from.id;
            const state = this.userStates.get(userId);

            if (!state || !state.phone) {
                await ctx.reply('❌ Сессия истекла. Начните заново с /start');
                await ctx.reply('Главное меню:', this.getMainKeyboard());
                return;
            }

            await ctx.reply('🔢 Запускаю авторизацию по коду...');
            await this.startAuth(ctx, state.phone, 'code');
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
    }

    async startAddAccount(ctx) {
        const userId = ctx.from.id;
        this.userStates.set(userId, { step: 'waiting_phone', phone: null });

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

    async startAuth(ctx, phone, method = 'qr') {
        try {
            console.log(`🔐 Авторизация ${phone} (метод: ${method})`);

            if (this.clients.has(phone)) {
                await this.clients.get(phone).stop();
                this.clients.delete(phone);
            }

            const client = new WhatsAppClient(phone, method);
            client.telegramCtx = ctx;

            this.clients.set(phone, client);
            this.userStates.set(ctx.from.id, { phone, step: 'waiting_auth' });

            client.on('authenticated', async () => {
                console.log(`✅ ${phone} авторизован!`);
                await this.db.updateAccountStatus(phone, true);
                await ctx.reply(`✅ Аккаунт ${phone} авторизован! 🎉`);
                this.userStates.delete(ctx.from.id);
            });

            client.on('auth_failure', async (error) => {
                console.error(`❌ Ошибка ${phone}:`, error);
                await ctx.reply(`❌ Ошибка: ${error.message || error}`);
            });

            client.on('ready', async () => {
                console.log(`🟢 ${phone} готов`);
                await ctx.reply(`✅ Аккаунт ${phone} готов к работе!`);
            });

            await client.start();

            if (method === 'code') {
                await ctx.replyWithHTML(`
⏳ <b>Ожидание кода...</b>

Код будет отправлен в течение 10-30 секунд.
Пожалуйста, подождите...

💡 Если код не пришел:
• Проверьте подключение к интернету
• Попробуйте метод <b>QR-код</b>
• Начните заново через /start
                `);
            }

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

    async showStats(ctx) {
        try {
            const accounts = await this.db.getAccounts();
            const pairs = await this.db.getPairs();
            await ctx.reply(
                `📊 *Статистика*\n\n` +
                `📱 Аккаунтов: ${accounts.length}\n` +
                `👥 Пар: ${pairs.length}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('❌ Ошибка:', error);
            await ctx.reply('❌ Ошибка получения статистики');
        }
    }

    async showAccounts(ctx) {
        try {
            const accounts = await this.db.getAccounts();
            if (accounts.length === 0) {
                await ctx.reply('📭 Нет аккаунтов');
                return;
            }

            let text = '📋 *Список аккаунтов:*\n\n';
            for (const acc of accounts) {
                const status = acc.is_authenticated ? '🟢' : '🔴';
                text += `${status} ${acc.phone}\n`;
            }
            await ctx.reply(text, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ Ошибка:', error);
            await ctx.reply('❌ Ошибка получения списка');
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
                await this.bot.stop();
                console.log('✅ Бот остановлен');
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
