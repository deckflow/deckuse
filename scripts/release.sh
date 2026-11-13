#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NPM_REGISTRY_NPM="https://registry.npmjs.org"
NPM_REGISTRY_GITHUB="https://npm.pkg.github.com"

GITHUB=0
CHANGESET_CONFIG_BACKUP=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--github]

  Prepare a release with pnpm version-packages, commit the changelog and version,
  then create the matching Git tag at that commit.

  1. Verify the changelog and Git tag, then build
  2. Refuse publish if commercial strings leaked
  3. Publish with changesets to one registry:
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

version="$(node -p "require('./package.json').version")"
tag="v${version}"
if ! grep -Fqx -- "## ${version}" CHANGELOG.md; then
  echo "Missing CHANGELOG.md entry for ${version}. Run pnpm version-packages and commit the release files." >&2
  exit 1
fi
if [[ "$(git rev-parse --verify --quiet "refs/tags/${tag}^{commit}")" != "$(git rev-parse HEAD)" ]]; then
  echo "The release tag ${tag} must point at HEAD before publishing." >&2
  exit 1
fi
if ! git diff HEAD --quiet -- package.json CHANGELOG.md .changeset; then
  echo "Commit the release version, changelog and changesets before publishing." >&2
  exit 1
fi

echo "==> Building"
pnpm build

echo
echo "==> Checking for commercial leaks"
pnpm check:no-commercial-leak

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
