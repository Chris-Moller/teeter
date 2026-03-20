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
  regenerateLevel,
  updateCoinRotation,
} from './renderer.js';

import { initTracker, detectTilt, detectPitch, resetTilt } from './tracker.js';
import { initPhysics, updatePhysics, resetBall, updateLevel } from './physics.js';

const overlay = document.getElementById('overlay');
const subtitle = overlay.querySelector('.subtitle');
const scoreEl = document.getElementById('score');

let state = 'loading'; // loading | permission | playing | falling
let lastTime = 0;
let resetTimer = null;
let score = 0;

function updateScore(value) {
  score = value;
  scoreEl.textContent = 'Score: ' + score;
}

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

    // Hide overlay, show score, and start game
    overlay.classList.add('hidden');
    scoreEl.style.display = 'block';
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
      if (!resetTimer) {
        resetTimer = setTimeout(() => {
          resetBall();
          resetTilt();
          resetBallRotation();
          const level = regenerateLevel();
          updateLevel(level.obstacles, level.coins);
          updateScore(0);
          const config = getTrackConfig();
          updateBallPosition(0, config.trackHeight / 2 + config.ballRadius, config.ballStartZ);
          updateCamera(config.ballStartZ);
          state = 'playing';
          resetTimer = null;
        }, 500);
      }
    }
  }

  render();
}

init();
