#!/usr/bin/env bash
set -euo pipefail

cd "${TEST_SRCDIR}/${TEST_WORKSPACE}"
export PYTHONDONTWRITEBYTECODE=1
export TMPDIR="${TEST_TMPDIR}"
exec python3 -m unittest discover -s tests -p test_version_bump.py
