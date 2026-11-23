#!/usr/bin/env bash
set -euo pipefail

checker="${RUNFILES_DIR:-$0.runfiles}/$1"
shift
checkout="${BUILD_WORKSPACE_DIRECTORY:?Run this target with bazel run}"
cd "${BUILD_WORKING_DIRECTORY:-$checkout}"
exec python3 -E -B "$checker" --repo "$checkout" --strict "$@"
