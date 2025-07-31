const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const app = express();

// Create HTTP server
const server = http.createServer(app);

// WebSocket server with proper configuration for Heroku
const wss = new WebSocket.Server({ 
  server,
  path: '/publish', // Handle all connections under /publish path
  perMessageDeflate: false // Disable compression for streaming
});

// Temporary file paths
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// HLS output directory
const HLS_DIR = path.join(process.env.NODE_ENV === 'production' ? '/tmp/hls' : __dirname, 'hls');

if (!fs.existsSync(HLS_DIR)) {
  fs.mkdirSync(HLS_DIR, { recursive: true });
}

// Maintain active streams
const activeStreams = new Map();

wss.on('connection', (ws, req) => {
  // Extract stream key from URL path (e.g., /publish/my-stream-key)
  const pathMatch = req.url.match(/^\/([^\/]+)$/);
  if (!pathMatch) {
    console.error('Invalid stream path:', req.url);
    ws.close(1008, 'Invalid stream path');
    return;
  }

  const streamKey = pathMatch[1];
  console.log(`New connection for stream: ${streamKey}`);

  if (activeStreams.has(streamKey)) {
    console.log(`Stream ${streamKey} already active, closing new connection`);
    ws.close(1008, 'Stream already active');
    return;
  }

  // Create temporary files for the stream
  const tempFilePath = path.join(TEMP_DIR, `${streamKey}.webm`);
  const writeStream = fs.createWriteStream(tempFilePath, { flags: 'a' });

  console.log(`HLS output will be at: ${HLS_DIR}/${streamKey}.m3u8`);

  // Start FFmpeg process to convert the incoming WebM directly to HLS
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'webm',
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-c:a', 'aac',
    '-ar', '44100',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', `${HLS_DIR}/${streamKey}_%03d.ts`,
    `${HLS_DIR}/${streamKey}.m3u8`
  ]);

  console.log('FFmpeg process started');

  // Handle incoming WebSocket binary data
  ws.on('message', (data) => {
    console.log(`Received data chunk of size ${data.length} for stream ${streamKey}`);
    // Write to temp file for debugging
    try {
      writeStream.write(data);
    } catch (error) {
      console.error('Error writing to temp file:', error);
    }
    // Write to FFmpeg's stdin
    if (ffmpeg.stdin.writable) {
      try {
        ffmpeg.stdin.write(data);
      } catch (error) {
        console.error('Error writing to FFmpeg stdin:', error);
      }
    }
  });

  // Handle WebSocket closure
  ws.on('close', () => {
    console.log(`Connection closed for stream: ${streamKey}`);

    // Close the FFmpeg process
    if (ffmpeg.stdin.writable) {
      ffmpeg.stdin.end();
    }

    // Clean up
    writeStream.end();

    activeStreams.delete(streamKey);
  });

  // Handle FFmpeg process events
  ffmpeg.stdout.on('data', (data) => {
    console.log(`FFmpeg stdout: ${data}`);
  });

  ffmpeg.stderr.on('data', (data) => {
    // FFmpeg logs to stderr even when there's no error
    console.log(`FFmpeg stderr: ${data}`);
  });

  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg process exited with code ${code} for stream: ${streamKey}`);
  });

  ffmpeg.on('error', (err) => {
    console.error(`FFmpeg process error for stream ${streamKey}:`, err);
  });

  // Store active stream info
  activeStreams.set(streamKey, {
    ws,
    ffmpeg,
    writeStream,
    tempFilePath,
    hlsOutputPath: HLS_DIR,
    startTime: new Date()
  });
});

// Serve static files 
const staticDir = path.join(__dirname, 'nginx');
if (!fs.existsSync(staticDir)) {
  fs.mkdirSync(staticDir, { recursive: true });
  
  // Create a minimal index.html if it doesn't exist
  const indexPath = path.join(staticDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    const minimalHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Live Streaming</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        video { max-width: 100%; }
      </style>
    </head>
    <body>
      <h1>Live Streaming</h1>
      <div id="videoContainer">
        <video id="videoPlayer" controls autoplay></video>
      </div>
      <script>
        const urlParams = new URLSearchParams(window.location.search);
        const streamKey = urlParams.get('stream') || 'my-live-stream';
        
        const videoPlayer = document.getElementById('videoPlayer');
        const hlsUrl = '/hls/' + streamKey + '.m3u8';
        
        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(hlsUrl);
          hls.attachMedia(videoPlayer);
        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
          videoPlayer.src = hlsUrl;
        }
      </script>
      <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    </body>
    </html>
    `;
    fs.writeFileSync(indexPath, minimalHtml);
  }
}

app.use(express.static(staticDir));

app