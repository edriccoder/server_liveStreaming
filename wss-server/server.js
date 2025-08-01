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

// Temporary file paths (unused, but keeping for potential future use)
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

  if (activeStreams.has(streamKey)) {
    console.log(`Stream ${streamKey} already active, closing new connection`);
    ws.close(1008, 'Stream already active');
    return;
  }

  // Create temporary files for the stream (unused currently)
  const tempFilePath = path.join(TEMP_DIR, `${streamKey}.webm`);
  const writeStream = fs.createWriteStream(tempFilePath, { flags: 'a' });

  console.log(`HLS output will be at: ${HLS_DIR}/${streamKey}.m3u8`);

  // Start FFmpeg process to convert the incoming WebM directly to HLS
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'webm',
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'ultrafast', // Lower latency
    '-tune', 'zerolatency',
    '-c:a', 'aac',
    '-ar', '44100',
    '-f', 'hls',
    '-hls_time', '1', // Shorter segment duration
    '-hls_list_size', '3', // Smaller playlist
    '-hls_flags', 'delete_segments+append_list+discont_start', // Add discont_start for better sync
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', `${HLS_DIR}/${streamKey}_%03d.ts`,
    '-hls_allow_cache', '0', // Disable caching
    '-hls_playlist_type', 'event', // For live/event
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
    if (fs.existsSync(tempFilePath)) {
      console.log(`Temp file created at ${tempFilePath}`);
      // Do not delete for debugging; comment out if needed
      // try {
      //   fs.unlinkSync(tempFilePath);
      // } catch (err) {
      //   console.error('Error removing temp file:', err);
      // }
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
    hlsOutputPath: HLS_DIR,
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

app.use('/hls', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Serve HLS directory
app.use('/hls', express.static(HLS_DIR));

// Debug endpoint to list HLS files for a stream
app.get('/api/debug/hls/:streamKey', (req, res) => {
  const pattern = new RegExp(`^${req.params.streamKey}`);
  fs.readdir(HLS_DIR, (err, files) => {
    if (err) return res.status(500).json(err);
    const matchingFiles = files.filter(file => pattern.test(file));
    res.json(matchingFiles);
  });
});

// Debug endpoint to download temp webm file
app.get('/api/debug/temp/:streamKey', (req, res) => {
  const file = path.join(TEMP_DIR, `${req.params.streamKey}.webm`);
  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'video/webm');
    res.sendFile(file);
  } else {
    res.status(404).send('Not found');
  }
});

// Start server
const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
});