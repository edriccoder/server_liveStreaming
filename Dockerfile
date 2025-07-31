FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY ./wss-server/package.json ./package.json
COPY ./wss-server/package-lock.json ./package-lock.json
COPY ./wss-server/ ./
COPY ./nginx/index.html ../nginx/index.html
RUN npm install

EXPOSE 8888

CMD ["node", "server.js"]