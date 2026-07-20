// src/config.js
require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    PROGRESS_DURATION_HOURS: parseInt(process.env.PROGRESS_DURATION_HOURS) || 24,
    MIN_DELAY: parseInt(process.env.MIN_DELAY) || 30,
    MAX_DELAY: parseInt(process.env.MAX_DELAY) || 120,
    MESSAGES_PER_DAY: parseInt(process.env.MESSAGES_PER_DAY) || 20
};
