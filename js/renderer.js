import * as THREE from 'three';

const TRACK_WIDTH = 4.5;
const TRACK_HEIGHT = 0.2;
const BALL_RADIUS = 0.3;

// Obstacle config
const OBSTACLE_WIDTH = 1.5;
const OBSTACLE_HEIGHT = 1.0;
const OBSTACLE_DEPTH = 0.4;
const OBSTACLE_MIN_SPACING = 7;
const OBSTACLE_MAX_SPACING = 9;
const SAFE_ZONE_T = 0.06; // No obstacles/coins before ~6% of curve

// Coin config
const COIN_RADIUS = 0.25;
const COIN_TUBE = 0.08;

// Curve definition — 3 visible turns (right → left → right) with ~10 unit height drop
const CURVE_POINTS = [
  new THREE.Vector3(0, 10, 0),
  new THREE.Vector3(0, 9.5, 12),
  new THREE.Vector3(4, 8.5, 28),
  new THREE.Vector3(6, 7.5, 44),
  new THREE.Vector3(3, 6.5, 58),
  new THREE.Vector3(-4, 5.5, 72),
  new THREE.Vector3(-6, 4.5, 86),
  new THREE.Vector3(-2, 3.0, 102),
  new THREE.Vector3(3, 1.5, 118),
  new THREE.Vector3(2, 0.5, 132),
  new THREE.Vector3(0, 0, 145),
];
const trackCurve = new THREE.CatmullRomCurve3(CURVE_POINTS, false, 'centripetal', 0.5);
const CURVE_SEGMENTS = 200;
const CURVE_LENGTH = trackCurve.getLength();

let scene, camera, renderer, dirLight;
let ballMesh;

let obstacleMeshes = [];
let obstacleData = [];
let coinMeshes = [];
let coinData = [];
let turtleMesh = null;
let turtleData = null;

// Simple seeded RNG for deterministic placement
function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Build a ribbon mesh from the curve
function buildTrackMesh(curve, segments, halfWidth) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const lateral = new THREE.Vector3().crossVectors(tangent, up).normalize();
    if (lateral.lengthSq() < 0.001) {
      lateral.set(1, 0, 0);
    }

    const left = point.clone().sub(lateral.clone().multiplyScalar(halfWidth));
    const right = point.clone().add(lateral.clone().multiplyScalar(halfWidth));

    positions.push(left.x, left.y, left.z);
    positions.push(right.x, right.y, right.z);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(0, t, 1, t);

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Build edge line meshes along the track edges
function buildEdgeLines(curve, segments, halfWidth) {
  const up = new THREE.Vector3(0, 1, 0);
  const leftPoints = [];
  const rightPoints = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const lateral = new THREE.Vector3().crossVectors(tangent, up).normalize();
    if (lateral.lengthSq() < 0.001) lateral.set(1, 0, 0);

    const lp = point.clone().sub(lateral.clone().multiplyScalar(halfWidth));
    lp.y += TRACK_HEIGHT / 2 + 0.04;
    leftPoints.push(lp);

    const rp = point.clone().add(lateral.clone().multiplyScalar(halfWidth));
    rp.y += TRACK_HEIGHT / 2 + 0.04;
    rightPoints.push(rp);
  }

  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.6 });

  function makeEdgeTube(points) {
    const curvePath = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    const tubeGeo = new THREE.TubeGeometry(curvePath, segments, 0.03, 4, false);
    return new THREE.Mesh(tubeGeo, edgeMat);
  }

  return { left: makeEdgeTube(leftPoints), right: makeEdgeTube(rightPoints) };
}

// Create a checkerboard finish line at the end of the curve
function createFinishLine(curve, halfWidth) {
  const point = curve.getPointAt(1.0);
  const tangent = curve.getTangentAt(0.999).normalize();

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const squareSize = 16;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 8; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(col * squareSize, row * squareSize, squareSize, squareSize);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);

  const geo = new THREE.PlaneGeometry(halfWidth * 2, 1.5);
  const mat = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);

  mesh.position.copy(point);
  mesh.position.y += 0.02;
  mesh.lookAt(point.clone().add(tangent));
  mesh.rotateX(-Math.PI / 2);

  return mesh;
}

