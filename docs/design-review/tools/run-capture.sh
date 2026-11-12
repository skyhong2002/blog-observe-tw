#!/usr/bin/env bash
# Shoot one set detached from the calling shell (a set can take hours behind the load gate).
#   docs/design-review/tools/run-capture.sh <web-port> <out-dir> [id-filter]
# Resumes: states already in out-dir are skipped. Writes <out-dir>.log and <out-dir>.done.
set -euo pipefail
tools=$(dirname "$(realpath "$0")")
out=$2
rm -f "$out.done"
SKIP_EXISTING=1 OFFLINE=1 NODE_PATH=${NODE_PATH:-$HOME/.cache/perf-fe-before/node_modules} setsid nohup bash -c \
  "node '$tools/capture.mjs' site http://127.0.0.1:$1 http://127.0.0.1:18391 '$out' ${3:-} >> '$out.log' 2>&1; echo \$? > '$out.done'" \
  < /dev/null > /dev/null 2>&1 &
echo "capturing into $out (log $out.log)"
