# Plan: Fix Inverted Head Tilt Controls

## Problem Analysis

The head tilt controls are inverted: tilting head left moves the ball right, and vice versa. This was caused by a previous incorrect "fix" (commits `7e20238` and `45c9040`) that added a negation to `tiltAngle` in the `updatePhysics()` call in `main.js`.

### Sign Chain Analysis

The tilt value passes through three stages before becoming lateral ball movement:

1. **tracker.js:96** — `rawTilt = -(faceX - calibrationOffset)`
   - Front-facing camera: head left → face moves to camera's right → `faceX` increases
   - Result: head left → rawTilt is **negative**

2. **main.js:387** (public) / **main.js:301** (dev) — passes tiltAngle to `updatePhysics()`
   - Currently: `-tiltAngle` (negated by prior "fix")
   - With head left (negative tilt): `-(-negative)` = **positive** to physics

3. **physics.js:98** — `targetVLateral = -tiltAngle * DIRECT_SENSITIVITY`
   - Receives positive → produces **negative** lateral velocity

4. **Track geometry** — `getRightAtDistance()` rotates tangent 90° CW in XZ plane
   - At track start (tangent ≈ +Z): track "right" = -X direction
   - Camera follows behind ball looking forward: screen right = +X
   - Therefore: track "right" (positive lateral) = **screen left**

5. **Net result with current code**: head left → negative lateral → screen right. **INVERTED.**

### The Fix

Remove the `-` sign added by the prior agents. Change `-tiltAngle` back to `tiltAngle` in the `updatePhysics()` call in both `public/js/main.js` (line 387) and `js/main.js` (line 301).

**Corrected chain**: head left → negative tilt → negative to physics → positive lateral velocity → positive lateral = track right = screen left. **CORRECT.**

## Files to Change

1. `public/js/main.js` — line 387: change `-tiltAngle` to `tiltAngle` (this is the file served in production)
2. `js/main.js` — line 301: change `-tiltAngle` to `tiltAngle` (development copy, keep in sync)

## Architecture Notes

- The app is a vanilla JS browser game ("Teeter") using Three.js and MediaPipe face tracking
- `public/` is the production directory served by Express (`server.js`)
- `js/` is a development copy (not served, not in Docker image)
- No build system — files are served as-is
- No test suite exists (`npm test` just echoes an error)

## Risk Assessment

This is a two-character change in two files (remove `-` prefix). No logic changes, no new dependencies, no structural modifications. The prior "fix" commits clearly show the sign was wrong.
