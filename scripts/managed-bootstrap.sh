#!/bin/sh
# Run this script from a reviewed checkout before installing Deckuse.
set -eu
handoff=0
if [ "${1:-}" = --handoff-json ]; then
  handoff=1
  shift
fi
if [ "$#" -ne 3 ] && { [ "$#" -ne 4 ] || [ "$4" != --shared-cache ]; }; then
  printf '%s\n' 'Usage: managed-bootstrap.sh [--handoff-json] <exact-version|latest> <new-job-directory> <approved-cache-root> [--shared-cache]' >&2
  exit 2
fi
version=$1
case "$version" in
  latest) ;;
  ''|*[!0-9A-Za-z.+-]*|[!0-9]*) printf '%s\n' 'Supply an exact npm package version.' >&2; exit 2 ;;
esac
job=$2
cache_root=$3
if [ ! -d "$cache_root" ]; then
  printf '%s\n' 'Select an existing cache directory approved by the host.' >&2
  exit 2
fi
if [ "${4:-}" = --shared-cache ]; then
  cache=$cache_root
else
  cache=$(mktemp -d "${cache_root%/}/deckuse-npm.XXXXXX") || {
    printf '%s\n' 'Could not allocate an isolated npm cache in the host-approved directory.' >&2
    exit 2
  }
fi
mkdir "$job" || {
  printf '%s\n' 'Select a new job directory with an existing, writable parent.' >&2
  exit 2
}
# Use Node's process timeout so the same bound works on macOS and Linux.
run_npm() {
  node -e '
    const { spawnSync } = require("node:child_process");
    const [timeout, ...args] = process.argv.slice(1);
    const result = spawnSync("npm", args, { timeout: Number(timeout), killSignal: "SIGKILL", stdio: "inherit" });
    if (result.error) process.stderr.write(result.error.message + "\n");
    process.exitCode = result.error?.code === "ETIMEDOUT" ? 124 : result.status ?? 1;
  ' "$@"
}

spec="@deckflow/deckuse@$version"
resolved=$(run_npm 30000 view "$spec" version --cache "$cache" --logs-max=0 --no-update-notifier --fetch-retries=0) || {
  code=$?
  printf 'npm version lookup failed (status %s, cache %s).\n' "$code" "$cache" >&2
  exit "$code"
}
if ! node -e 'process.exit(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(process.argv[1]) ? 0 : 1)' "$resolved" ||
   { [ "$version" != latest ] && [ "$resolved" != "$version" ]; }; then
  printf 'Expected one exact version for %s (cache %s).\n' "$spec" "$cache" >&2
  exit 2
fi
spec="@deckflow/deckuse@$resolved"
run_npm 180000 install --prefix "$job" --cache "$cache" --logs-max=0 --no-update-notifier \
  --fetch-retries=0 --ignore-scripts --no-audit --no-fund --save-exact "$spec" >&2 || {
  code=$?
  printf 'npm installation failed (status %s, job %s, cache %s).\n' "$code" "$job" "$cache" >&2
  exit "$code"
}
cli="$job/node_modules/.bin/deckuse"
actual=$("$cli" --version)
if [ "$actual" != "deckuse $resolved (edition=community)" ]; then
  printf 'Installed CLI version mismatch: %s\n' "$actual" >&2
  exit 2
fi
if [ "$handoff" = 1 ]; then
  exec "$cli" skill-path --json
fi
printf '%s\n' "$cli"
