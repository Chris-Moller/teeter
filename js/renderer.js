import * as THREE from 'three';

const TRACK_WIDTH = 4.5;
const TRACK_HEIGHT = 0.2;
const TRACK_LENGTH = 50;
const BALL_RADIUS = 0.3;
const BALL_START_Z = -20;

// Obstacle config
const OBSTACLE_WIDTH = 1.5;
const OBSTACLE_HEIGHT = 1.0;
const OBSTACLE_DEPTH = 0.4;
const OBSTACLE_MIN_SPACING = 7;
const OBSTACLE_MAX_SPACING = 9;
const SAFE_ZONE_Z = BALL_START_Z + 5; // No obstacles/coins before Z = -15
const MIN_GAP = 1.5; // Minimum passable gap beside obstacle

// Coin config
const COIN_RADIUS = 0.25;
const COIN_TUBE = 0.08;
const COIN_Y = TRACK_HEIGHT / 2 + 0.35;

let scene, camera, renderer;
let trackMesh, ballMesh;
let edgeLeft, edgeRight;

let obstacleMeshes = [];
let obstacleData = []; // { x, z, halfW, halfD }
let coinMeshes = [];
let coinData = []; // { x, z }
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

function generateObstacles(rng) {
  const obstacles = [];
  const halfTrack = TRACK_WIDTH / 2;
  const halfLength = TRACK_LENGTH / 2;

  let z = SAFE_ZONE_Z;
  while (z < halfLength - 2) {
    const spacing = OBSTACLE_MIN_SPACING + rng() * (OBSTACLE_MAX_SPACING - OBSTACLE_MIN_SPACING);
    z += spacing;
    if (z >= halfLength - 1) break;

    // Place obstacle so there's at least MIN_GAP on one side
    const maxOffset = halfTrack - OBSTACLE_WIDTH / 2 - 0.1;
    const x = (rng() * 2 - 1) * maxOffset;

    obstacles.push({
      x,
      z,
      halfW: OBSTACLE_WIDTH / 2,
      halfD: OBSTACLE_DEPTH / 2,
    });
  }
  return obstacles;
}

function generateCoins(rng, obstacles) {
  const coins = [];
  const halfTrack = TRACK_WIDTH / 2;

  // Place 2-3 coins between each pair of obstacles
  for (let i = 0; i < obstacles.length; i++) {
    const startZ = i === 0 ? SAFE_ZONE_Z : obstacles[i - 1].z + 1;
    const endZ = obstacles[i].z - 1;
    const gap = endZ - startZ;
    if (gap < 2) continue;

    const count = gap >= 5 ? 3 : 2;
    const step = gap / (count + 1);

    for (let j = 1; j <= count; j++) {
      const cz = startZ + step * j;
      const cx = (rng() * 2 - 1) * (halfTrack - 0.5);
      coins.push({ x: cx, z: cz });
    }
  }

  // Coins after the last obstacle
  if (obstacles.length > 0) {
    const lastZ = obstacles[obstacles.length - 1].z + 1;
    const halfLength = TRACK_LENGTH / 2;
    const gap = halfLength - lastZ;
    if (gap >= 3) {
      const count = 2;
      const step = gap / (count + 1);
      for (let j = 1; j <= count; j++) {
        const cz = lastZ + step * j;
        const cx = (rng() * 2 - 1) * (halfTrack - 0.5);
        coins.push({ x: cx, z: cz });
      }
    }
  }

  return coins;
}

function createTurtleMesh() {
  const group = new THREE.Group();

  // Body
  const bodyGeo = new THREE.SphereGeometry(0.35, 16, 12);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.5, metalness: 0.2 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(1, 0.5, 1.2);
  body.castShadow = true;
  group.add(body);

  // Shell top
  const shellGeo = new THREE.SphereGeometry(0.38, 16, 12);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x145214, roughness: 0.4, metalness: 0.2 });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.scale.set(1, 0.35, 1.1);
  shell.position.y = 0.05;
  shell.castShadow = true;
  group.add(shell);

  // Head
  const headGeo = new THREE.SphereGeometry(0.12, 10, 8);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x2E8B2E, roughness: 0.5, metalness: 0.1 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, 0.05, 0.4);
  head.castShadow = true;
  group.add(head);

  // 4 Legs
  const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2E8B2E, roughness: 0.5, metalness: 0.1 });
  const legPositions = [
    { x: 0.2, z: 0.2, rotZ: -0.3 },
    { x: -0.2, z: 0.2, rotZ: 0.3 },
    { x: 0.2, z: -0.2, rotZ: -0.3 },
    { x: -0.2, z: -0.2, rotZ: 0.3 },
  ];
  for (const lp of legPositions) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(lp.x, -0.1, lp.z);
    leg.rotation.z = lp.rotZ;
    leg.castShadow = true;
    group.add(leg);
  }

  return group;
}

