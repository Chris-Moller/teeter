# Plan: Invert Left-Right Ball Movement

## Problem

When the user tilts their head right, the ball moves left (and vice versa). The expected behavior is that tilting right moves the ball right.

## Root Cause Analysis

The data flow for lateral movement:

1. **`js/tracker.js:59`** — Computes head tilt angle, negated for webcam mirroring:
   ```js
   rawTilt = -Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
   ```
2. **`js/main.js:93-97`** — Passes tilt directly to physics:
   ```js
   const tiltAngle = detectTilt(timestamp);
   const result = updatePhysics(dt, tiltAngle, pitch);
   ```
3. **`js/physics.js:49`** — Converts tilt to lateral velocity:
   ```js
   const targetVx = tiltAngle * DIRECT_SENSITIVITY;
   ```

The sign mapping from tilt to lateral velocity is inverted. The webcam mirror negation in the tracker may be producing the wrong sign for the current camera/scene orientation.

## Fix

In **`js/physics.js` line 49**, negate the tilt angle:

```js
// Before
const targetVx = tiltAngle * DIRECT_SENSITIVITY;

// After
const targetVx = -tiltAngle * DIRECT_SENSITIVITY;
```

This is applied in the physics layer (the movement layer) rather than in the tracker, because:
- `tracker.js` has a DO NOT MODIFY instruction in the codebase conventions
- The tracker's raw signal semantics should remain unchanged
- The inversion is a movement/control concern, not a sensing concern

## Scope

**Single agent** — one-line change in one file (`js/physics.js`).
