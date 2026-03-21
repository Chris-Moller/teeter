#!/bin/sh
mkdir -p /data

# Start Node API with exponential backoff on repeated crashes.
# Resets the failure counter after 60 s of healthy uptime.
(
  MAX_FAILURES=5
  failures=0
  while true; do
    start_ts=$(date +%s)
    node /app/api/server.js
    exit_code=$?
    elapsed=$(( $(date +%s) - start_ts ))

    # If the process ran for >60 s, treat it as a healthy run and reset
    if [ "$elapsed" -ge 60 ]; then
      failures=0
    else
      failures=$((failures + 1))
    fi

    if [ "$failures" -ge "$MAX_FAILURES" ]; then
      echo "Node API crashed $MAX_FAILURES times in rapid succession (last exit=$exit_code); giving up." >&2
      break
    fi

    delay=$(( 2 ** failures ))
    echo "Node API exited with status $exit_code (failure $failures/$MAX_FAILURES), restarting in ${delay}s..." >&2
    sleep "$delay"
  done
) &

nginx -g 'daemon off;'
