#!/usr/bin/env bash
set -euo pipefail

bun_path="${TEST_SRCDIR}/$1"
runfiles_root="${TEST_SRCDIR}/${TEST_WORKSPACE}"
mkdir -p "${TEST_TMPDIR}/build_defs" "${TEST_TMPDIR}/extension/scripts"
cp "${runfiles_root}/build_defs/package_boundary_test.mjs" "${TEST_TMPDIR}/build_defs/package_boundary_test.mjs"
cp "${runfiles_root}/extension/scripts/package.mjs" "${TEST_TMPDIR}/extension/scripts/package.mjs"
cp "${runfiles_root}/extension/scripts/content-bundle.mjs" "${TEST_TMPDIR}/extension/scripts/content-bundle.mjs"
cd "${TEST_TMPDIR}"
export DO_NOT_TRACK=1
exec "$bun_path" test ./build_defs/package_boundary_test.mjs
