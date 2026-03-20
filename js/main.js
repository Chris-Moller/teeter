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

const STORAGE_KEY = 'teeter_highscores';
const MAX_SCORES = 10;
const NON_QUALIFYING_DELAY = 2000;

const overlay = document.getElementById('overlay');
const subtitle = overlay.querySelector('.subtitle');
const scoreEl = document.getElementById('score');
const leaderboardBtn = document.getElementById('leaderboard-btn');
const gameoverOverlay = document.getElementById('gameover-overlay');
const gameoverScore = gameoverOverlay.querySelector('.gameover-score');
const gameoverMessage = gameoverOverlay.querySelector('.gameover-message');
const nameEntry = gameoverOverlay.querySelector('.name-entry');
const nameInput = document.getElementById('name-input');
const nameSubmit = document.getElementById('name-submit');
const leaderboardPanel = document.getElementById('leaderboard-panel');
const leaderboardContent = document.getElementById('leaderboard-content');
const leaderboardClose = document.getElementById('leaderboard-close');

let state = 'loading'; // loading | permission | playing | falling | gameover
let lastTime = 0;
let resetTimer = null;
let score = 0;
let finalScore = 0;

// --- localStorage helpers ---

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
    // Ignore storage errors (private browsing, full storage)
  }
}

function scoreQualifies(s) {
  if (s <= 0) return false;
  const scores = loadScores();
  if (scores.length < MAX_SCORES) return true;
  return s > scores[scores.length - 1].score;
}

function insertScore(name, s) {
  const scores = loadScores();
  scores.push({ name, score: s });
  scores.sort((a, b) => b.score - a.score);
  saveScores(scores.slice(0, MAX_SCORES));
}

// --- Leaderboard rendering ---

function renderLeaderboard() {
  const scores = loadScores();
  if (scores.length === 0) {
    leaderboardContent.innerHTML = '<div class="leaderboard-empty">No scores yet.</div>';
    return;
  }
  let html = '<table><thead><tr><th>#</th><th>Name</th><th>Score</th></tr></thead><tbody>';
  for (let i = 0; i < scores.length; i++) {
    html += '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(scores[i].name) + '</td><td>' + scores[i].score + '</td></tr>';
  }
  html += '</tbody></table>';
  leaderboardContent.innerHTML = html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Game-over flow ---

function enterGameOver() {
  finalScore = score;
  state = 'gameover';

  gameoverScore.textContent = 'Score: ' + finalScore;

  if (scoreQualifies(finalScore)) {
    gameoverMessage.textContent = 'New high score!';
    nameEntry.classList.add('visible');
    nameInput.value = '';
    gameoverOverlay.classList.add('visible');
    nameInput.focus();
  } else {
    gameoverMessage.textContent = '';
    nameEntry.classList.remove('visible');
    gameoverOverlay.classList.add('visible');
    resetTimer = setTimeout(exitGameOver, NON_QUALIFYING_DELAY);
  }
}

function submitScore() {
  const name = nameInput.value.trim() || 'Anonymous';
  insertScore(name, finalScore);
  exitGameOver();
}

function exitGameOver() {
  gameoverOverlay.classList.remove('visible');
  nameEntry.classList.remove('visible');
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
  resetGame();
}

function resetGame() {
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

// --- Score display ---

function updateScore(value) {
  score = value;
  scoreEl.textContent = 'Score: ' + score;
}

// --- UI event listeners ---

nameSubmit.addEventListener('click', submitScore);

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitScore();
  }
});

leaderboardBtn.addEventListener('click', () => {
  renderLeaderboard();
  leaderboardPanel.classList.add('visible');
});

leaderboardClose.addEventListener('click', () => {
  leaderboardPanel.classList.remove('visible');
});

// --- Initialization ---

async function init() {
  try {
    initRenderer();
    const config = getTrackConfig();

    config.obstacles = getObstacles();
    config.coins = getCoins();
    initPhysics(config);

    render();

    subtitle.textContent = 'Requesting camera access...';

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

    await initTracker(stream);

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

// --- Game loop ---

function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((timestamp - lastTime) / 1000, 1 / 30);
  lastTime = timestamp;

  if (state === 'playing' || state === 'falling') {
    const tiltAngle = detectTilt(timestamp);
    const pitch = detectPitch();

    const result = updatePhysics(dt, tiltAngle, pitch);

    updateBallPosition(result.x, result.y, result.z);
    updateBallRotation(result.vx, result.vz, dt);
    updateCamera(result.z);

    updateCoinRotation(dt);

    if (result.coinsCollected && result.coinsCollected.length > 0) {
      for (const idx of result.coinsCollected) {
        hideCoin(idx);
        updateScore(score + 1);
      }
    }

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