function generateTurtle(rng, obstacles) {
  const halfTrack = TRACK_WIDTH / 2;
  const halfLength = TRACK_LENGTH / 2;
  let z, valid;
  for (let attempts = 0; attempts < 20; attempts++) {
    z = SAFE_ZONE_Z + 5 + rng() * (halfLength - SAFE_ZONE_Z - 8);
    valid = true;
    for (const o of obstacles) {
      if (Math.abs(z - o.z) < 3) { valid = false; break; }
    }
    if (valid) break;
  }
  if (!valid) z = SAFE_ZONE_Z + 5;
  const x = (rng() * 2 - 1) * (halfTrack - 0.5);
  return { x, z };
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

function generateLevel() {
  const rng = seededRandom(Date.now());
  obstacleData = generateObstacles(rng);
  coinData = generateCoins(rng, obstacleData);

  obstacleMeshes = obstacleData.map((o) => {
    const mesh = new THREE.Mesh(obstGeo, obstMat);
    mesh.position.set(o.x, TRACK_HEIGHT / 2 + OBSTACLE_HEIGHT / 2, o.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });

  coinMeshes = coinData.map((c) => {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.position.set(c.x, COIN_Y, c.z);
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    return mesh;
  });

  turtleData = generateTurtle(rng, obstacleData);
  turtleMesh = createTurtleMesh();
  turtleMesh.position.set(turtleData.x, COIN_Y, turtleData.z);
  scene.add(turtleMesh);
}

export function regenerateLevel() {
  // Remove old obstacle meshes from scene
  for (const mesh of obstacleMeshes) {
    scene.remove(mesh);
  }
  obstacleMeshes = [];
  obstacleData = [];

  // Remove old coin meshes from scene
  for (const mesh of coinMeshes) {
    scene.remove(mesh);
  }
  coinMeshes = [];
  coinData = [];

  // Remove old turtle mesh from scene
  if (turtleMesh) {
    scene.remove(turtleMesh);
    turtleMesh = null;
    turtleData = null;
  }

  // Generate fresh layout
  generateLevel();
}

export function initRenderer() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  scene.fog = new THREE.Fog(0x87CEEB, 30, 80);

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 4, BALL_START_Z - 8);
  camera.lookAt(0, 0, BALL_START_Z);

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

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 60;
  dirLight.shadow.camera.left = -10;
  dirLight.shadow.camera.right = 10;
  dirLight.shadow.camera.top = 30;
  dirLight.shadow.camera.bottom = -30;
  scene.add(dirLight);

  // Track (fixed, never rotates)
  const trackGeo = new THREE.BoxGeometry(TRACK_WIDTH, TRACK_HEIGHT, TRACK_LENGTH);
  const trackMat = new THREE.MeshStandardMaterial({
    color: 0x8B7355,
    roughness: 0.7,
    metalness: 0.1,
  });
  trackMesh = new THREE.Mesh(trackGeo, trackMat);
  trackMesh.position.set(0, 0, 0);
  trackMesh.receiveShadow = true;
  scene.add(trackMesh);

  // Edge lines for visibility
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.6 });
  const edgeGeo = new THREE.BoxGeometry(0.06, 0.08, TRACK_LENGTH);
  edgeLeft = new THREE.Mesh(edgeGeo, edgeMat);
  edgeLeft.position.set(-TRACK_WIDTH / 2, TRACK_HEIGHT / 2 + 0.04, 0);
  scene.add(edgeLeft);

  edgeRight = new THREE.Mesh(edgeGeo, edgeMat);
  edgeRight.position.set(TRACK_WIDTH / 2, TRACK_HEIGHT / 2 + 0.04, 0);
  scene.add(edgeRight);

  // Ball
  const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xff4444,
    metalness: 0.3,
    roughness: 0.4,
  });
  ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.position.set(0, TRACK_HEIGHT / 2 + BALL_RADIUS, BALL_START_Z);
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
}

export function resetBallRotation() {
  ballMesh.rotation.set(0, 0, 0);
}

export function updateBallRotation(vx, vz, dt) {
  // Rolling rotation: x-axis for forward motion, z-axis for lateral
  ballMesh.rotation.x -= (vz / BALL_RADIUS) * dt;
  ballMesh.rotation.z += (vx / BALL_RADIUS) * dt;
}

export function updateCamera(ballZ) {
  camera.position.z = ballZ - 8;
  camera.position.y = 4;
  camera.lookAt(0, 0, ballZ);
}

export function render() {
  renderer.render(scene, camera);
}

export function getTrackConfig() {
  return {
    trackWidth: TRACK_WIDTH,
    trackHeight: TRACK_HEIGHT,
    trackLength: TRACK_LENGTH,
    ballRadius: BALL_RADIUS,
    ballStartZ: BALL_START_Z,
  };
}

export function getObstacles() {
  return obstacleData.map((o) => ({
    x: o.x,
    z: o.z,
    halfW: o.halfW,
    halfD: o.halfD,
    height: OBSTACLE_HEIGHT,
  }));
}

export function getCoins() {
  return coinData.map((c) => ({ x: c.x, z: c.z }));
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
}

export function getTurtle() {
  return turtleData ? { x: turtleData.x, z: turtleData.z } : null;
}

export function hideTurtle() {
  if (turtleMesh) {
    turtleMesh.visible = false;
  }
}
