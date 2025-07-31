FROM node:18-alpine

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg
RUN apk add --no-cache ffmpeg

COPY ./wss-server/package.json ./package.json
COPY ./wss-server/package-lock.json ./package-lock.json
COPY ./wss-server/ ./
RUN npm install

EXPOSE 8888

CMD ["node", "server.js"]