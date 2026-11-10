#!/usr/bin/env sh
# Publish the current tree of `main` to the public repository.
#
# The public repo (WhelkMail/WhelkMail) is the distribution copy: it must be
# installable by someone else and must never contain personal deployment
# configuration. This script builds a release commit whose parent is the public
# `main`, so the public history stays linear and every push is a fast-forward.
#
# Usage:
#   git remote add public https://github.com/WhelkMail/WhelkMail.git
#   sh scripts/publish-public.sh                 # publish main
#   MESSAGE="Release 0.1.0" sh scripts/publish-public.sh
#   SOURCE=feature-x sh scripts/publish-public.sh
set -eu

REMOTE=${REMOTE:-public}
SOURCE=${SOURCE:-main}
TARGET=${TARGET:-main}
MESSAGE=${MESSAGE:-"Release $(date +%Y-%m-%d)"}

die() {
  echo "error: $*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || die "git not found"
git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

# Never publish files that describe a specific installation.
for file in wrangler.toml worker/wrangler.toml .dev.vars; do
  if git cat-file -e "$SOURCE:$file" 2>/dev/null; then
    die "$file is tracked in $SOURCE; untrack it with: git rm --cached $file"
  fi
done

git fetch "$REMOTE" "$TARGET" >/dev/null 2>&1 || die "cannot fetch $REMOTE/$TARGET"

tree=$(git rev-parse "$SOURCE^{tree}")
parent=$(git rev-parse "$REMOTE/$TARGET")
commit=$(git commit-tree "$tree" -p "$parent" -m "$MESSAGE")

# Keep the snapshot reachable even if the push fails (missing credentials, no
# network): the next run replaces it and a plain
#   git push public public-release:main
# is enough once authentication works.
git update-ref refs/heads/public-release "$commit"

echo "publishing $SOURCE -> $REMOTE/$TARGET"
echo "  tree   $tree"
echo "  parent $parent"
echo "  commit $commit (ref public-release)"
git --no-pager diff --stat "$parent" "$commit" | tail -n 20
echo
git push "$REMOTE" "$commit:$TARGET"
echo "done: $(git rev-parse --short "$commit")"
