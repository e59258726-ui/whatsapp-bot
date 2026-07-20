FROM node:20-alpine

# Устанавливаем Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    git \
    && rm -rf /var/cache/apk/*

WORKDIR /app

COPY package*.json ./

# Используем npm install вместо npm ci (не требует package-lock.json)
RUN npm install --production --no-audit --no-fund

COPY . .

RUN mkdir -p sessions logs

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_OPTIONS="--max-old-space-size=256"

EXPOSE 10000

CMD ["node", "index.js"]
