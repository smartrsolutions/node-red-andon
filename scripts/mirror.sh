#!/bin/sh
# Puts one release of this package into the public mirror repository: the
# directory as it is committed at <ref>, as a single commit on the mirror's main
# branch, tagged v<version>. The tag is what starts the mirror's publish workflow
# (.github/workflows/publish.yml), so pushing here is the first half of a release.
#
# The mirror gets a snapshot per release and none of the source repository's
# history, which also holds code that is not public. Everything in this directory
# is public: there is no list of exceptions.
#
#   scripts/mirror.sh [<ref>]            default HEAD; rehearses, pushes nothing
#   MIRROR_PUSH=1 scripts/mirror.sh ...  pushes main and the tag
#
#   MIRROR_URL           the mirror, anything `git push` accepts (required)
#   MIRROR_AUTHOR_NAME   author and committer of the mirror's commit
#   MIRROR_AUTHOR_EMAIL
#
# Rehearsal against a throwaway repository:
#   git init --bare /tmp/mirror.git
#   MIRROR_URL=/tmp/mirror.git MIRROR_PUSH=1 scripts/mirror.sh
set -eu

PREFIX=tools/node-red-andon
TAG_PREFIX=node-red-andon-v

die() {
    echo "mirror: $*" >&2
    exit 1
}

[ -n "${MIRROR_URL:-}" ] || die "MIRROR_URL is not set"
ref=${1:-HEAD}

root=$(git rev-parse --show-toplevel) || die "not inside a git repository"
commit=$(git -C "$root" rev-parse --verify --quiet "$ref^{commit}") || die "no such commit: $ref"

work=$(mktemp -d)
trap 'cd / && rm -rf "$work"' EXIT

mkdir "$work/export"
git -C "$root" archive "$commit:$PREFIX" | tar -x -C "$work/export" ||
    die "$PREFIX does not exist at $ref"

version=$(cd "$work/export" && node -p "require('./package.json').version")
[ -n "$version" ] || die "no version in package.json at $ref"

# A release tag names its version. Anything else (HEAD, a branch) is taken as it is.
case $ref in
"$TAG_PREFIX"*)
    [ "$ref" = "$TAG_PREFIX$version" ] ||
        die "tag $ref does not match package.json version $version"
    ;;
esac

# Dates from the source commit, so the same release always makes the same commit.
date=$(git -C "$root" log -1 --format=%cI "$commit")
GIT_AUTHOR_NAME=${MIRROR_AUTHOR_NAME:-SMARTR.solutions}
GIT_AUTHOR_EMAIL=${MIRROR_AUTHOR_EMAIL:-support@andon.app}
GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME
GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL
GIT_AUTHOR_DATE=$date
GIT_COMMITTER_DATE=$date
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
export GIT_AUTHOR_DATE GIT_COMMITTER_DATE

mkdir "$work/mirror"
cd "$work/mirror"
git init -q
git symbolic-ref HEAD refs/heads/main
git remote add origin "$MIRROR_URL"

refs=$(git ls-remote origin) || die "cannot read $MIRROR_URL"
# npm never takes a version twice, so the mirror does not either.
if printf '%s\n' "$refs" | grep -q "refs/tags/v$version\$"; then
    die "the mirror already has v$version: a version is released once"
fi
if printf '%s\n' "$refs" | grep -q 'refs/heads/main$'; then
    git fetch -q origin main
    git reset -q --hard FETCH_HEAD
    git rm -rq .
fi

cp -R "$work/export/." .
git add -A
if git rev-parse --verify --quiet HEAD >/dev/null && git diff --cached --quiet; then
    echo "mirror: nothing changed since the mirror's last commit, tagging it as v$version"
else
    git commit -q -m "$version" -m "Exported from the source repository at $(git -C "$root" rev-parse --short "$commit")."
fi
git tag "v$version"

echo "mirror: v$version is $(git rev-parse --short HEAD), $(git ls-files | wc -l | tr -d ' ') files"
git show --stat --format= HEAD

if [ "${MIRROR_PUSH:-0}" = 1 ]; then
    git push -q --atomic origin main "v$version"
    echo "mirror: pushed main and v$version to $MIRROR_URL"
else
    echo "mirror: rehearsal, nothing pushed (MIRROR_PUSH=1 pushes)"
fi
