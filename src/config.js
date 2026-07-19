require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    PORT: process.env.PORT || 10000,
    PROGRESS_DURATION_HOURS: 24,
    NODE_ENV: process.env.NODE_ENV || 'development',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    SESSION_DIR: './sessions',
    LOG_DIR: './logs'
};
