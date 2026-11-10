#!/usr/bin/env bash
set -euo pipefail

cd "${TEST_SRCDIR}/${TEST_WORKSPACE}/tests"
export PYTHONDONTWRITEBYTECODE=1
export TMPDIR="${TEST_TMPDIR}"
exec python3 -m unittest \
  test_version_bump.VersionBump.test_unshipped_changes_need_no_bump \
  test_version_bump.VersionBump.test_build_metadata_exemption_does_not_hide_packager_change
