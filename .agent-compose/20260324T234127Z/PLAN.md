# Plan: Shared Global Leaderboard — Verification Only

## Status

**All 7 acceptance criteria are already fully implemented.** The shared global leaderboard feature was built in prior iterations and all 43 integration tests pass.

## What Already Exists

### Backend (`api/server.js`)
- Node.js HTTP server (stdlib only, no npm deps) on `127.0.0.1:3001`
- `GET /api/scores` — reads top 10 from `/data/scores.json`
- `POST /api/scores` — validates input, enforces challenge tokens, rate limiting (3/min/IP), cooldown (10s/IP), duplicate detection, body-size cap
- `GET /api/challenge` — issues one-time, IP-bound, 5-minute-TTL tokens (max 5 pending/IP)
- `GET /api/health` — health check endpoint
- Atomic writes (temp file + rename), write serialization lock
- Abuse monitoring counters with periodic summary logging
- `SCORE_API_KEY` env var for optional authenticated mode
- `ALLOW_ANONYMOUS_SCORES` env var (defaults `true`)
- Read-only mode when both anonymous scores disabled and no API key

### Frontend (`js/main.js`)
- `loadScoresAsync()` — fetches `/api/scores` with 2-second timeout, falls back to localStorage
- `addScoreAsync()` — gets challenge token, POSTs score with token header, falls back to localStorage on network error (but NOT on server rejection)
- `scoreQualifies()` — checks cached/local scores to determine if name entry is shown
- `renderLeaderboard()` — renders global leaderboard table with XSS-safe HTML escaping
- Name entry flow preserved (maxlength=15, Enter key support, "Anonymous" default)

### Infrastructure
- `nginx.conf` — proxies `/api/` to `127.0.0.1:3001`, serves static files, security headers (CSP, X-Content-Type-Options, X-Frame-Options)
- `Dockerfile` — nginx:1.27.5-alpine3.21 + Node.js 22.15.1, non-root appuser, persistent `/data` volume, HEALTHCHECK
- `start.sh` — API crash supervisor with bounded retries (5/60s), recovery cooldown, startup smoke test, optional STRICT_STARTUP mode

### Tests (`api/server.test.js`)
- 43 integration tests covering: CRUD, validation, rate limiting, challenge tokens, cooldown, duplicate detection, oversized payloads, crash recovery, auth modes, read-only mode, e2e smoke tests

## Acceptance Criteria Mapping

| # | Criterion | Implementation | Verified |
|---|-----------|----------------|----------|
| 1 | Scores persisted to shared backend | `POST /api/scores` → `/data/scores.json` | Yes (43 tests pass) |
| 2 | Leaderboard displays global scores | `loadScoresAsync()` → `/api/scores` → `renderLeaderboard()` | Yes |
| 3 | Players enter name when submitting | `#name-entry` form → `submitScore()` → `addScoreAsync(name, score)` | Yes |
| 4 | Graceful localStorage fallback | `catch` blocks in `loadScoresAsync/addScoreAsync` fall back to localStorage | Yes |
| 5 | Loads within ~2 seconds | `fetchWithTimeout` with `API_TIMEOUT = 2000` | Yes |
| 6 | Server-side validation | Positive integer 1–999999, non-empty name ≤15 chars, challenge tokens | Yes |
| 7 | Docker/nginx updated | `/api/` proxy, Dockerfile with Node.js, start.sh supervisor | Yes |

## Task

Since all criteria are met and tests pass, the only work is a verification pass to confirm no regressions. This is a `quality: "skip"` task — no code changes expected.
