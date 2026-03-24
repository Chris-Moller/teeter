# Plan: Show Ball Speed Indicator

## Overview

Add a real-time speed HUD element in the lower-left corner during active gameplay. The physics engine already returns `vx` and `vz` each frame via the `updatePhysics()` result object — we just need to compute `Math.sqrt(vx² + vz²)`, format it, and display it.

## Architecture

This is a pure UI addition. No new modules, no new dependencies, no physics changes.

### Changes Required

#### 1. `index.html` — Add `#speed` element + CSS

- Add a new `<div id="speed">0.0 m/s</div>` in the body, alongside existing HUD elements (`#score`, `#slowdown-indicator`).
- Add CSS for `#speed` that:
  - Positions it `fixed` in the lower-left corner (`bottom: 16px; left: 16px`)
  - Matches the existing `#score` element's style: same font-family, similar font-size (slightly smaller at 1.2em since it's secondary info), same `font-weight: 700`, white text, same text-shadow, same `rgba(0,0,0,0.3)` background pill, same border-radius
  - Starts hidden (`display: none`), shown via JS when gameplay starts
  - Uses `pointer-events: none` and `z-index: 10` like other HUD elements

#### 2. `js/main.js` — Compute and display speed each frame

- Grab `#speed` element reference at module top alongside other DOM refs.
- In `init()`: show `speedEl` when gameplay starts (same place where `scoreEl.style.display = 'block'`).
- In `gameLoop()`: after `updatePhysics()` returns `result`, compute `Math.sqrt(result.vx * result.vx + result.vz * result.vz)`, round to 1 decimal, update `speedEl.textContent`.
- In `enterGameOver()`: hide the speed element.
- In `exitGameOver()`: show the speed element when gameplay resumes.

## Design Decisions

- **Lower-left placement**: Keeps it away from the score (top-left) and version info (bottom-right), using the otherwise empty lower-left corner.
- **Unit label "m/s"**: The game uses abstract units, but "m/s" is universally understood and matches the task description.
- **1.2em font size**: Slightly smaller than the score (1.6em) to establish visual hierarchy — score is primary, speed is secondary feedback.
- **Same pill style as score**: Maintains visual consistency across all HUD elements.
- **No new dependencies**: Pure DOM text update, no libraries needed.

## Files Touched

| File | Change |
|------|--------|
| `index.html` | Add `#speed` div + CSS rules |
| `js/main.js` | Add speed DOM ref, compute/display speed in game loop, show/hide on state transitions |
