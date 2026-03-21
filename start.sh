#!/bin/sh
mkdir -p /data
chown appuser:appuser /data
chmod 700 /data

# --- Process model: nginx + supervised Node.js API ---
# nginx serves static files and proxies /api/* to the Node.js backend.
# If the API crashes, nginx continues serving the static game (localStorage
# fallback). The crash supervisor restarts the API with bounded retries.
MAX_RETRIES="${API_MAX_RETRIES:-5}"
RETRY_WINDOW="${API_RETRY_WINDOW:-60}"
RECOVERY_PAUSE="${API_RECOVERY_PAUSE:-60}"
CRASH_SENTINEL="/tmp/api_crash_exhausted"

# Remove stale sentinel from previous runs
rm -f "$CRASH_SENTINEL"

# Start Node API in the background with bounded restarts and auto-recovery.
# The API always starts — server.js enforces its own auth policy (exits with
# FATAL if production auth is misconfigured). No silent skip path exists.
(
  failures=0
  window_start=$(date +%s)

  while true; do
    echo "INFO: Starting Node API..." >&2
    su -s /bin/sh appuser -c 'node /app/api/server.js'
    exit_code=$?
    now=$(date +%s)
    elapsed=$((now - window_start))

    if [ "$elapsed" -ge "$RETRY_WINDOW" ]; then
      failures=0
      window_start=$now
    fi

    failures=$((failures + 1))
    echo "WARN: Node API exited with status $exit_code (failure $failures/$MAX_RETRIES in ${elapsed}s window)." >&2

    if [ "$failures" -ge "$MAX_RETRIES" ]; then
      echo "ERROR: Node API crashed $MAX_RETRIES times within ${RETRY_WINDOW}s." >&2
      echo "INFO: Writing crash sentinel and entering ${RECOVERY_PAUSE}s recovery cooldown..." >&2
      echo "API_CRASHED=$(date -Iseconds) failures=$MAX_RETRIES window=${RETRY_WINDOW}s exit_code=$exit_code" > "$CRASH_SENTINEL"

      sleep "$RECOVERY_PAUSE"
      echo "INFO: Recovery cooldown elapsed. Resetting crash budget and restarting API..." >&2
      rm -f "$CRASH_SENTINEL"
      failures=0
      window_start=$(date +%s)
      continue
    fi

    sleep 2
  done
) &

# Run nginx in the foreground as PID 1's child.
nginx -g 'daemon off;'
