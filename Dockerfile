FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --production --no-audit --no-fund

COPY . .

EXPOSE 3000

CMD ["node", "bot.js"]
