FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY ./package.json ./package.json
COPY ./package-lock.json ./package-lock.json
COPY ./ ./
RUN mkdir -p /app/temp

# Create nginx directory if it doesn't exist
RUN mkdir -p /app/nginx
COPY ./nginx/index.html /app/nginx/index.html
# Create a minimal index.html if it does not exist
RUN if [ ! -f /app/nginx/index.html ]; then \
    echo "<html><head><title>Live Streaming</title></head><body><h1>Live Streaming Server</h1></body></html>" > /app/nginx/index.html; \
    fi

RUN npm install

EXPOSE $PORT

CMD ["node", "server.js"]