// Convert curve-local (t, d) to world position
function curveLocalToWorld(t, d) {
  const clampedT = Math.max(0, Math.min(1, t));
  const point = trackCurve.getPointAt(clampedT);
  const tangent = trackCurve.getTangentAt(Math.min(clampedT, 0.999)).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const lateral = new THREE.Vector3().crossVectors(tangent, up).normalize();
  if (lateral.lengthSq() < 0.001) lateral.set(1, 0, 0);

  return new THREE.Vector3(
    point.x + lateral.x * d,
    point.y,
    point.z + lateral.z * d
  );
}

function generateObstacles(rng) {
  const obstacles = [];
  const halfWidth = TRACK_WIDTH / 2;
  const spacingInT = OBSTACLE_MIN_SPACING / CURVE_LENGTH;
  const maxSpacingInT = OBSTACLE_MAX_SPACING / CURVE_LENGTH;

  let t = SAFE_ZONE_T;
  while (t < 0.95) {
    const spacing = spacingInT + rng() * (maxSpacingInT - spacingInT);
    t += spacing;
    if (t >= 0.95) break;

    const maxOffset = halfWidth - OBSTACLE_WIDTH / 2 - 0.1;
    const d = (rng() * 2 - 1) * maxOffset;

    const worldPos = curveLocalToWorld(t, d);

    obstacles.push({
      t,
      d,
      halfW: OBSTACLE_WIDTH / 2,
      halfD: OBSTACLE_DEPTH / 2,
      worldX: worldPos.x,
      worldY: worldPos.y,
      worldZ: worldPos.z,
    });
  }
  return obstacles;
}

function generateCoins(rng, obstacles) {
  const coins = [];
  const halfWidth = TRACK_WIDTH / 2;

  for (let i = 0; i < obstacles.length; i++) {
    const startT = i === 0 ? SAFE_ZONE_T : obstacles[i - 1].t + 0.01;
    const endT = obstacles[i].t - 0.01;
    const gap = endT - startT;
    if (gap < 0.015) continue;

    const count = gap >= 0.035 ? 3 : 2;
    const step = gap / (count + 1);

    for (let j = 1; j <= count; j++) {
      const ct = startT + step * j;
      const cd = (rng() * 2 - 1) * (halfWidth - 0.5);
      const worldPos = curveLocalToWorld(ct, cd);
      coins.push({ t: ct, d: cd, worldX: worldPos.x, worldY: worldPos.y, worldZ: worldPos.z });
    }
  }

  // Coins after the last obstacle
  if (obstacles.length > 0) {
    const lastT = obstacles[obstacles.length - 1].t + 0.01;
    const gap = 0.95 - lastT;
    if (gap >= 0.02) {
      const count = 2;
      const step = gap / (count + 1);
      for (let j = 1; j <= count; j++) {
        const ct = lastT + step * j;
        const cd = (rng() * 2 - 1) * (halfWidth - 0.5);
        const worldPos = curveLocalToWorld(ct, cd);
        coins.push({ t: ct, d: cd, worldX: worldPos.x, worldY: worldPos.y, worldZ: worldPos.z });
      }
    }
  }

  return coins;
}

function createTurtleMesh() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.6, metalness: 0.1 });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x185818, roughness: 0.5, metalness: 0.15 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x2EA52E, roughness: 0.5, metalness: 0.1 });

  const shellGeo = new THREE.SphereGeometry(0.4, 16, 12);
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.scale.set(1, 0.5, 1.1);
  shell.position.y = 0.1;
  group.add(shell);

  const bodyGeo = new THREE.SphereGeometry(0.35, 12, 10);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(1, 0.35, 1.05);
  body.position.y = -0.02;
  group.add(body);

  const headGeo = new THREE.SphereGeometry(0.12, 10, 8);
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, 0.05, 0.42);
  group.add(head);

  const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6);
  const legPositions = [
    { x: -0.22, z: 0.2 },
    { x: 0.22, z: 0.2 },
    { x: -0.22, z: -0.2 },
    { x: 0.22, z: -0.2 },
  ];
  for (const pos of legPositions) {
    const leg = new THREE.Mesh(legGeo, bodyMat);
    leg.position.set(pos.x, -0.1, pos.z);
    group.add(leg);
  }

  return group;
}

