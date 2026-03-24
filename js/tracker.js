const MEDIAPIPE_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.33/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.33/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

// Landmark indices for eye outer corners
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
// Landmark indices for pitch detection
const NOSE_TIP = 1;
const FOREHEAD = 10;
// Landmark indices for mouth-open detection
const UPPER_LIP = 13;
const LOWER_LIP = 14;

// EAR (Eye Aspect Ratio) landmark indices
const RIGHT_EYE_EAR = [33, 159, 158, 133, 153, 145];
const LEFT_EYE_EAR = [362, 386, 385, 263, 374, 380];

// Blink detection constants
const EAR_THRESHOLD = 0.21;
const BLINK_COOLDOWN = 500;

let faceLandmarker = null;
let videoElement = null;
let rawTilt = 0;
let smoothedTilt = 0;
let rawPitch = 0;
let smoothedPitch = 0;
let rawMouthOpen = 0;
let smoothedMouthOpen = 0;
const SMOOTHING_FACTOR = 0.7;

// Calibration offset: the face X position at neutral/center
let calibrationOffset = 0.5;
// When true, the next valid face detection will auto-calibrate the offset
let needsCalibration = true;

// Shared landmarks from detectTilt for reuse by detectBlink
let currentLandmarks = null;

// Blink detection state
let lastEAR = 1.0;
let lastBlinkTime = 0;

export async function initTracker(stream) {
  // Create hidden video element — never added to DOM
  videoElement = document.createElement('video');
  videoElement.setAttribute('autoplay', '');
  videoElement.setAttribute('playsinline', '');
  videoElement.srcObject = stream;

  await new Promise((resolve) => {
    videoElement.onloadeddata = resolve;
  });
  await videoElement.play();

  // Load MediaPipe
  const { FaceLandmarker, FilesetResolver } = await import(MEDIAPIPE_VISION_URL);

  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
  });
}

export function calibrate(timestamp) {
  if (!faceLandmarker || !videoElement || videoElement.readyState < 2) {
    needsCalibration = true;
    return;
  }

  const results = faceLandmarker.detectForVideo(videoElement, timestamp);
  if (results.faceLandmarks && results.faceLandmarks.length > 0) {
    const landmarks = results.faceLandmarks[0];
    const leftEye = landmarks[LEFT_EYE_OUTER];
    const rightEye = landmarks[RIGHT_EYE_OUTER];
    calibrationOffset = (leftEye.x + rightEye.x) / 2;
    needsCalibration = false;
  } else {
    needsCalibration = true;
  }
}

export function detectTilt(timestamp) {
  if (!faceLandmarker || !videoElement || videoElement.readyState < 2) {
    return smoothedTilt;
  }

  const results = faceLandmarker.detectForVideo(videoElement, timestamp);

  if (results.faceLandmarks && results.faceLandmarks.length > 0) {
    const landmarks = results.faceLandmarks[0];
    currentLandmarks = landmarks;
    const leftEye = landmarks[LEFT_EYE_OUTER];
    const rightEye = landmarks[RIGHT_EYE_OUTER];

    // Absolute horizontal face position (normalized 0..1)
    const faceX = (leftEye.x + rightEye.x) / 2;

    // Auto-calibrate on first valid detection after reset/start
    if (needsCalibration) {
      calibrationOffset = faceX;
      needsCalibration = false;
    }

    // Mirror and subtract calibration offset so center = 0
    rawTilt = -(faceX - calibrationOffset);
    smoothedTilt = smoothedTilt * SMOOTHING_FACTOR + rawTilt * (1 - SMOOTHING_FACTOR);

    // Compute pitch from the same detection result
    const nose = landmarks[NOSE_TIP];
    const forehead = landmarks[FOREHEAD];
    rawPitch = nose.y - forehead.y;
    smoothedPitch = smoothedPitch * SMOOTHING_FACTOR + rawPitch * (1 - SMOOTHING_FACTOR);

    // Compute mouth openness from upper and lower lip distance,
    // normalized by inter-eye distance for scale independence
    const upperLip = landmarks[UPPER_LIP];
    const lowerLip = landmarks[LOWER_LIP];
    const mouthDist = lowerLip.y - upperLip.y;
    const eyeDist = Math.abs(rightEye.x - leftEye.x);
    rawMouthOpen = eyeDist > 0.01 ? mouthDist / eyeDist : 0;
    smoothedMouthOpen = smoothedMouthOpen * SMOOTHING_FACTOR + rawMouthOpen * (1 - SMOOTHING_FACTOR);
  }

  return smoothedTilt;
}

export function detectPitch() {
  return smoothedPitch;
}

export function detectMouthOpen() {
  // Threshold for mouth openness normalized by inter-eye distance;
  // typical closed mouth ~0.01-0.03, open mouth ~0.15+
  const MOUTH_OPEN_THRESHOLD = 0.1;
  return smoothedMouthOpen > MOUTH_OPEN_THRESHOLD;
}

function landmarkDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function computeEAR(landmarks, indices) {
  const p1 = landmarks[indices[0]];
  const p2 = landmarks[indices[1]];
  const p3 = landmarks[indices[2]];
  const p4 = landmarks[indices[3]];
  const p5 = landmarks[indices[4]];
  const p6 = landmarks[indices[5]];
  return (landmarkDist(p2, p6) + landmarkDist(p3, p5)) / (2.0 * landmarkDist(p1, p4));
}

export function detectBlink() {
  if (!currentLandmarks) return false;

  const rightEAR = computeEAR(currentLandmarks, RIGHT_EYE_EAR);
  const leftEAR = computeEAR(currentLandmarks, LEFT_EYE_EAR);
  const avgEAR = (rightEAR + leftEAR) / 2.0;

  const triggered = lastEAR >= EAR_THRESHOLD && avgEAR < EAR_THRESHOLD;
  const cooldownPassed = performance.now() - lastBlinkTime >= BLINK_COOLDOWN;

  if (triggered && cooldownPassed) {
    lastBlinkTime = performance.now();
    lastEAR = avgEAR;
    return true;
  }

  lastEAR = avgEAR;
  return false;
}

export function resetTilt() {
  rawTilt = 0;
  smoothedTilt = 0;
  rawPitch = 0;
  smoothedPitch = 0;
  rawMouthOpen = 0;
  smoothedMouthOpen = 0;
  calibrationOffset = 0.5;
  needsCalibration = true;
  lastEAR = 1.0;
  lastBlinkTime = 0;
}
