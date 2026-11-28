#!/usr/bin/env bash
set -euo pipefail

bun_path="${TEST_SRCDIR}/$1"
runfiles_root="${TEST_SRCDIR}/${TEST_WORKSPACE}"

# Preserve relative imports without letting Bun follow runfile symlinks back
# into the source tree.
cp -LR "${runfiles_root}"/{proxy,extension} "${TEST_TMPDIR}/"
cd "${TEST_TMPDIR}/proxy"

export DO_NOT_TRACK=1
export HOME="$TEST_TMPDIR"
export TMPDIR="$TEST_TMPDIR"
export TZ=UTC
exec "$bun_path" test --no-install ./test
