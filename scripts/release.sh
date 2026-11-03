#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NPM_REGISTRY_NPM="https://registry.npmjs.org"
NPM_REGISTRY_GITHUB="https://npm.pkg.github.com"

GITHUB=0
README_REWRITTEN=0
CHANGESET_CONFIG_BACKUP=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--github]

  1. Build
  2. Refuse publish if commercial strings leaked
  3. Rewrite README links for the packed package
  4. Publish with changesets to one registry:
       - ${NPM_REGISTRY_NPM}     (access=public)     [default]
       - ${NPM_REGISTRY_GITHUB}  (access=restricted) [--github]

  --github  Publish only to GitHub Packages (npm.pkg.github.com)

  pnpm forwards script args, so both of these work:
    pnpm release --github
    pnpm release -- --github
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      # pnpm/npm may forward the arg separator when using `pnpm release -- --github`
      shift
      ;;
    --github)
      GITHUB=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

cleanup() {
  local status=$?
  if [[ -n "$CHANGESET_CONFIG_BACKUP" && -f "$CHANGESET_CONFIG_BACKUP" ]]; then
    cp "$CHANGESET_CONFIG_BACKUP" "$ROOT/.changeset/config.json" || status=$?
    rm -f "$CHANGESET_CONFIG_BACKUP"
  fi
  if [[ "$README_REWRITTEN" -eq 1 ]]; then
    node "$ROOT/scripts/sync-npm-readme.mjs" --restore || status=$?
  fi
  exit "$status"
}
trap cleanup EXIT

cd "$ROOT"

if [[ "$GITHUB" -eq 1 ]]; then
  registry="$NPM_REGISTRY_GITHUB"
  access="restricted"
else
  registry="$NPM_REGISTRY_NPM"
  access="public"
fi

echo "==> Building"
pnpm build

echo
echo "==> Checking for commercial leaks"
pnpm check:no-commercial-leak

echo
echo "==> Rewriting README links for publish"
node "$ROOT/scripts/sync-npm-readme.mjs"
README_REWRITTEN=1

# changesets reads access from .changeset/config.json. Pin it for this publish
# only (public on npmjs, restricted on GitHub Packages) and restore the file
# afterwards so the working tree stays unchanged.
CHANGESET_CONFIG_BACKUP="$(mktemp "${TMPDIR:-/tmp}/deckuse-changeset-config.XXXXXX")"
cp "$ROOT/.changeset/config.json" "$CHANGESET_CONFIG_BACKUP"
ACCESS="$access" CONFIG_PATH="$ROOT/.changeset/config.json" node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const path = process.env.CONFIG_PATH;
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.access = process.env.ACCESS;
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
'

echo
echo "==> Publishing to $registry (access: $access)"
# .npmrc pins @deckflow:registry. A scoped registry beats --registry and a
# temporary userconfig (see deck2html scripts/release.sh). This env key
# outranks project .npmrc, so the publish hits exactly one registry.
env \
  -u npm_config__deckflow_registry \
  "npm_config_@deckflow:registry=${registry}" \
  "NPM_CONFIG_@deckflow:registry=${registry}" \
  pnpm exec changeset publish

echo
if [[ "$GITHUB" -eq 1 ]]; then
  echo "Release complete → ${NPM_REGISTRY_GITHUB}."
else
  echo "Release complete → ${NPM_REGISTRY_NPM}."
fi
