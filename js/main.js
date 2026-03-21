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
  getTurtle,
  hideTurtle,
} from './renderer.js';

import { initTracker, detectTilt, detectPitch, resetTilt } from './tracker.js';
import { initPhysics, updatePhysics, resetBall } from './physics.js';

const overlay = document.getElementById('overlay');
const subtitle = overlay.querySelector('.subtitle');
const scoreEl = document.getElementById('score');
const leaderboardBtn = document.getElementById('leaderboard-btn');
const gameoverOverlay = document.getElementById('gameover-overlay');
const gameoverTitle = gameoverOverlay.querySelector('.go-title');
const gameoverScore = gameoverOverlay.querySelector('.go-score');
const gameoverMessage = gameoverOverlay.querySelector('.go-message');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const nameSubmit = document.getElementById('name-submit');
const leaderboardPanel = document.getElementById('leaderboard-panel');
const leaderboardList = document.getElementById('leaderboard-list');
const leaderboardClose = document.getElementById('leaderboard-close');
const slowdownIndicator = document.getElementById('slowdown-indicator');
const runTimerEl = document.getElementById('run-timer');

const STORAGE_KEY = 'teeter_highscores';
const MAX_SCORES = 10;
const NON_QUALIFYING_DELAY = 2000;

let state = 'loading'; // loading | permission | playing | falling | finished | gameover
let lastTime = 0;
let resetTimer = null;
let score = 0;
let finalScore = 0;
let runStartTime = 0;
let runElapsed = 0;

function updateScore(value) {
  score = value;
  scoreEl.textContent = 'Score: ' + score;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  if (mins > 0) {
    return mins + ':' + String(secs).padStart(2, '0') + '.' + ms;
  }
  return secs + '.' + ms + 's';
}

function updateRunTimer() {
  if (state === 'playing' || state === 'falling') {
    runElapsed = (performance.now() - runStartTime) / 1000;
    runTimerEl.textContent = formatTime(runElapsed);
  }
}

// --- localStorage leaderboard ---

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

// --- Leaderboard panel ---

function renderLeaderboard() {
  const scores = loadScores();
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
  renderLeaderboard();
  leaderboardPanel.classList.add('visible');
}

function hideLeaderboard() {
  leaderboardPanel.classList.remove('visible');
}

// --- Finished state ---

function enterFinished() {
  state = 'finished';
  finalScore = score;

  gameoverTitle.textContent = 'COURSE COMPLETE!';
  gameoverScore.textContent = 'Score: ' + finalScore + '  |  Time: ' + formatTime(runElapsed);

  if (scoreQualifies(finalScore)) {
    gameoverMessage.textContent = 'New high score!';
    nameEntry.classList.add('visible');
    nameInput.value = '';
    nameInput.focus();
  } else {
    gameoverMessage.textContent = '';
    nameEntry.classList.remove('visible');
    resetTimer = setTimeout(() => {
      exitGameOver();
    }, NON_QUALIFYING_DELAY);
  }

  gameoverOverlay.classList.add('visible');
}

// --- Game over flow ---

function enterGameOver() {
  finalScore = score;
  state = 'gameover';

  gameoverTitle.textContent = 'GAME OVER';
  gameoverScore.textContent = 'Score: ' + finalScore;

  if (scoreQualifies(finalScore)) {
    gameoverMessage.textContent = 'New high score!';
    nameEntry.classList.add('visible');
    nameInput.value = '';
    nameInput.focus();
  } else {
    gameoverMessage.textContent = '';
    nameEntry.classList.remove('visible');
    resetTimer = setTimeout(() => {
      exitGameOver();
    }, NON_QUALIFYING_DELAY);
  }

  gameoverOverlay.classList.add('visible');
}

function submitScore() {
  let name = nameInput.value.trim();
  if (!name) name = 'Anonymous';
  addScore(name, finalScore);
  exitGameOver();
}

function exitGameOver() {
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }

  gameoverOverlay.classList.remove('visible');
  nameEntry.classList.remove('visible');
  gameoverTitle.textContent = 'GAME OVER';

  // Reset the game
  regenerateLevel();
  const config = getTrackConfig();
  config.obstacles = getObstacles();
  config.coins = getCoins();
  config.turtle = getTurtle();
  initPhysics(config);
  slowdownIndicator.classList.remove('visible');
  resetTilt();
  resetBallRotation();
  updateScore(0);

  // Reset ball to start of curve
  const startPoint = config.curve.getPointAt(0);
  updateBallPosition(
    startPoint.x,
    startPoint.y + config.trackHeight / 2 + config.ballRadius,
    startPoint.z
  );
  updateCamera(0, startPoint.x, startPoint.y + config.trackHeight / 2 + config.ballRadius, startPoint.z);

  // Reset timer
  runStartTime = performance.now();
  runElapsed = 0;
  runTimerEl.textContent = formatTime(0);

  state = 'playing';
}

// --- Event listeners ---

nameSubmit.addEventListener('click', () => {
  submitScore();
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    submitScore();
  }
});

leaderboardBtn.addEventListener('click', () => {
  showLeaderboard();
});

leaderboardClose.addEventListener('click', () => {
  hideLeaderboard();
});

leaderboardPanel.addEventListener('click', (e) => {
  if (e.target === leaderboardPanel) {
    hideLeaderboard();
  }
});

// --- Init & game loop ---

async function init() {
  try {
    initRenderer();
    const config = getTrackConfig();

    config.obstacles = getObstacles();
    config.coins = getCoins();
    config.turtle = getTurtle();
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
    runTimerEl.style.display = 'block';
    updateScore(0);
    runStartTime = performance.now();
    runElapsed = 0;
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
    const tiltAngle = detectTilt(timestamp);
    const pitch = detectPitch();

    const result = updatePhysics(dt, tiltAngle, pitch);

    updateBallPosition(result.x, result.y, result.z);
    updateBallRotation(result.vx, result.vz, dt);
    updateCamera(result.t, result.x, result.y, result.z);

    updateCoinRotation(dt);
    updateRunTimer();

    // Handle coin collection
    if (result.coinsCollected && result.coinsCollected.length > 0) {
      for (const idx of result.coinsCollected) {
        hideCoin(idx);
        updateScore(score + 1);
      }
    }

    // Handle turtle collection
    if (result.turtleCollected) {
      hideTurtle();
    }

    // Show/hide slowdown indicator
    if (result.slowdownActive) {
      slowdownIndicator.classList.add('visible');
    } else {
      slowdownIndicator.classList.remove('visible');
    }

    // Handle state transitions
    if (result.finished && state === 'playing') {
      enterFinished();
    } else if (result.falling && state === 'playing') {
      state = 'falling';
    }

    if (result.needsReset && state === 'falling') {
      enterGameOver();
    }
  }

  render();
}

init();
