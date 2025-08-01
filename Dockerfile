# Use a Node.js base image that includes build tools
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Install FFmpeg, which is required for transcoding the stream
RUN apk add --no-cache ffmpeg

# Copy package.json and package-lock.json to leverage Docker cache
COPY ./wss-server/package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of the application source code
COPY ./wss-server/ ./
COPY ./nginx/index.html ./

# Expose the port the app runs on
EXPOSE 8888

# The command to run when the container starts
CMD ["node", "server.js"]