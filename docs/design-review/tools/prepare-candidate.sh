#!/usr/bin/env bash
# Export a commit to its own build directory (with hard-linked dependencies), so a
# built candidate keeps serving while the worktree moves on.
#   docs/design-review/tools/prepare-candidate.sh <commit> <name>
set -euo pipefail
repo=$(git rev-parse --show-toplevel)
dest=${REVIEW_HOME:-$HOME/.cache/weblog-ui-hill-climb}/builds/$2
rm -rf "$dest"; mkdir -p "$dest"
git -C "$repo" archive "$1" | tar -x -C "$dest"
cp -al "$repo/node_modules" "$dest/node_modules"
cp -al "$repo/web/node_modules" "$dest/web/node_modules"
echo "$dest"
