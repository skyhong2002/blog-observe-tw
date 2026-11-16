#!/usr/bin/env bash
# Shoot one set detached from the calling shell (a set can take hours behind the load gate).
#   docs/design-review/tools/run-capture.sh <web-port> <out-dir> [id-filter]
# Resumes: states already in out-dir are skipped. Writes <out-dir>.log and <out-dir>.done.
# NODE_PATH: a node_modules with playwright (default $REVIEW_HOME/pw/node_modules, see
# states.md). Before every shot capture.mjs waits for load1 <= REVIEW_LOAD_MAX and for
# no other screenshot browser on the host.
set -euo pipefail
tools=$(dirname "$(realpath "$0")")
home=${REVIEW_HOME:-$HOME/.cache/weblog-ui-hill-climb}
gateway=${REVIEW_GATEWAY:-http://127.0.0.1:18391}
out=$2
rm -f "$out.done"
SKIP_EXISTING=1 OFFLINE=1 NODE_PATH=${NODE_PATH:-$home/pw/node_modules} setsid nohup bash -c \
  "node '$tools/capture.mjs' site http://127.0.0.1:$1 '$gateway' '$out' ${3:-} >> '$out.log' 2>&1; echo \$? > '$out.done'" \
  < /dev/null > /dev/null 2>&1 &
echo "capturing into $out (log $out.log)"
