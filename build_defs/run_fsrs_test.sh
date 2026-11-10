#!/usr/bin/env bash
set -euo pipefail

bun_path="${TEST_SRCDIR}/$1"
cd "${TEST_SRCDIR}/${TEST_WORKSPACE}"
export BUN_TELEMETRY=0
exec "$bun_path" test extension/test/fsrs.test.js
