#!/bin/sh
# Publish the site to Cloudflare Pages (https://friendsgiving-potluck.pages.dev).
# Copies only the public files, so _handoff/, dev/, worker/ and .admin-key never ship.
set -e
ROOT=$(cd "$(dirname "$0")" && pwd)
OUT=$(mktemp -d)
cd "$ROOT"
cp -R index.html menu.html config.js menu admin cards js css assets fonts "$OUT"/
# Run from outside worker/ so wrangler doesn't pick up the API's wrangler.toml.
cd "$OUT" && "$ROOT/worker/node_modules/.bin/wrangler" pages deploy . --project-name friendsgiving-potluck --branch main --commit-dirty=true
rm -rf "$OUT"
