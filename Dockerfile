FROM node:20-alpine

# Устанавливаем зависимости для Puppeteer и Microsoft Edge
RUN apk add --no-cache \
    curl \
    gnupg \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Копируем package.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production --no-audit --no-fund

# Копируем код
COPY . .

# Создаем директории
RUN mkdir -p sessions logs

# Переменные окружения
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

EXPOSE 10000

CMD ["node", "index.js"]