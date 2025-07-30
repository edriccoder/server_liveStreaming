const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const app = express();

// Create HTTP server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Temporary file paths
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// Maintain active streams
const activeStreams = new Map();

wss.on('connection', (ws, req) => {
  // Extract stream key from URL path (e.g., /publish/my-stream-key)
  const pathMatch = req.url.match(/^\/publish\/(.+)$/);
  if (!pathMatch) {
    console.error('Invalid stream path:', req.url);
    ws.close(1008, 'Invalid stream path');
    return;
  }

  const streamKey = pathMatch[1];
  console.log(`New connection for stream: ${streamKey}`);
  
  // Create temporary files for the stream
  const tempFilePath = path.join(TEMP_DIR, `${streamKey}.webm`);
  const writeStream = fs.createWriteStream(tempFilePath, { flags: 'a' });
  
  // Start FFmpeg process to convert the incoming WebM to RTMP
  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',           // Read from stdin
    '-c:v', 'libx264',        // Video codec
    '-preset', 'veryfast',    // Encoding preset
    '-tune', 'zerolatency',   // Tune for low latency
    '-c:a', 'aac',            // Audio codec
    '-ar', '44100',           // Audio sample rate
    '-f', 'flv',              // Output format
    `rtmp://nginx:1935/hls/${streamKey}` // RTMP destination
  ]);
  
  // Handle incoming WebSocket binary data
  ws.on('message', (data) => {
    // Write to FFmpeg's stdin
    ffmpeg.stdin.write(data);
  });
  
  // Handle WebSocket closure
  ws.on('close', () => {
    console.log(`Connection closed for stream: ${streamKey}`);
    
    // Close the FFmpeg process
    ffmpeg.stdin.end();
    
    // Clean up
    writeStream.end();
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    
    activeStreams.delete(streamKey);
  });
  
  // Handle FFmpeg process events
  ffmpeg.stdout.on('data', (data) => {
    console.log(`FFmpeg stdout: ${data}`);
  });
  
  ffmpeg.stderr.on('data', (data) => {
    console.error(`FFmpeg stderr: ${data}`);
  });
  
  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg process exited with code ${code} for stream: ${streamKey}`);
  });
  
  // Store active stream info
  activeStreams.set(streamKey, {
    ws,
    ffmpeg,
    writeStream,
    tempFilePath,
    startTime: new Date()
  });
});

// Start server
const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
});