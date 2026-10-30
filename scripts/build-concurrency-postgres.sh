#!/usr/bin/env bash
# Build only a disposable test runtime from a checksum-pinned official release.
set -euo pipefail
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
test "$(id -u)" -ne 0
test -d "$RUNNER_TEMP" && test ! -L "$RUNNER_TEMP"
root="$(mktemp -d "$RUNNER_TEMP/occulert-pg-build.XXXXXX")"
version=17.11
archive="postgresql-$version.tar.bz2"
checksum=dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979
curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
  --connect-timeout 20 --max-time 180 --retry 2 \
  "https://ftp.postgresql.org/pub/source/v$version/$archive" -o "$root/$archive"
printf '%s  %s\n' "$checksum" "$root/$archive" | sha256sum --check --strict
tar -xjf "$root/$archive" -C "$root"
cd "$root/postgresql-$version"
./configure --prefix="$root/install" --without-readline --without-zlib --without-icu
make -j2
make install
"$root/install/bin/initdb" --version
# GitHub's per-step environment file; no system directories/settings are changed.
printf 'OCCULERT_PG_BIN=%s\n' "$root/install/bin" >> "$GITHUB_ENV"