function generateTurtle(rng, obstacles) {
  const halfWidth = TRACK_WIDTH / 2;
  const minT = SAFE_ZONE_T + 0.05;
  const maxT = 0.90;

  if (maxT <= minT) return null;

  let attempts = 0;
  while (attempts < 20) {
    const t = minT + rng() * (maxT - minT);
    let clear = true;
    for (const o of obstacles) {
      if (Math.abs(t - o.t) < 0.015) {
        clear = false;
        break;
      }
    }
    if (clear) {
      const d = (rng() * 2 - 1) * (halfWidth - 0.5);
      const worldPos = curveLocalToWorld(t, d);
      return { t, d, worldX: worldPos.x, worldY: worldPos.y, worldZ: worldPos.z };
    }
    attempts++;
  }

  const d = (rng() * 2 - 1) * (halfWidth - 0.5);
  const worldPos = curveLocalToWorld(minT + 0.02, d);
  return { t: minT + 0.02, d, worldX: worldPos.x, worldY: worldPos.y, worldZ: worldPos.z };
}

// Shared geometry and materials for obstacles and coins
const obstGeo = new THREE.BoxGeometry(OBSTACLE_WIDTH, OBSTACLE_HEIGHT, OBSTACLE_DEPTH);
const obstMat = new THREE.MeshStandardMaterial({
  color: 0x8B2222,
  roughness: 0.5,
  metalness: 0.2,
});
const coinGeo = new THREE.TorusGeometry(COIN_RADIUS, COIN_TUBE, 12, 24);
const coinMat = new THREE.MeshStandardMaterial({
  color: 0xFFD700,
  metalness: 0.8,
  roughness: 0.2,
  emissive: 0x554400,
  emissiveIntensity: 0.3,
});

let trackMeshObj, edgeLeftObj, edgeRightObj, finishLineMesh;

function generateLevel() {
  const rng = seededRandom(Date.now());
  obstacleData = generateObstacles(rng);
  coinData = generateCoins(rng, obstacleData);

  const coinY = TRACK_HEIGHT / 2 + 0.35;

  obstacleMeshes = obstacleData.map((o) => {
    const mesh = new THREE.Mesh(obstGeo, obstMat);
    // Position in world coords, oriented along the curve tangent
    const tangent = trackCurve.getTangentAt(Math.min(o.t, 0.999)).normalize();
    mesh.position.set(o.worldX, o.worldY + TRACK_HEIGHT / 2 + OBSTACLE_HEIGHT / 2, o.worldZ);
    // Rotate obstacle to face along curve tangent
    const angle = Math.atan2(tangent.x, tangent.z);
    mesh.rotation.y = angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });

  coinMeshes = coinData.map((c) => {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.position.set(c.worldX, c.worldY + coinY, c.worldZ);
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    return mesh;
  });

  // Generate turtle powerup
  turtleData = generateTurtle(rng, obstacleData);
  if (turtleData) {
    turtleMesh = createTurtleMesh();
    turtleMesh.position.set(turtleData.worldX, turtleData.worldY + coinY, turtleData.worldZ);
    scene.add(turtleMesh);
  }
}

export function regenerateLevel() {
  for (const mesh of obstacleMeshes) {
    scene.remove(mesh);
  }
  obstacleMeshes = [];
  obstacleData = [];

  for (const mesh of coinMeshes) {
    scene.remove(mesh);
  }
  coinMeshes = [];
  coinData = [];

  if (turtleMesh) {
    scene.remove(turtleMesh);
    turtleMesh = null;
    turtleData = null;
  }

  generateLevel();
}

