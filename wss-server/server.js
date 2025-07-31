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

// HLS output directory
const HLS_DIR = '/tmp/hls';

if (!fs.existsSync(HLS_DIR)) {
  fs.mkdirSync(HLS_DIR, { recursive: true });
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
  
  // Instead of trying to connect to NGINX, we'll directly generate HLS locally
  // This eliminates dependency on a separate NGINX service
  const hlsOutputPath = path.join(HLS_DIR, streamKey);
  
  if (!fs.existsSync(hlsOutputPath)) {
    fs.mkdirSync(hlsOutputPath, { recursive: true });
  }
  
  console.log(`HLS output will be at: ${hlsOutputPath}`);
  
  // Start FFmpeg process to convert the incoming WebM directly to HLS
  const ffmpeg = spawn('ffmpeg', [
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
    '-hls_segment_filename', `${hlsOutputPath}/%03d.ts`,
    `${hlsOutputPath}/playlist.m3u8`
  ]);
  
  console.log('FFmpeg process started');
  
  // Handle incoming WebSocket binary data
  ws.on('message', (data) => {
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
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        console.error('Error removing temp file:', err);
      }
    }
    
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
    hlsOutputPath,
    startTime: new Date()
  });
});

// Serve static files including HLS segments
app.use(express.static(path.join(__dirname, '../nginx')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../nginx/index.html'));
});

// API endpoint to check active streams
app.get('/api/streams', (req, res) => {
  const streams = {};
  activeStreams.forEach((value, key) => {
    streams[key] = {
      active: true,
      startTime: value.startTime
    };
  });
  res.json(streams);
});

app.use('/hls', (req, res) => {
  const streamKey = req.path.split('/')[1]?.replace('.m3u8', '');
  if (!streamKey) {
    return res.status(404).send('Stream not found');
  }
  
  // Redirect to the actual playlist file
  res.redirect(`/hls/${streamKey}/playlist.m3u8`);
});

// Serve HLS directory
app.use('/hls', express.static(HLS_DIR));

// Start server
const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
});