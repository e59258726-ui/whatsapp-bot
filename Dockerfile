FROM node:20-alpine

# Устанавливаем зависимости и Microsoft Edge
RUN apk add --no-cache \
    curl \
    gnupg \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && curl -sSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > /etc/apk/keys/microsoft.gpg \
    && echo "https://packages.microsoft.com/alpine/edge/main" >> /etc/apk/repositories \
    && apk update \
    && apk add --no-cache microsoft-edge-stable \
    && rm -rf /var/cache/apk/*

# Chromium как запасной вариант
RUN apk add --no-cache chromium || true

WORKDIR /app

COPY package*.json ./
RUN npm install --production --no-audit --no-fund

COPY . .

RUN mkdir -p sessions logs

# Путь к Microsoft Edge
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/microsoft-edge-stable
ENV EDGE_PATH=/usr/bin/microsoft-edge-stable
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

EXPOSE 10000

CMD ["node", "index.js"]