export function initRenderer() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  scene.fog = new THREE.Fog(0x87CEEB, 40, 120);

  // Camera
  const startPoint = trackCurve.getPointAt(0);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(startPoint.x, startPoint.y + 4, startPoint.z - 8);
  camera.lookAt(startPoint);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // Lighting
  const ambient = new THREE.AmbientLight(0x404060, 0.8);
  scene.add(ambient);

  dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 20, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 80;
  dirLight.shadow.camera.left = -15;
  dirLight.shadow.camera.right = 15;
  dirLight.shadow.camera.top = 30;
  dirLight.shadow.camera.bottom = -30;
  scene.add(dirLight);
  scene.add(dirLight.target);

  // Track — curved ribbon mesh
  const halfWidth = TRACK_WIDTH / 2;
  const trackGeo = buildTrackMesh(trackCurve, CURVE_SEGMENTS, halfWidth);
  const trackMat = new THREE.MeshStandardMaterial({
    color: 0x8B7355,
    roughness: 0.7,
    metalness: 0.1,
  });
  trackMeshObj = new THREE.Mesh(trackGeo, trackMat);
  trackMeshObj.receiveShadow = true;
  scene.add(trackMeshObj);

  // Edge lines
  const edges = buildEdgeLines(trackCurve, CURVE_SEGMENTS, halfWidth);
  edgeLeftObj = edges.left;
  edgeRightObj = edges.right;
  scene.add(edgeLeftObj);
  scene.add(edgeRightObj);

  // Finish line
  finishLineMesh = createFinishLine(trackCurve, halfWidth);
  scene.add(finishLineMesh);

  // Ball
  const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xff4444,
    metalness: 0.3,
    roughness: 0.4,
  });
  ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.position.copy(startPoint);
  ballMesh.position.y += TRACK_HEIGHT / 2 + BALL_RADIUS;
  scene.add(ballMesh);

  // Generate initial level layout
  generateLevel();

  // Handle resize
  window.addEventListener('resize', onResize);

  return { scene, camera, renderer };
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

export function updateBallPosition(x, y, z) {
  ballMesh.position.set(x, y, z);

  // Update shadow camera to follow ball
  if (dirLight) {
    dirLight.position.set(x + 5, y + 20, z + 5);
    dirLight.target.position.set(x, y, z);
    dirLight.target.updateMatrixWorld();
  }
}

export function resetBallRotation() {
  ballMesh.rotation.set(0, 0, 0);
}

export function updateBallRotation(vx, vz, dt) {
  ballMesh.rotation.x -= (vz / BALL_RADIUS) * dt;
  ballMesh.rotation.z += (vx / BALL_RADIUS) * dt;
}

export function updateCamera(ballT, bx, by, bz) {
  const clampedT = Math.max(0, Math.min(ballT, 0.999));
  const tangent = trackCurve.getTangentAt(clampedT).normalize();
  const ballPos = new THREE.Vector3(bx, by, bz);
  const targetPos = ballPos.clone()
    .sub(tangent.clone().multiplyScalar(8))
    .add(new THREE.Vector3(0, 4, 0));
  camera.position.lerp(targetPos, 0.08);
  camera.lookAt(ballPos);
}

export function render() {
  renderer.render(scene, camera);
}

export function getTrackConfig() {
  return {
    trackWidth: TRACK_WIDTH,
    trackHeight: TRACK_HEIGHT,
    ballRadius: BALL_RADIUS,
    curve: trackCurve,
    curveLength: CURVE_LENGTH,
  };
}

export function getObstacles() {
  return obstacleData.map((o) => ({
    t: o.t,
    d: o.d,
    halfW: o.halfW,
    halfD: o.halfD,
    height: OBSTACLE_HEIGHT,
  }));
}

export function getCoins() {
  return coinData.map((c) => ({ t: c.t, d: c.d }));
}

export function hideCoin(index) {
  if (coinMeshes[index]) {
    coinMeshes[index].visible = false;
  }
}

export function showAllCoins() {
  coinMeshes.forEach((m) => { m.visible = true; });
}

export function updateCoinRotation(dt) {
  coinMeshes.forEach((m) => {
    if (m.visible) {
      m.rotation.y += 2.0 * dt;
    }
  });
  if (turtleMesh && turtleMesh.visible) {
    turtleMesh.rotation.y += 1.5 * dt;
  }
}

export function getTurtle() {
  return turtleData ? { t: turtleData.t, d: turtleData.d } : null;
}

export function hideTurtle() {
  if (turtleMesh) {
    turtleMesh.visible = false;
  }
}
