#!/usr/bin/env bash
# (Re)start one built checkout's Next server for screenshots, with the review clock.
#   docs/design-review/tools/review-serve.sh <checkout> <port> [gateway-url]
# Stops only the process this script started earlier on the same port (pid file).
set -euo pipefail
checkout=$(realpath "$1")
port=$2
gateway=${3:-http://127.0.0.1:18391}
tools=$(dirname "$(realpath "$0")")
state=${REVIEW_HOME:-$HOME/.cache/weblog-ui-hill-climb}
pidfile="$state/web-$port.pid"
if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
  kill "$(cat "$pidfile")"
  sleep 2
fi
cd "$checkout/web"
NODE_OPTIONS="--import $tools/fixed-clock.mjs" REVIEW_NOW=2026-11-13T02:20:00+08:00 BLOG_GATEWAY_INTERNAL_URL="$gateway" \
  setsid nohup nice -n 10 ./node_modules/.bin/next start -p "$port" -H 127.0.0.1 > "$state/web-$port.log" 2>&1 < /dev/null &
echo $! > "$pidfile"
for _ in $(seq 30); do
  curl -sf -o /dev/null "http://127.0.0.1:$port/about/" && { echo "serving $checkout on $port"; exit 0; }
  sleep 1
done
echo "server on $port did not come up" >&2
exit 1
