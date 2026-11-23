#!/usr/bin/env bash
set -euo pipefail

bun_path="${TEST_SRCDIR}/$1"
export LANG_WEAVE_PLAYWRIGHT="${TEST_SRCDIR}/$2"
runfiles_root="${TEST_SRCDIR}/${TEST_WORKSPACE}"
: "${LANG_WEAVE_BETA_ZIP:?Pass --test_env=LANG_WEAVE_BETA_ZIP=/absolute/path/to/lang-weave-version.zip}"
if [[ "$LANG_WEAVE_BETA_ZIP" != /* || ! -f "$LANG_WEAVE_BETA_ZIP" ]]; then
    echo 'LANG_WEAVE_BETA_ZIP must be an absolute path to the release ZIP.' >&2
    exit 2
fi
: "${LANG_WEAVE_CHROMIUM:?Pass --test_env=LANG_WEAVE_CHROMIUM=/absolute/path/to/chromium}"
if [[ "$LANG_WEAVE_CHROMIUM" != /* || ! -x "$LANG_WEAVE_CHROMIUM" ]]; then
    echo 'LANG_WEAVE_CHROMIUM must be an absolute path to an executable.' >&2
    exit 2
fi
export LANG_WEAVE_WELCOME_EXTENSION="${TEST_TMPDIR}/extension"
# The packaged manifest and all of its files are loaded exactly as extracted.
python3 -m zipfile -e "$LANG_WEAVE_BETA_ZIP" "$LANG_WEAVE_WELCOME_EXTENSION"
cmp "$runfiles_root/extension/manifest.json" "$LANG_WEAVE_WELCOME_EXTENSION/manifest.json"
for license in LICENSE LICENSE-MIT NOTICE; do
    cmp "$runfiles_root/$license" "$LANG_WEAVE_WELCOME_EXTENSION/$license"
done
# Chromium uses a Unix socket whose path cannot fit under the Bazel test directory.
export TMPDIR=/tmp
export DO_NOT_TRACK=1
if [[ "${3:-}" == --supplementary ]]; then
    shift 3
    cases=(smoke adaptive again badge gradual guess highlights key-rejection personal startup-recovery gloss quota-status portability measurement-backup)
    if [[ $# -eq 0 ]]; then
        set -- "${cases[@]}"
    fi
    for name in "$@"; do
        if [[ " ${cases[*]} " != *" $name "* || -z "$name" || "$name" == *' '* ]]; then
            echo "Unknown supplementary browser scenario: $name" >&2
            exit 2
        fi
    done
    sha256sum "$LANG_WEAVE_BETA_ZIP"
    failed=0
    for name in "$@"; do
        echo "BEGIN scenario $name"
        if "$bun_path" "$runfiles_root/extension/e2e/$name.mjs"; then
            echo "END PASS $name"
        else
            echo "END FAIL $name"
            failed=1
        fi
    done
    exit "$failed"
fi
if [[ -n "${3:-}" ]]; then
    exec "$bun_path" "${runfiles_root}/$3"
fi
"$bun_path" "${runfiles_root}/extension/e2e/welcome.mjs"
"$bun_path" "${runfiles_root}/extension/e2e/spanish-prose.mjs"
"$bun_path" "${runfiles_root}/extension/e2e/guarani-context.mjs"
exec "$bun_path" "${runfiles_root}/extension/e2e/words.mjs"
