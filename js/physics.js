const GRAVITY = 9.8;
const DIRECT_SENSITIVITY = 8.0;
const RESPONSE_RATE = 6.0;
const FORWARD_SPEED = 2.0;
const PITCH_SENSITIVITY = 3.0;
const MAX_SPEED = 6.0;
const MAX_DT = 1 / 30; // Cap delta time to prevent physics explosions
const COIN_COLLECT_RADIUS = 0.8;

let ball = {};
let trackConfig = {};
let obstacles = [];
let coins = [];
let coinsCollected = [];

export function initPhysics(config) {
  trackConfig = config;
  obstacles = config.obstacles || [];
  coins = config.coins || [];
  coinsCollected = new Array(coins.length).fill(false);
  resetBall();
}

export function resetBall() {
  ball = {
    x: 0,
    y: trackConfig.trackHeight / 2 + trackConfig.ballRadius,
    z: trackConfig.ballStartZ,
    vx: 0,
    vy: 0,
    vz: FORWARD_SPEED,
    falling: false,
  };
  coinsCollected = new Array(coins.length).fill(false);
}

export function resetCoinTracking() {
  coinsCollected = new Array(coins.length).fill(false);
}

export function updatePhysics(dt, tiltAngle, pitch) {
  dt = Math.min(dt, MAX_DT);

  if (ball.falling) {
    return updateFalling(dt);
  }

  return updateOnTrack(dt, tiltAngle, pitch);
}

function updateOnTrack(dt, tiltAngle, pitch) {
  // Direct lateral velocity from head tilt with smooth interpolation
  const targetVx = tiltAngle * DIRECT_SENSITIVITY;
  ball.vx += (targetVx - ball.vx) * RESPONSE_RATE * dt;

  // Forward motion modulated by pitch (forward tilt speeds up, backward slows down)
  const pitchVal = pitch || 0;
  ball.vz = Math.max(0, Math.min(MAX_SPEED, FORWARD_SPEED * (1 + pitchVal * PITCH_SENSITIVITY)));

  // Update position
  ball.x += ball.vx * dt;
  ball.z += ball.vz * dt;

  // Coin collection check (before obstacle check)
  const collectedThisFrame = [];
  for (let i = 0; i < coins.length; i++) {
    if (coinsCollected[i]) continue;
    const dx = ball.x - coins[i].x;
    const dz = ball.z - coins[i].z;
    if (dx * dx + dz * dz < COIN_COLLECT_RADIUS * COIN_COLLECT_RADIUS) {
      coinsCollected[i] = true;
      collectedThisFrame.push(i);
    }
  }

  // Obstacle collision check (before edge boundary check)
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    if (Math.abs(ball.x - obs.x) < obs.halfWidth + trackConfig.ballRadius &&
        Math.abs(ball.z - obs.z) < obs.halfDepth + trackConfig.ballRadius) {
      ball.falling = true;
      ball.vy = 0;
      return {
        x: ball.x,
        y: ball.y,
        z: ball.z,
        vx: ball.vx,
        vz: ball.vz,
        falling: true,
        needsReset: false,
        obstacleHit: true,
        coinsCollected: collectedThisFrame,
        wrapped: false,
      };
    }
  }

  // Track boundaries — check if ball center has gone past track edge
  const halfWidth = trackConfig.trackWidth / 2;
  if (Math.abs(ball.x) > halfWidth) {
    ball.falling = true;
    ball.vy = 0;
  }

  // Track end — wrap back to start if ball reaches the end
  let wrapped = false;
  const halfLength = trackConfig.trackLength / 2;
  if (ball.z > halfLength) {
    ball.z = -halfLength + 1;
    wrapped = true;
  }

  return {
    x: ball.x,
    y: ball.y,
    z: ball.z,
    vx: ball.vx,
    vz: ball.vz,
    falling: ball.falling,
    needsReset: false,
    obstacleHit: false,
    coinsCollected: collectedThisFrame,
    wrapped,
  };
}

function updateFalling(dt) {
  ball.vy -= GRAVITY * dt;
  ball.y += ball.vy * dt;

  // Also continue lateral and forward motion slightly
  ball.x += ball.vx * dt * 0.5;
  ball.z += ball.vz * dt * 0.3;

  const needsReset = ball.y < -10;

  return {
    x: ball.x,
    y: ball.y,
    z: ball.z,
    vx: ball.vx,
    vz: ball.vz,
    falling: true,
    needsReset,
    obstacleHit: false,
    coinsCollected: [],
    wrapped: false,
  };
}

export function getBallState() {
  return { ...ball };
}
