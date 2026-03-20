const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const HOST = '127.0.0.1';
const DATA_DIR = '/data';
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const MAX_SCORES = 10;
const MAX_BODY = 1024;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readScores() {
  try {
    if (!fs.existsSync(SCORES_FILE)) return [];
    const raw = fs.readFileSync(SCORES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(e => typeof e.name === 'string' && typeof e.score === 'number')
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
  } catch (err) {
    console.error('readScores: failed to read/parse scores file:', err.message);
    return [];
  }
}

function writeScores(scores) {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2), 'utf8');
}

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { error: message });
}

function handleGetScores(req, res) {
  const scores = readScores();
  sendJSON(res, 200, scores);
}

function handlePostScore(req, res) {
  let body = '';
  let size = 0;
  let aborted = false;

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      if (!aborted) {
        aborted = true;
        req.destroy();
        sendError(res, 413, 'Request body too large');
      }
      return;
    }
    body += chunk;
  });

  req.on('error', (err) => {
    console.error('handlePostScore: request stream error:', err.message);
    if (!aborted && !res.headersSent) {
      aborted = true;
      sendError(res, 400, 'Request error');
    }
  });

  req.on('end', () => {
    if (aborted) return;

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendError(res, 400, 'Invalid JSON');
      return;
    }

    // Validate score
    const score = parsed.score;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 999999) {
      sendError(res, 400, 'Score must be a positive integer between 1 and 999999');
      return;
    }

    // Validate name
    if (parsed.name != null && typeof parsed.name !== 'string') {
      sendError(res, 400, 'Name must be a string');
      return;
    }
    const name = (typeof parsed.name === 'string' && parsed.name.trim())
      ? parsed.name.trim().slice(0, 15)
      : 'Anonymous';

    // Add score
    const scores = readScores();
    scores.push({ name, score });
    scores.sort((a, b) => b.score - a.score);
    const top = scores.slice(0, MAX_SCORES);

    try {
      writeScores(top);
    } catch (err) {
      console.error('handlePostScore: failed to write scores:', err.message);
      sendError(res, 500, 'Failed to persist score');
      return;
    }

    sendJSON(res, 201, top);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = url.pathname;

  // CORS not needed (same origin via nginx proxy)

  if (pathname === '/api/scores') {
    if (req.method === 'GET') {
      handleGetScores(req, res);
    } else if (req.method === 'POST') {
      handlePostScore(req, res);
    } else {
      sendError(res, 405, 'Method not allowed');
    }
  } else {
    sendError(res, 404, 'Not found');
  }
});

try {
  ensureDataDir();
} catch (err) {
  console.error('FATAL: cannot create data directory:', DATA_DIR, err.message);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`API server listening on ${HOST}:${PORT}`);
});
