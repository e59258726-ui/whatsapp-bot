// src/config.js
require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || 8946090726,
    
    // ===== ГЛОБАЛЬНЫЕ НАСТРОЙКИ ПРОГРЕВА =====
    PROGRESS_DURATION_HOURS: parseInt(process.env.PROGRESS_DURATION_HOURS) || 6,
    MIN_DELAY: parseInt(process.env.MIN_DELAY) || 30,
    MAX_DELAY: parseInt(process.env.MAX_DELAY) || 120,
    MESSAGES_PER_DAY: parseInt(process.env.MESSAGES_PER_DAY) || 20,
    CYCLE_ACTIVE_TIME: parseInt(process.env.CYCLE_ACTIVE_TIME) || 10 * 60 * 1000,
    CYCLE_REST_TIME: parseInt(process.env.CYCLE_REST_TIME) || 10 * 60 * 1000,
    
    // ===== НОВЫЕ НАСТРОЙКИ =====
    SEND_SPEED: process.env.SEND_SPEED || 'medium', // slow, medium, fast, human
};
