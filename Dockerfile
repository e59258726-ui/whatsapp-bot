FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production --no-audit --no-fund

COPY . .

RUN mkdir -p sessions logs auth_info_baileys

ENV NODE_ENV=production

EXPOSE 10000

CMD ["node", "index.js"]
