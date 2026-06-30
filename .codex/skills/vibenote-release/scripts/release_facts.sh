#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
default_repo="$(cd "$script_dir/../../../.." && pwd -P)"
repo="${1:-$default_repo}"
cd "$repo"

repo_name="$(basename "$repo")"
version="$(node -p "require('./package.json').version")"
product="$(node -p "require('./package.json').build.productName")"
tag="v${version}"
arch="arm64"
dmg="dist/${product}-${version}-${arch}.dmg"
sums="dist/SHA256SUMS"

echo "repo: $repo_name"
echo "branch: $(git branch --show-current)"
echo "head: $(git rev-parse --short HEAD)"
echo "origin_head: $(git rev-parse --short origin/$(git branch --show-current) 2>/dev/null || true)"
echo "status:"
git status --short --branch
echo
echo "version: $version"
echo "expected_tag: $tag"
echo "local_tag_exists: $(git tag -l "$tag" | grep -q . && echo yes || echo no)"
echo "remote_tag_exists: $(git ls-remote --tags origin "refs/tags/${tag}" | grep -q . && echo yes || echo no)"
echo
echo "artifacts:"
for file in "$dmg" "$sums"; do
  if [[ -f "$file" ]]; then
    size="$(du -h "$file" | awk '{print $1}')"
    echo "  ok $file $size"
  else
    echo "  missing $file"
  fi
done
echo
if [[ -f "$sums" ]]; then
  echo "checksums:"
  cat "$sums"
fi
echo
if command -v gh >/dev/null 2>&1; then
  echo "gh: $(gh --version | head -n 1)"
  if gh auth status >/dev/null 2>&1; then
    echo "gh_auth: authenticated"
  else
    echo "gh_auth: unavailable_or_unauthenticated"
  fi
else
  echo "gh: missing"
fi
