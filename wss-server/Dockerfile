FROM node:18-alpine

WORKDIR /app

# Install ffmpeg
RUN apk add --no-cache ffmpeg

COPY package.json package-lock.json ./
RUN npm install

COPY . .

EXPOSE 8888

CMD ["node", "server.js"]