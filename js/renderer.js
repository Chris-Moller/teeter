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
let obstGeo, obstMat, coinGeo, coinMat;

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

  // Create shared geometry/material for obstacles and coins (reused across regenerations)
  obstGeo = new THREE.BoxGeometry(OBSTACLE_WIDTH, OBSTACLE_HEIGHT, OBSTACLE_DEPTH);
  obstMat = new THREE.MeshStandardMaterial({
    color: 0x8B2222,
    roughness: 0.5,
    metalness: 0.2,
  });
  coinGeo = new THREE.TorusGeometry(COIN_RADIUS, COIN_TUBE, 12, 24);
  coinMat = new THREE.MeshStandardMaterial({
    color: 0xFFD700,
    metalness: 0.8,
    roughness: 0.2,
    emissive: 0x554400,
    emissiveIntensity: 0.3,
  });

  // Generate initial level layout
  regenerateLevel();

  // Handle resize
  window.addEventListener('resize', onResize);

  return { scene, camera, renderer };
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

export function regenerateLevel() {
  // Remove existing meshes from scene
  obstacleMeshes.forEach((m) => scene.remove(m));
  coinMeshes.forEach((m) => scene.remove(m));

  // Clear arrays
  obstacleMeshes = [];
  obstacleData = [];
  coinMeshes = [];
  coinData = [];

  // Fresh RNG with dynamic seed
  const rng = seededRandom(Date.now());
  obstacleData = generateObstacles(rng);
  coinData = generateCoins(rng, obstacleData);

  // Create obstacle meshes
  obstacleMeshes = obstacleData.map((o) => {
    const mesh = new THREE.Mesh(obstGeo, obstMat);
    mesh.position.set(o.x, TRACK_HEIGHT / 2 + OBSTACLE_HEIGHT / 2, o.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });

  // Create coin meshes
  coinMeshes = coinData.map((c) => {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.position.set(c.x, COIN_Y, c.z);
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    return mesh;
  });

  return { obstacles: getObstacles(), coins: getCoins() };
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
