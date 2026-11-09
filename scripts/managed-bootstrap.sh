#!/bin/sh
# Run this script from a reviewed checkout before installing Deckuse.
set -eu
if [ "$#" -ne 3 ]; then
  printf '%s\n' 'Usage: managed-bootstrap.sh <exact-version> <new-job-directory> <approved-cache-root>' >&2
  exit 2
fi
version=$1
case "$version" in
  ''|*[!0-9A-Za-z.+-]*|[!0-9]*) printf '%s\n' 'Supply an exact npm package version.' >&2; exit 2 ;;
esac
job=$2
cache_root=$3
if [ ! -d "$cache_root" ]; then
  printf '%s\n' 'Select an existing cache directory approved by the host.' >&2
  exit 2
fi
cache=$(mktemp -d "${cache_root%/}/deckuse-npm.XXXXXX") || {
  printf '%s\n' 'Could not allocate an isolated npm cache in the host-approved directory.' >&2
  exit 2
}
mkdir "$job" || {
  printf '%s\n' 'Select a new job directory with an existing, writable parent.' >&2
  exit 2
}
spec="@deckflow/deckuse@$version"
resolved=$(npm view "$spec" version --cache "$cache" --logs-max=0 --no-update-notifier) || {
  code=$?
  printf 'npm version lookup failed (status %s, cache %s).\n' "$code" "$cache" >&2
  exit "$code"
}
if [ "$resolved" != "$version" ]; then
  printf 'Expected version %s, npm returned %s.\n' "$version" "$resolved" >&2
  exit 2
fi
npm install --prefix "$job" --cache "$cache" --logs-max=0 --no-update-notifier \
  --ignore-scripts --no-audit --no-fund --save-exact "$spec" >&2 || {
  code=$?
  printf 'npm installation failed (status %s, job %s, cache %s).\n' "$code" "$job" "$cache" >&2
  exit "$code"
}
cli="$job/node_modules/.bin/deckuse"
actual=$("$cli" --version)
if [ "$actual" != "deckuse $version (edition=community)" ]; then
  printf 'Installed CLI version mismatch: %s\n' "$actual" >&2
  exit 2
fi
printf '%s\n' "$cli"
