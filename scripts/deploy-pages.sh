#!/usr/bin/env bash
# Publish the app to GitHub Pages: build it, then replace the `gh-pages`
# branch of `origin` with what was built. The source branches are not touched.
#
#   npm run deploy
#
# The build works from any path (vite.config.ts sets a relative base), so it
# runs as-is at https://<account>.github.io/<repository>/.
set -euo pipefail
cd "$(dirname "$0")/.."

remote=$(git remote get-url origin)
commit=$(git rev-parse --short HEAD)

npm run build

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
cp -R dist/. "$out"
# Pages runs Jekyll over a branch unless this file is there.
touch "$out/.nojekyll"

git -C "$out" init -q -b gh-pages
git -C "$out" add -A
git -C "$out" commit -q -m "Deploy $commit"
git -C "$out" push -q -f "$remote" gh-pages

echo "Published $commit to the gh-pages branch of $remote"
