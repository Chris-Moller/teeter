import * as THREE from 'three';

const GRAVITY = 9.8;
const DIRECT_SENSITIVITY = 8.0;
const RESPONSE_RATE = 6.0;
const FORWARD_SPEED = 2.0;
const PITCH_SENSITIVITY = 3.0;
const MAX_SPEED = 6.0;
const MAX_DT = 1 / 30;
const COIN_COLLECT_RADIUS = 0.8;
const TURTLE_COLLECT_RADIUS = 0.8;
const SLOWDOWN_DURATION = 4;
const GRAVITY_SLOPE_FACTOR = 5.0;

let ball = {};
let trackConfig = {};
let curve = null;
let curveLength = 0;
let obstacles = [];
let coins = [];
let coinsCollected = [];
let turtle = null;
let turtleCollected = false;
let slowdownActive = false;
let slowdownTimer = 0;

export function initPhysics(config) {
  trackConfig = config;
  curve = config.curve;
  curveLength = config.curveLength;
  obstacles = config.obstacles || [];
  coins = config.coins || [];
  coinsCollected = new Array(coins.length).fill(false);
  turtle = config.turtle || null;
  turtleCollected = false;
  slowdownActive = false;
  slowdownTimer = 0;
  resetBall();
}

function updateWorldPosition() {
  const clampedT = Math.max(0, Math.min(1, ball.t));
  const point = curve.getPointAt(clampedT);
  const tangent = curve.getTangentAt(Math.min(clampedT, 0.999)).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const lateral = new THREE.Vector3().crossVectors(tangent, up).normalize();
  if (lateral.lengthSq() < 0.001) lateral.set(1, 0, 0);

  ball.worldX = point.x + lateral.x * ball.d;
  ball.worldY = point.y + trackConfig.trackHeight / 2 + trackConfig.ballRadius;
  ball.worldZ = point.z + lateral.z * ball.d;
}

export function resetBall() {
  ball = {
    t: 0,
    d: 0,
    speed: FORWARD_SPEED,
    vd: 0,
    vy: 0,
    falling: false,
    worldX: 0,
    worldY: 0,
    worldZ: 0,
  };
  if (curve) {
    updateWorldPosition();
  }
  coinsCollected = new Array(coins.length).fill(false);
  turtleCollected = false;
  slowdownActive = false;
  slowdownTimer = 0;
}

export function updatePhysics(dt, tiltAngle, pitch) {
  dt = Math.min(dt, MAX_DT);

  if (ball.falling) {
    return updateFalling(dt);
  }

  return updateOnTrack(dt, tiltAngle, pitch);
}

function updateOnTrack(dt, tiltAngle, pitch) {
  // Decrement slowdown timer
  if (slowdownActive) {
    slowdownTimer -= dt;
    if (slowdownTimer <= 0) {
      slowdownActive = false;
      slowdownTimer = 0;
    }
  }

  // Effective speeds (halved when slowed)
  const effectiveForward = slowdownActive ? FORWARD_SPEED / 2 : FORWARD_SPEED;
  const effectiveMax = slowdownActive ? MAX_SPEED / 2 : MAX_SPEED;

  // Gravity slope boost — downhill tangent.y is negative, so -tangent.y is positive (boost)
  const clampedT = Math.max(0, Math.min(ball.t, 0.999));
  const tangent = curve.getTangentAt(clampedT).normalize();
  const gravityBoost = -GRAVITY_SLOPE_FACTOR * tangent.y;

  // Forward speed: base + pitch modulation + gravity boost
  const pitchVal = pitch || 0;
  const targetSpeed = effectiveForward * (1 + pitchVal * PITCH_SENSITIVITY) + gravityBoost;
  ball.speed = Math.max(0, Math.min(effectiveMax, targetSpeed));

  // Advance along curve
  ball.t += (ball.speed * dt) / curveLength;

  // Lateral movement from head tilt (same sensitivity/smoothing)
  const targetVd = tiltAngle * DIRECT_SENSITIVITY;
  ball.vd += (targetVd - ball.vd) * RESPONSE_RATE * dt;
  ball.d += ball.vd * dt;

  // Update world position
  updateWorldPosition();

  // Edge detection — if lateral offset exceeds half track width, ball falls
  const halfWidth = trackConfig.trackWidth / 2;
  if (Math.abs(ball.d) > halfWidth) {
    ball.falling = true;
    ball.vy = 0;
  }

  // Obstacle collision in curve-local space
  let obstacleHit = false;
  if (!ball.falling) {
    const br = trackConfig.ballRadius;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      // Convert t-distance to world-distance for comparison
      const tDist = Math.abs(ball.t - o.t) * curveLength;
      const dDist = Math.abs(ball.d - o.d);
      if (tDist < (o.halfD + br) && dDist < (o.halfW + br)) {
        ball.falling = true;
        ball.vy = 0;
        obstacleHit = true;
        break;
      }
    }
  }

  // Coin collection — curve-local distance check
  const newlyCollected = [];
  for (let i = 0; i < coins.length; i++) {
    if (coinsCollected[i]) continue;
    const tDist = (ball.t - coins[i].t) * curveLength;
    const dDist = ball.d - coins[i].d;
    const dist = Math.sqrt(tDist * tDist + dDist * dDist);
    if (dist < COIN_COLLECT_RADIUS) {
      coinsCollected[i] = true;
      newlyCollected.push(i);
    }
  }

  // Turtle collection
  let turtleJustCollected = false;
  if (turtle && !turtleCollected) {
    const tDist = (ball.t - turtle.t) * curveLength;
    const dDist = ball.d - turtle.d;
    const dist = Math.sqrt(tDist * tDist + dDist * dDist);
    if (dist < TURTLE_COLLECT_RADIUS) {
      turtleCollected = true;
      turtleJustCollected = true;
      slowdownActive = true;
      slowdownTimer = SLOWDOWN_DURATION;
    }
  }

  // Finish detection — ball crosses end of curve
  let finished = false;
  if (ball.t >= 1.0) {
    finished = true;
    ball.t = 1.0;
    ball.speed = 0;
    updateWorldPosition();
  }

  return {
    x: ball.worldX,
    y: ball.worldY,
    z: ball.worldZ,
    t: ball.t,
    vx: ball.vd,
    vz: ball.speed,
    falling: ball.falling,
    finished,
    needsReset: false,
    obstacleHit,
    coinsCollected: newlyCollected,
    turtleCollected: turtleJustCollected,
    slowdownActive,
  };
}

function updateFalling(dt) {
  ball.vy -= GRAVITY * dt;
  ball.worldY += ball.vy * dt;

  // Continue lateral and forward drift slightly
  ball.worldX += ball.vd * dt * 0.5;
  ball.worldZ += ball.speed * dt * 0.3;

  const needsReset = ball.worldY < -10;

  return {
    x: ball.worldX,
    y: ball.worldY,
    z: ball.worldZ,
    t: ball.t,
    vx: ball.vd,
    vz: ball.speed,
    falling: true,
    finished: false,
    needsReset,
    obstacleHit: false,
    coinsCollected: [],
    turtleCollected: false,
    slowdownActive,
  };
}

export function getBallState() {
  return { ...ball };
}
