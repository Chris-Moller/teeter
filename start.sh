#!/bin/sh
mkdir -p /data

# Start Node API with automatic restart on crash
(
  while true; do
    node /app/api/server.js
    echo "Node API exited with status $?, restarting in 2s..." >&2
    sleep 2
  done
) &

nginx -g 'daemon off;'
