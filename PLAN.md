# Plan: Shared Global Leaderboard

## Overview

Replace the current localStorage-only leaderboard with a shared global leaderboard backed by a lightweight API server. All players will see and compete against the same set of high scores. The frontend retains localStorage as a fallback for offline/error scenarios.

## Codebase Analysis

- **Tech stack**: Pure static HTML+JS (ES modules), Three.js v0.183.2 via CDN importmap, served by nginx in Docker
- **State machine** (`main.js`): `loading | permission | playing | falling | gameover`
- **Current leaderboard**: localStorage-only, functions `loadScores()`, `saveScores()`, `scoreQualifies()`, `addScore()` in `main.js`
- **UI**: Game-over overlay with name entry, leaderboard panel — all already implemented
- **Docker**: `nginx:alpine` image, port 8080, static file serving only

## Architecture

### Backend: Node.js API Server (Zero Dependencies)

A small Node.js HTTP server using only built-in `http` and `fs` modules. No npm, no package.json, no node_modules. The server:

- Listens on `localhost:3001` (internal only, not exposed)
- Stores scores in `/data/scores.json` (persistent across container restarts if `/data` is a volume)
- Provides two endpoints:
  - `GET /api/scores` — Returns top 10 scores as JSON array
  - `POST /api/scores` — Accepts `{ "name": "string", "score": number }`, validates, saves, returns updated top 10

**Server-side validation:**
- `score` must be a positive integer (> 0, integer, ≤ 999999)
- `name` must be a non-empty string, trimmed, max 15 characters
- Empty/whitespace-only name defaults to "Anonymous"
- Request body must be valid JSON, max 1KB

**Why Node.js over alternatives:**
- `apk add nodejs` is ~12MB on Alpine — small footprint
- No package manager or build step needed — just a single `.js` file
- Built-in `http` and `fs` modules cover all requirements
- Easy to understand and maintain

### Nginx Proxy Configuration

Nginx reverse-proxies `/api/` requests to the Node.js backend:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

All other requests continue to serve static files as before.

### Docker Changes

**Dockerfile:**
- Base: `nginx:alpine` (unchanged)
- Add `apk add --no-cache nodejs` to install Node.js
- Copy `api/server.js` into the container
- Copy `start.sh` as the entrypoint (starts both nginx and the API server)
- Expose port 8080 (unchanged)

**start.sh:**
```sh
#!/bin/sh
mkdir -p /data
node /app/api/server.js &
nginx -g 'daemon off;'
```

### Frontend Changes (`js/main.js`)

Replace direct localStorage calls with async API calls + localStorage fallback:

1. **`loadScores()` → `loadScoresAsync()`**: Fetches `GET /api/scores`. On failure (network error, timeout, non-200), falls back to localStorage.

2. **`addScore()` → `addScoreAsync()`**: POSTs to `/api/scores`. On success, also saves to localStorage as cache. On failure, saves to localStorage only.

3. **`scoreQualifies()`**: Uses cached scores from the last `loadScoresAsync()` call or localStorage. This function remains synchronous for UI responsiveness.

4. **`renderLeaderboard()`**: Calls `loadScoresAsync()` then renders.

5. **`submitScore()`**: Calls `addScoreAsync()` then exits game over.

**Timeout**: API calls have a 2-second timeout via `AbortController` to ensure the game remains responsive.

**Flow:**
```
Score submit → POST /api/scores
               ├─ Success → Save to localStorage as cache → Exit game over
               └─ Failure → Save to localStorage only → Exit game over

Leaderboard open → GET /api/scores
                   ├─ Success → Render + cache to localStorage
                   └─ Failure → Render from localStorage
```

### Files to Create

1. **`api/server.js`** — Node.js API server (~100 lines)
2. **`start.sh`** — Docker entrypoint script

### Files to Modify

1. **`js/main.js`** — Replace sync localStorage calls with async API calls + fallback
2. **`nginx.conf`** — Add `/api/` proxy_pass block
3. **`Dockerfile`** — Add nodejs install, copy new files, change entrypoint
4. **`index.html`** — No changes needed (UI already exists)

### Files NOT Modified

- `js/renderer.js` — No changes needed
- `js/physics.js` — No changes needed
- `js/tracker.js` — No changes needed (DO NOT MODIFY)

## API Specification

### GET /api/scores

**Response:** `200 OK`
```json
[
  { "name": "Alice", "score": 42 },
  { "name": "Bob", "score": 35 }
]
```

Array of up to 10 entries, sorted by score descending.

### POST /api/scores

**Request:**
```json
{ "name": "Alice", "score": 42 }
```

**Response:** `201 Created`
```json
[
  { "name": "Alice", "score": 42 },
  { "name": "Bob", "score": 35 }
]
```

Returns updated top 10 scores.

**Error responses:**
- `400 Bad Request` — Invalid input (missing/invalid name or score)
- `413 Payload Too Large` — Request body exceeds 1KB
- `405 Method Not Allowed` — Wrong HTTP method

## Scope Assessment: Single Agent

This is a single-agent task because:
- Backend and frontend changes are tightly coupled (API contract must match)
- Docker/nginx changes must be tested together with both components
- Total scope is ~5 files, ~200 lines of new code
- No genuinely independent modules that benefit from parallel work

## Key Gotchas

1. **Async flow in game over**: `submitScore()` becomes async. Must handle the case where the POST is slow — show some indication or just fire-and-forget.
2. **CORS**: Not needed since frontend and API are on the same origin (nginx proxies both).
3. **Concurrent writes**: The JSON file could have race conditions with concurrent POSTs. Use a simple in-memory array with periodic file flush, or read-modify-write with a lock. For this scale, read-modify-write is fine.
4. **Docker entrypoint**: Must ensure Node.js process stays running. Use `&` for backgrounding and make nginx the foreground process.
5. **Score file initialization**: If `/data/scores.json` doesn't exist, start with an empty array.
6. **Frontend backward compatibility**: The `scoreQualifies()` check happens synchronously in `enterGameOver()`. We can use the most recently cached scores for this check and it will be accurate enough.

## Sources

- Node.js built-in `http` module: https://nodejs.org/api/http.html
- Node.js built-in `fs` module: https://nodejs.org/api/fs.html
- nginx proxy_pass: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
