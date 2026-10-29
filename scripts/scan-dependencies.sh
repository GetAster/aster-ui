#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
revision=
case "$#" in
  0) ;;
  2) [[ "$1" == --revision ]] || { echo "Usage: $0 [--revision COMMIT]" >&2; exit 2; }; revision=$(git rev-parse --verify "$2^{commit}") ;;
  *) echo "Usage: $0 [--revision COMMIT]" >&2; exit 2 ;;
esac
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) platform=Darwin_arm64; checksum=b4fa633b3fe15039f59ae9d9eefab8edf677c50cddd4e7785050a35950689c83 ;;
  Linux/x86_64) platform=Linux_x86_64; checksum=cb875389498d7a4cb6f0edda19ae18e976739a8f88187f994ccb8396e925569c ;;
  *) echo 'Pinned dependency scanner supports macOS arm64 and Linux x86_64.' >&2; exit 1 ;;
esac
stage=$(mktemp -d "${TMPDIR:-/tmp}/aster-dependency-scan.XXXXXX")
trap 'rm -rf "$stage"' EXIT
curl --fail --silent --show-error --location "https://github.com/safedep/vet/releases/download/v1.20.0/vet_${platform}.tar.gz" --output "$stage/vet.tar.gz"
printf '%s  %s\n' "$checksum" "$stage/vet.tar.gz" > "$stage/checksum"
if command -v sha256sum >/dev/null; then sha256sum --check "$stage/checksum"; else shasum -a 256 --check "$stage/checksum"; fi
tar -xzf "$stage/vet.tar.gz" -C "$stage"
mkdir -p dist-security
scan_status=0
for lockfile in bun.lock scripts/cloudflare/package-lock.json; do
  case "$lockfile" in
    bun.lock) report=dependencies ;;
    *) report=cloudflare ;;
  esac
  input="$lockfile"
  if [[ -n "$revision" ]]; then
    input="$stage/source/$lockfile"
    mkdir -p "$(dirname "$input")"
    git show "$revision:$lockfile" > "$input" || exit 1
  fi
  # Both lockfiles include transitive packages; registry expansion ignores overrides.
  VET_DISABLE_TELEMETRY=true "$stage/vet" scan --no-banner --silent --lockfiles "$input" --malware-query \
    --filter 'vulns.critical.exists(p, true) || vulns.high.exists(p, true) || vulns.all.exists(v, v.id.startsWith("MAL-"))' \
    --filter-fail --report-json "dist-security/$report.json" --report-cdx "dist-security/$report.cdx.json" || scan_status=1
done
exit "$scan_status"
