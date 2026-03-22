# Plan: Curved Downhill Track with Finish Line

## Summary

Replace the straight flat track with a winding, downhill CatmullRom curve. Add a finish
line at the end of the course, a run timer, and curve-following camera/physics.

## Changes

### js/renderer.js
- Define `CONTROL_POINTS` for a gently curving, downhill path.
- Build a ribbon-mesh track surface along a `CatmullRomCurve3`.
- Place obstacles, coins, and turtle in curve-local (t, d) space and convert to world coordinates.
- Add a checkerboard finish line and banner at t=1.0.
- Export `curveLocalToWorld`, `getLateral`, `getTrackUp`, and `curve`/`curveLength` via `getTrackConfig()`.
- Camera follows ball along curve tangent (`updateCamera(ballT, ballWorldPos)`).

### js/physics.js
- Replace XZ ball state with curve-local `t` (progress 0-1) and `d` (lateral offset).
- Compute gravity boost from curve tangent slope (`tangent.y`).
- Collision, coin, and turtle checks use t/d distance instead of world XZ.
- Add `finished` flag when `ball.t >= 1.0`; remove wrap logic.

### js/main.js
- Add run timer display and `formatTime()` helper.
- Handle `result.finished` to show "COURSE COMPLETE!" with time.
- Pass `result.t` and ball world position to `updateCamera`.
- Import `calibrate` from tracker and call on start/restart.

### js/tracker.js
- Add `calibrate()` export to capture neutral head position.
- Use face-center X offset instead of eye-angle for tilt detection.

### index.html
- Add `#timer` element and `.go-time` element in game-over box.
- Add inline script to format version date via `data-updated` attribute.

## Verification

- `docker build -t teeter .` must succeed.
- Ball rolls along a curved, downhill path.
- Finish line is visible at the end of the course.
- Timer counts up during gameplay and is shown on completion.
- Camera follows ball smoothly along the curve.
