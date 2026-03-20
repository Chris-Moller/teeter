import {
  initRenderer,
  updateBallPosition,
  updateBallRotation,
  resetBallRotation,
  updateCamera,
  render,
  getTrackConfig,
  getObstacles,
  getCoins,
  hideCoin,
  showAllCoins,
  updateCoinRotation,
  regenerateLevel,
} from './renderer.js';

import { initTracker, detectTilt, detectPitch, resetTilt } from './tracker.js';
import { initPhysics, updatePhysics, resetBall } from './physics.js';

const overlay = document.getElementById('overlay');
const subtitle = overlay.querySelector('.subtitle');
const scoreEl = document.getElementById('score');
const leaderboardBtn = document.getElementById('leaderboard-btn');
const gameoverOverlay = document.getElementById('gameover-overlay');
const gameoverScore = gameoverOverlay.querySelector('.go-score');
const gameoverMessage = gameoverOverlay.querySelector('.go-message');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const nameSubmit = document.getElementById('name-submit');
const leaderboardPanel = document.getElementById('leaderboard-panel');
const leaderboardList = document.getElementById('leaderboard-list');
const leaderboardClose = document.getElementById('leaderboard-close');

const STORAGE_KEY = 'teeter_highscores';
const MAX_SCORES = 10;
const NON_QUALIFYING_DELAY = 2000;
const API_TIMEOUT = 2000;

let state = 'loading'; // loading | permission | playing | falling | gameover
let lastTime = 0;
let resetTimer = null;
let score = 0;
let finalScore = 0;

function updateScore(value) {
  score = value;
  scoreEl.textContent = 'Score: ' + score;
}

// --- localStorage leaderboard (fallback) ---

function loadScores() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => typeof e.name === 'string' && typeof e.score === 'number')
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
  } catch {
    return [];
  }
}

function saveScores(scores) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
  } catch {
    // storage unavailable — silently fail
  }
}

function scoreQualifies(value) {
  if (value <= 0) return false;
  const scores = loadScores();
  if (scores.length < MAX_SCORES) return true;
  return value > scores[scores.length - 1].score;
}

function addScore(name, value) {
  const scores = loadScores();
  scores.push({ name, score: value });
  scores.sort((a, b) => b.score - a.score);
  const trimmed = scores.slice(0, MAX_SCORES);
  saveScores(trimmed);
  return trimmed;
}

// --- API calls with localStorage fallback ---

async function apiRequest(options, fallback) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const res = await fetch('/api/scores', { ...options, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('API returned ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid response');
    saveScores(data);
    return data;
  } catch (err) {
    clearTimeout(timeout);
    console.warn('apiRequest: API call failed, falling back to localStorage:', err);
    return fallback();
  }
}

function fetchScoresFromAPI() {
  return apiRequest({}, loadScores);
}

function submitScoreToAPI(name, value) {
  return apiRequest(
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score: value }),
    },
    () => addScore(name, value),
  );
}

// --- Leaderboard panel ---

async function renderLeaderboard() {
  const scores = await fetchScoresFromAPI();
  if (scores.length === 0) {
    leaderboardList.innerHTML = '<p class="lb-empty">No scores yet.</p>';
    return;
  }
  let html = '<table><thead><tr>';
  html += '<th class="lb-rank">#</th>';
  html += '<th class="lb-name">Name</th>';
  html += '<th class="lb-score">Score</th>';
  html += '</tr></thead><tbody>';
  for (let i = 0; i < scores.length; i++) {
    const e = scores[i];
    const escapedName = e.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html += '<tr>';
    html += '<td class="lb-rank">' + (i + 1) + '</td>';
    html += '<td class="lb-name">' + escapedName + '</td>';
    html += '<td class="lb-score">' + e.score + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  leaderboardList.innerHTML = html;
}

function showLeaderboard() {
  leaderboardList.innerHTML = '<p class="lb-empty">Loading...</p>';
  leaderboardPanel.classList.add('visible');
  renderLeaderboard().catch((err) => {
    console.error('showLeaderboard: failed to render:', err);
    leaderboardList.innerHTML = '<p class="lb-empty">Failed to load scores.</p>';
  });
}

function hideLeaderboard() {
  leaderboardPanel.classList.remove('visible');
}

// --- Game over flow ---

function enterGameOver() {
  finalScore = score;
  state = 'gameover';

  gameoverScore.textContent = 'Score: ' + finalScore;

  if (scoreQualifies(finalScore)) {
    gameoverMessage.textContent = 'New high score!';
    nameEntry.classList.add('visible');
    nameInput.value = '';
    nameInput.focus();
  } else {
    gameoverMessage.textContent = '';
    nameEntry.classList.remove('visible');
    // Auto-dismiss after delay
    resetTimer = setTimeout(() => {
      exitGameOver();
    }, NON_QUALIFYING_DELAY);
  }

  gameoverOverlay.classList.add('visible');
}

async function submitScore() {
  let name = nameInput.value.trim();
  if (!name) name = 'Anonymous';
  await submitScoreToAPI(name, finalScore);
  exitGameOver();
}

function exitGameOver() {
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }

  gameoverOverlay.classList.remove('visible');
  nameEntry.classList.remove('visible');

  // Reset the game
  regenerateLevel();
  const config = getTrackConfig();
  config.obstacles = getObstacles();
  config.coins = getCoins();
  initPhysics(config);
  resetTilt();
  resetBallRotation();
  updateScore(0);
  updateBallPosition(0, config.trackHeight / 2 + config.ballRadius, config.ballStartZ);
  updateCamera(config.ballStartZ);
  state = 'playing';
}

