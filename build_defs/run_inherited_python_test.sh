#!/usr/bin/env bash
set -euo pipefail

for tool in python3 git; do
  case "$(command -v "$tool")" in
    /nix/store/*) ;;
    *) echo "Run this test from nix develop with $tool on PATH from /nix/store" >&2; exit 1 ;;
  esac
done

runfiles="${TEST_SRCDIR}/${TEST_WORKSPACE}"
stage="${TEST_TMPDIR}/source"
home="${TEST_TMPDIR}/home"
mkdir -p "$stage" "$home"
# The inherited tests locate sources via Path(__file__).resolve().
cp -RL "$runfiles"/{.claude-plugin,blocks,commands,data,extension,scripts,tests} "$stage"
cp "$runfiles/MODULE.bazel" "$stage/"
cd "$stage"
exec env -i HOME="$home" PATH="$PATH" TMPDIR="$TEST_TMPDIR" GIT_CONFIG_NOSYSTEM=1 \
  PYTHONUTF8=1 PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
