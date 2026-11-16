#!/usr/bin/env bash
# Build one checkout's web/ for design-review screenshots against the snapshot gateway.
#   docs/design-review/tools/review-build.sh <checkout> [gateway-url]
# Waits until load1 <= 10 and no other `next build` runs on this host, then
# builds at nice 19 / ionice idle with two Next workers. Never touches a
# release directory or a serving slot.
set -euo pipefail
checkout=$(realpath "$1")
gateway=${2:-http://127.0.0.1:18391}
case "$checkout" in */releases/*) echo "refusing to build inside a release directory" >&2; exit 2 ;; esac
while :; do
  load=$(cut -d' ' -f1 /proc/loadavg)
  # Count real build processes only (a waiting shell whose text mentions the command does not count).
  others=$(ps -eo comm=,args= | awk '($1=="node" || $1 ~ /^next/) && /next build|next-build|turbopack/' | wc -l)
  if awk -v l="$load" 'BEGIN{exit !(l<=10)}' && [ "${others:-0}" -eq 0 ]; then break; fi
  echo "$(date +%T) waiting: load1=$load other-builds=${others:-0}"
  sleep 30
done
echo "$(date +%T) start: load1=$(cut -d' ' -f1 /proc/loadavg)"
cd "$checkout/web"
rm -rf .next
BLOG_GATEWAY_INTERNAL_URL="$gateway" CIRCLE_NODE_TOTAL=2 RAYON_NUM_THREADS=2 UV_THREADPOOL_SIZE=2 NEXT_TELEMETRY_DISABLED=1 \
  nice -n 19 ionice -c3 ./node_modules/.bin/next build
echo "$(date +%T) done: load1=$(cut -d' ' -f1 /proc/loadavg)"
