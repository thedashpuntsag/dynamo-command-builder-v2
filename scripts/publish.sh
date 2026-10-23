#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/publish.sh [options]

Publishes this package to the configured npm registry.

Options:
  --dry-run              Run packaging checks without publishing
  --skip-check           Skip "pnpm check" (format/lint/types/tests/build)
  --allow-dirty          Allow publishing with uncommitted git changes
  --allow-version-0      Allow publishing when package.json version is 0.0.0
  --tag <tag>            Dist-tag to publish under (e.g. next)
  --access <access>      npm access level: public | restricted (default: public)
  --registry <url>       Publish to a custom registry
  --otp <code>           One-time password (2FA)
  -h, --help             Show this help

Examples:
  ./scripts/publish.sh
  ./scripts/publish.sh --dry-run
  ./scripts/publish.sh --tag next
  ./scripts/publish.sh --otp 123456
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

semver_gte() {
  # Returns 0 if $1 >= $2, else 1. Supports x.y.z.
  local a="$1" b="$2"
  local IFS=.
  local -a av bv
  read -r -a av <<<"$a"
  read -r -a bv <<<"$b"

  for i in 0 1 2; do
    local ai="${av[$i]:-0}" bi="${bv[$i]:-0}"
    if ((10#$ai > 10#$bi)); then return 0; fi
    if ((10#$ai < 10#$bi)); then return 1; fi
  done

  return 0
}

root_dir_from_here() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

main() {
  local dry_run=0
  local skip_check=0
  local allow_dirty=0
  local allow_version_0=0
  local tag=""
  local access="public"
  local registry=""
  local otp=""

  while (($#)); do
    case "$1" in
      --dry-run)
        dry_run=1
        ;;
      --skip-check)
        skip_check=1
        ;;
      --allow-dirty)
        allow_dirty=1
        ;;
      --allow-version-0)
        allow_version_0=1
        ;;
      --tag)
        shift
        tag="${1:-}"
        [[ -n "$tag" ]] || die "--tag requires a value"
        ;;
      --access)
        shift
        access="${1:-}"
        [[ "$access" == "public" || "$access" == "restricted" ]] || die "--access must be 'public' or 'restricted'"
        ;;
      --registry)
        shift
        registry="${1:-}"
        [[ -n "$registry" ]] || die "--registry requires a value"
        ;;
      --otp)
        shift
        otp="${1:-}"
        [[ -n "$otp" ]] || die "--otp requires a value"
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown option: $1 (use --help)"
        ;;
    esac
    shift
  done

  need_cmd git
  need_cmd node
  need_cmd pnpm
  need_cmd vp

  local repo_root
  repo_root="$(root_dir_from_here)"
  cd "$repo_root"

  if [[ "$(git rev-parse --show-toplevel 2>/dev/null || true)" != "$repo_root" ]]; then
    die "this script must be run inside the git repo at $repo_root"
  fi

  local node_version
  node_version="$(node -p 'process.versions.node')"
  if ! semver_gte "$node_version" "22.13.0"; then
    die "Node.js $node_version detected; development requires >= 22.13.0"
  fi

  local pkg_version
  pkg_version="$(node -p "require('./package.json').version")"
  if [[ "$pkg_version" == "0.0.0" && $allow_version_0 -ne 1 ]]; then
    die "package.json version is 0.0.0; bump it first or pass --allow-version-0"
  fi

  if [[ $allow_dirty -ne 1 ]]; then
    if [[ -n "$(git status --porcelain)" ]]; then
      die "working tree is dirty; commit/stash changes or pass --allow-dirty"
    fi
  fi

  echo "Publishing $(node -p "require('./package.json').name")@$pkg_version"

  if [[ $dry_run -eq 1 ]]; then
    echo "Dry run: packaging only (pnpm pack --dry-run)"
    pnpm pack --dry-run
    return 0
  fi

  if [[ $skip_check -ne 1 ]]; then
    echo "Running quality checks (pnpm check)"
    pnpm check
  else
    echo "Skipping quality checks (--skip-check)"
  fi

  local -a publish_args
  publish_args=(publish --access "$access")

  if [[ -n "$tag" ]]; then
    publish_args+=(--tag "$tag")
  fi

  if [[ -n "$registry" ]]; then
    publish_args+=(--registry "$registry")
  fi

  if [[ -n "$otp" ]]; then
    publish_args+=(--otp "$otp")
  fi

  echo "Running: pnpm ${publish_args[*]}"
  pnpm "${publish_args[@]}"
}

main "$@"

