#!/bin/sh
mkdir -p /data
node /app/api/server.js &
nginx -g 'daemon off;'
