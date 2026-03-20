import * as THREE from 'three';

const TRACK_WIDTH = 4.5;
const TRACK_HEIGHT = 0.2;
const TRACK_LENGTH = 50;
const BALL_RADIUS = 0.3;
const BALL_START_Z = -20;

let scene, camera, renderer;
let trackMesh, ballMesh;
let edgeLeft, edgeRight;
let obstacleMeshes = [];
let obstacleData = [];
let coinMeshes = [];
let coinData = [];

// Simple seeded PRNG (mulberry32)
function seededRandom(seed) {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  // Generate obstacles and coins
  generateObstacles();
  generateCoins();

  // Handle resize
  window.addEventListener('resize', onResize);

  return { scene, camera, renderer };
}

function generateObstacles() {
  const rand = seededRandom(42);
  const obstacleMat = new THREE.MeshStandardMaterial({
    color: 0xcc2222,
    roughness: 0.5,
    metalness: 0.2,
  });
  const obstacleGeo = new THREE.BoxGeometry(1.5, 1.0, 0.4);

  const halfLength = TRACK_LENGTH / 2;
  const safeZ = BALL_START_Z + 5;
  let z = safeZ;

  while (z < halfLength) {
    z += 7 + rand() * 2; // every 7-9 Z units
    if (z >= halfLength) break;

    const lateralRange = TRACK_WIDTH / 2 - 0.75;
    const x = (rand() * 2 - 1) * lateralRange;

    const mesh = new THREE.Mesh(obstacleGeo, obstacleMat);
    mesh.position.set(x, TRACK_HEIGHT / 2 + 0.5, z);
    mesh.castShadow = true;
    scene.add(mesh);

    obstacleMeshes.push(mesh);
    obstacleData.push({ x, z, halfWidth: 0.75, halfDepth: 0.2 });
  }
}

function generateCoins() {
  const rand = seededRandom(123);
  const coinMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    metalness: 0.8,
    roughness: 0.2,
  });
  const coinGeo = new THREE.TorusGeometry(0.25, 0.08, 8, 16);

  // Place 2-3 coins between each pair of obstacles
  const sortedObs = [...obstacleData].sort((a, b) => a.z - b.z);

  // Before first obstacle
  const safeZ = BALL_START_Z + 5;
  const firstObsZ = sortedObs.length > 0 ? sortedObs[0].z : TRACK_LENGTH / 2;
  placeCoinsInRange(safeZ, firstObsZ, rand, coinGeo, coinMat);

  // Between consecutive obstacles
  for (let i = 0; i < sortedObs.length - 1; i++) {
    placeCoinsInRange(sortedObs[i].z + 1, sortedObs[i + 1].z - 1, rand, coinGeo, coinMat);
  }

  // After last obstacle
  if (sortedObs.length > 0) {
    const lastObsZ = sortedObs[sortedObs.length - 1].z;
    placeCoinsInRange(lastObsZ + 1, TRACK_LENGTH / 2, rand, coinGeo, coinMat);
  }
}

function placeCoinsInRange(zStart, zEnd, rand, geo, mat) {
  const gap = zEnd - zStart;
  if (gap < 2) return;

  const count = gap >= 5 ? 3 : 2;
  const step = gap / (count + 1);

  for (let i = 1; i <= count; i++) {
    const z = zStart + step * i;
    const lateralRange = TRACK_WIDTH / 2 - 0.5;
    const x = (rand() * 2 - 1) * lateralRange;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, TRACK_HEIGHT / 2 + 0.5, z);
    mesh.castShadow = true;
    scene.add(mesh);

    coinMeshes.push(mesh);
    coinData.push({ x, z });
  }
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
  return obstacleData;
}

export function getCoins() {
  return coinData;
}

export function hideCoin(index) {
  coinMeshes[index].visible = false;
}

export function showAllCoins() {
  for (let i = 0; i < coinMeshes.length; i++) {
    coinMeshes[i].visible = true;
  }
}

export function updateCoinRotation(dt) {
  for (let i = 0; i < coinMeshes.length; i++) {
    if (coinMeshes[i].visible) {
      coinMeshes[i].rotation.y += 2.0 * dt;
    }
  }
}
