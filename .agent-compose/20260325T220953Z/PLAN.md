# Plan: Invert Head Tilt Controls

## Problem

The head tilt controls are inverted — tilting left moves the ball right, and tilting right moves the ball left.

## Root Cause Analysis

The tilt signal flows through three files:

1. **tracker.js:59** — `rawTilt = -Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x)`
2. **main.js:276** — `const tiltAngle = detectTilt(timestamp)` (passes through unchanged)
3. **physics.js:75** — `const targetVx = tiltAngle * DIRECT_SENSITIVITY` (positive tilt → positive X velocity → ball moves right)

In commit `6f91353` ("fix(controls): fix head tracking inversion"), a negation (`-`) was added to `rawTilt` in tracker.js with the comment "Negate tilt to mirror horizontal mapping (webcam is mirrored)". This negation is incorrect — MediaPipe's face landmarks are already in a coordinate space where tilting left produces a negative angle and tilting right produces a positive angle from the user's perspective in a mirrored webcam view. The extra negation inverts the expected behavior.

## Constraint

CLAUDE.md specifies: **`js/tracker.js` — DO NOT MODIFY**. Therefore the fix must be applied downstream.

## Fix

Negate the `tiltAngle` in **main.js** before passing it to `updatePhysics()`. This is the cleanest consumer-side fix:

```js
// main.js line 280
const result = updatePhysics(dt, -tiltAngle, pitch);
```

This single-character change (`-tiltAngle` instead of `tiltAngle`) counteracts the incorrect negation in tracker.js, restoring the correct mapping: head-left → ball-left, head-right → ball-right.

## Why negate in main.js instead of physics.js

- main.js is the consumer/orchestrator — it's the appropriate place to adapt the tracker output to the game's coordinate system
- physics.js should remain agnostic to tracker implementation details (it just takes a tilt angle and applies sensitivity)
- The fix is minimal and self-documenting with a brief comment

## Files Changed

- `js/main.js` — 1 line change (negate `tiltAngle` when calling `updatePhysics`)

## Testing

- `docker build -t teeter .` must succeed
- Manual verification: tilt head left → ball moves left; tilt head right → ball moves right
