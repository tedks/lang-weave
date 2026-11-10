#!/usr/bin/env bash
set -euo pipefail

bun_path="${TEST_SRCDIR}/$1"
cd "${TEST_SRCDIR}/${TEST_WORKSPACE}"
export DO_NOT_TRACK=1
exec "$bun_path" test ./extension/test/fsrs.test.js
