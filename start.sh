#!/bin/sh
mkdir -p /data
node /app/api/server.js &
API_PID=$!
sleep 1
if ! kill -0 "$API_PID" 2>/dev/null; then
  echo "ERROR: API server failed to start" >&2
  exit 1
fi
nginx -g 'daemon off;'