// --- Event listeners ---

nameSubmit.addEventListener('click', () => {
  submitScore().catch((err) => {
    console.error('submitScore failed:', err);
    exitGameOver();
  });
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    submitScore().catch((err) => {
      console.error('submitScore failed:', err);
      exitGameOver();
    });
  }
});

leaderboardBtn.addEventListener('click', () => {
  showLeaderboard();
});

leaderboardClose.addEventListener('click', () => {
  hideLeaderboard();
});

// Close leaderboard on backdrop click
leaderboardPanel.addEventListener('click', (e) => {
  if (e.target === leaderboardPanel) {
    hideLeaderboard();
  }
});

// --- Init & game loop ---

async function init() {
  try {
    // Initialize Three.js renderer
    initRenderer();
    const config = getTrackConfig();

    // Attach obstacle and coin data to config for physics
    config.obstacles = getObstacles();
    config.coins = getCoins();
    initPhysics(config);

    // Initial render so the scene is visible during loading
    render();

    subtitle.textContent = 'Requesting camera access...';

    // Request camera
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
    } catch (err) {
      showError('Camera access is required to play.\nPlease allow camera access and reload.');
      return;
    }

    subtitle.textContent = 'Loading head tracking model...';

    // Initialize head tracker
    await initTracker(stream);

    // Pre-fetch scores from API to warm up the localStorage cache
    fetchScoresFromAPI().catch((err) => {
      console.warn('init: pre-fetch scores failed:', err);
    });

    // Hide overlay, show score and leaderboard button, and start game
    overlay.classList.add('hidden');
    scoreEl.style.display = 'block';
    leaderboardBtn.style.display = 'block';
    updateScore(0);
    state = 'playing';
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
  } catch (err) {
    console.error('Initialization error:', err);
    showError('Failed to initialize. Please reload and try again.');
  }
}

function showError(message) {
  state = 'error';
  overlay.classList.add('error');
  subtitle.textContent = message;
  overlay.querySelector('.title').textContent = '';
}

function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((timestamp - lastTime) / 1000, 1 / 30);
  lastTime = timestamp;

  if (state === 'playing' || state === 'falling') {
    // Get head tilt and pitch
    const tiltAngle = detectTilt(timestamp);
    const pitch = detectPitch();

    // Update physics
    const result = updatePhysics(dt, tiltAngle, pitch);

    // Update renderer
    updateBallPosition(result.x, result.y, result.z);
    updateBallRotation(result.vx, result.vz, dt);
    updateCamera(result.z);

    // Animate coins
    updateCoinRotation(dt);

    // Handle coin collection
    if (result.coinsCollected && result.coinsCollected.length > 0) {
      for (const idx of result.coinsCollected) {
        hideCoin(idx);
        updateScore(score + 1);
      }
    }

    // Handle state transitions
    if (result.falling && state === 'playing') {
      state = 'falling';
    }

    if (result.needsReset && state === 'falling') {
      enterGameOver();
    }
  }

  render();
}

init();
