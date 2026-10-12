#!/usr/bin/env bash
set -euo pipefail
# All writers use the same host lock, including initial state and rollback.
deployment_root="$HOME/.local/share/blog-observe/edge"
mkdir -p "$deployment_root"
chmod 700 "$deployment_root"
export BLOG_DEPLOY_FLOCK_HELD=1
exec flock --exclusive --nonblock "$deployment_root/deploy.lock" \
  "$HOME/.local/bin/node" "$(dirname "${BASH_SOURCE[0]}")/deploy-blue-green.ts" "$@"
