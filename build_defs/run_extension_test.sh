#!/usr/bin/env bash
set -euo pipefail

bun_path="${TEST_SRCDIR}/$1"
deps_root="${TEST_SRCDIR}/${2%/*}"
runfiles_root="${TEST_SRCDIR}/${TEST_WORKSPACE}"

# Keep the source layout for package and curriculum tests, and dereference
# runfile symlinks so Bun and the packager both see regular source files.
cp -LR "${runfiles_root}"/{extension,data,scripts,LICENSE,LICENSE-MIT,NOTICE} "${TEST_TMPDIR}/"
cd "${TEST_TMPDIR}/extension"
cp -LR "${deps_root}/node_modules" "${deps_root}/package.json" .

export DO_NOT_TRACK=1
export HOME="$TEST_TMPDIR"
export TMPDIR="$TEST_TMPDIR"
export TZ=UTC
exec "$bun_path" test --no-install ./test
