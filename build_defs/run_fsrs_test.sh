#!/usr/bin/env bash
set -euo pipefail

bun_path="${TEST_SRCDIR}/$1"
runfiles_root="${TEST_SRCDIR}/${TEST_WORKSPACE}"
mkdir -p "${TEST_TMPDIR}/extension/src" "${TEST_TMPDIR}/extension/test"
cp "${runfiles_root}/extension/src/fsrs.js" "${TEST_TMPDIR}/extension/src/fsrs.js"
cp "${runfiles_root}/extension/test/fsrs.test.js" "${TEST_TMPDIR}/extension/test/fsrs.test.js"
cp "${runfiles_root}/extension/test/fsrs-reference.json" "${TEST_TMPDIR}/extension/test/fsrs-reference.json"
cd "${TEST_TMPDIR}"
export DO_NOT_TRACK=1
exec "$bun_path" test ./extension/test/fsrs.test.js
