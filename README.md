# teeter

## Deployment Security

### HTTPS Requirement

The Docker container serves plain HTTP on port 8080. For any deployment
outside `localhost`, you **must** place an HTTPS-terminating reverse proxy
(e.g. Cloudflare, AWS ALB, Caddy, Traefik) in front of this port.
Without TLS, score submissions and challenge tokens are exposed to network
interception.

### Anonymous Writes

The image ships with `ALLOW_ANONYMOUS_SCORES=true` (shared leaderboard for
the anonymous browser game). Abuse-resistance layers are active by default:
challenge tokens, rate limiting (3/min/IP), cooldown (10 s/IP), duplicate
detection, CORS denial, CSP `connect-src 'self'`, body-size caps, and the
API binds to 127.0.0.1 only (nginx proxy required).

To require authenticated submissions:

```sh
docker run -e ALLOW_ANONYMOUS_SCORES=false -e SCORE_API_KEY=<secret> -p 8080:8080 <image>
```

When `SCORE_API_KEY` is set, the browser client cannot submit scores directly
(it has no way to securely hold the key). Route browser submissions through a
backend proxy that authenticates users and injects the key:

```
Browser → Your auth proxy (validates user session, adds X-API-Key) → Container :8080
```

To disable all writes (read-only leaderboard):

```sh
docker run -e ALLOW_ANONYMOUS_SCORES=false -p 8080:8080 <image>
```

In read-only mode the server starts normally — `GET /api/scores` works but
`POST /api/scores` returns 403.

### Operational Monitoring

The Node.js API emits structured log lines to stderr for abuse detection.
Configure your log aggregation (e.g. CloudWatch, Loki, Datadog) to alert
on the following patterns:

| Log pattern | Threshold | Indicates |
|---|---|---|
| `MONITOR: 429 rate-limited` | > 50/min | Automated abuse |
| `MONITOR: 429 challenge-farming` | > 10/min | Bot probing for tokens |
| `MONITOR: 413 payload-too-large` | > 10/min | Payload-stuffing attack |
| `MONITOR: 401 invalid-api-key` | > 5/min | Credential guessing |
| `MONITOR: 403 invalid-challenge` | > 20/min | Replay or token theft |
| `ABUSE_SUMMARY` with `WARN` level | Any | Threshold breach (auto-detected) |

The API also emits a periodic `ABUSE_SUMMARY` line every 60 seconds when
any abuse counter is non-zero, with `WARN` level when thresholds are
exceeded.

### Health & Crash Sentinel

The container exposes `GET /api/health` through nginx. The Docker
`HEALTHCHECK` instruction uses this endpoint combined with a crash
sentinel file to detect both transient failures and crash-loop exhaustion:

| Signal | How to check | Indicates |
|---|---|---|
| `/api/health` returns non-200 | `wget -qO- http://host:8080/api/health` | API is down or unreachable |
| `/tmp/api_crash_exhausted` exists | Container logs: `ERROR: Node API crashed` | Crash loop budget exhausted; API in recovery cooldown |
| HEALTHCHECK status `unhealthy` | `docker inspect --format='{{.State.Health.Status}}'` | Sustained API failure (3 consecutive failed checks) |

When `STRICT_STARTUP=false` (default), the container starts nginx even if
the API is slow to initialize. The game's localStorage fallback keeps the
static app playable, but the shared leaderboard is unavailable until the
API recovers. Set `STRICT_STARTUP=true` in environments where a
non-functional leaderboard should prevent the container from starting
(e.g. integration tests, staging with health-gate deployments).