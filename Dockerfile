FROM node:20-alpine

# Устанавливаем git и другие зависимости
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

WORKDIR /app

COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production --no-audit --no-fund || \
    npm install --production --no-audit

COPY . .

RUN mkdir -p sessions logs auth_info_baileys

ENV NODE_ENV=production

EXPOSE 10000

CMD ["node", "index.js"]
