#!/bin/sh
set -eu

if [ -z "${MCHD_PORT:-}" ]; then
  echo "MCHD_PORT is required" >&2
  exit 64
fi
if [ -z "${MCHD_PROXY_PORT:-}" ]; then
  echo "MCHD_PROXY_PORT is required" >&2
  exit 64
fi

socat "TCP-LISTEN:${MCHD_PROXY_PORT},bind=0.0.0.0,reuseaddr,fork" "TCP:127.0.0.1:${MCHD_PORT}" &

display=:99
Xvfb "$display" -screen 0 1280x1024x24 -nolisten tcp &
xvfb_pid=$!
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if [ -S "/tmp/.X11-unix/X99" ]; then
    break
  fi
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then
    echo "Xvfb failed to start" >&2
    exit 1
  fi
  sleep 1
done
if [ ! -S "/tmp/.X11-unix/X99" ]; then
  echo "Xvfb did not become ready" >&2
  exit 1
fi

export DISPLAY="$display"
exec "$@"
