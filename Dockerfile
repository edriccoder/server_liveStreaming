FROM node:18-alpine

WORKDIR /app

# Install ffmpeg
RUN apk add --no-cache ffmpeg

COPY ./wss-server/package.json ../wss-server/package-lock.json ./
COPY ./wss-server ./
RUN npm install

COPY . .

EXPOSE 8888

CMD ["node", "server.js"]