# Plan: Fix Inverted Head Tilt Controls

## Problem

The head tilt controls are inverted in the production-served code (`public/js/main.js`). Tilting your head left moves the ball right, and vice versa.

## Root Cause Analysis

The tilt signal passes through a chain of transformations with negations:

1. **`tracker.js:96`** — `rawTilt = -(faceX - calibrationOffset)` — Mirrors the webcam X coordinate. MediaPipe landmarks have X increasing left-to-right in the image. Since the webcam is mirrored, the user tilting left makes `faceX` increase. This negation corrects for that: tilt left → negative `rawTilt`.

2. **`physics.js:98`** — `const targetVLateral = -tiltAngle * DIRECT_SENSITIVITY` — Another negation in the physics layer. With a negative `tiltAngle` (head left), this produces positive `targetVLateral`, which maps to positive lateral movement (right). Two negations cancel out → **inverted controls**.

3. **The fix**: A third negation in `main.js` when calling `updatePhysics(dt, -tiltAngle, ...)` restores correct behavior: three negations = net inversion, so tilt left → ball left.

The previous fix (commit `7e20238`) correctly applied this to `js/main.js:301`, but `public/js/main.js:387` — which is what the Express server actually serves in production — was never updated.

## File Structure

- `js/` — Root-level JS files, referenced by root `index.html` (used for local dev without server)
- `public/` — Files served by `server.js` via Express static middleware and by the Docker container
- Both `index.html` files reference `js/main.js` relative to their own directory

The `tracker.js` and `physics.js` files are identical between `js/` and `public/js/`. Only `main.js` differs — `public/js/main.js` has the API-based leaderboard while `js/main.js` uses localStorage.

## Fix

Change `public/js/main.js:387` from:
```js
const result = updatePhysics(dt, tiltAngle, pitch, mouthOpen);
```
to:
```js
const result = updatePhysics(dt, -tiltAngle, pitch, mouthOpen);
```

This single-character change (`-tiltAngle` instead of `tiltAngle`) adds the missing third negation in the production code path, matching what was already done in `js/main.js`.

## Files Changed

- `public/js/main.js` — 1 line change (negate `tiltAngle` in `updatePhysics` call)

## Verification

- Manual: tilt head left → ball moves left; tilt head right → ball moves right
- The `js/main.js` version already has the fix and can serve as a reference
