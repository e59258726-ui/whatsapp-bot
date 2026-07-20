// src/bot.js - полный исправленный метод startAuth

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

        // === QR ===
        if (method === 'qr') {
            client.on('qr', async (qrImage) => {
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
            
            await client.start();
        }

        // === КОД 8 ЦИФР ===
        if (method === 'code') {
            // Сначала запускаем клиент
            await client.start();
            
            // Ждем готовности
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Генерируем код
            try {
                console.log(`🔢 Генерация кода для ${phone}...`);
                const code = await client.requestPairingCode(phone);
                console.log(`✅ Код получен: ${code}`);
                
                await ctx.reply(
                    `🔢 *Ваш 8-значный код для ${phone}:*\n\n` +
                    `\`${code}\`\n\n` +
                    `📱 Откройте WhatsApp на телефоне\n` +
                    `1️⃣ Нажмите на три точки (⋮) в правом верхнем углу\n` +
                    `2️⃣ Выберите "WhatsApp Web"\n` +
                    `3️⃣ Введите этот код\n\n` +
                    `⏳ Код действителен в течение нескольких минут\n\n` +
                    `После ввода кода нажмите "✅ Всё готово"`,
                    {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('✅ Всё готово', 'auth_ready')],
                            [Markup.button.callback('🔄 Запросить новый код', 'auth_code')],
                            [Markup.button.callback('❌ Отмена', 'auth_cancel')]
                        ])
                    }
                );
            } catch (error) {
                console.error('❌ Ошибка получения кода:', error);
                await ctx.reply(`❌ Ошибка получения кода: ${error.message}`);
            }
        }

        // === ОБЩИЕ ОБРАБОТЧИКИ ===
        client.on('authenticated', async () => {
            console.log(`✅ ${phone} авторизован!`);
            await this.db.updateAccountStatus(phone, true);
            await ctx.reply(`✅ Аккаунт ${phone} успешно авторизован! 🎉`);
            this.userStates.delete(ctx.from.id);
        });

        client.on('auth_failure', async (error) => {
            console.error(`❌ Ошибка ${phone}:`, error);
            await ctx.reply(`❌ Ошибка авторизации: ${error.message || error}`);
        });

        client.on('disconnected', async (reason) => {
            console.log(`🔴 ${phone} отключен:`, reason);
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
