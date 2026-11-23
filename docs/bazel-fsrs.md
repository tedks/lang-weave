# Bazel FSRS slice

The first child Bazel target runs only the existing FSRS scheduling test
against `extension/src/fsrs.js` and its checked-in reference fixture. The
target does not import browser state, Gemini, packaging code, or inherited
companion tooling. `nix develop --command bazel test //:fsrs_test` uses the
official Bun v1.4.4 Linux x64 release archive pinned by SHA-256 in
`MODULE.bazel`. The archive is a single-binary toolchain input; a new Bun
version or platform requires a reviewed archive and checksum.

`//:package_boundary_test` checks an actual synthetic extension ZIP with the
same pinned Bun. It proves that Bazel `BUILD` and `BUILD.bazel` metadata stays
out of the published payload. The package-owned runner label is exported by
`//build_defs`; the packager source is declared under `//extension/scripts`.
The existing full package suite separately checks the dev and Store ZIP entry
sets against the real extension tree.
`//:version_classifier_test` runs self-contained Python classifier fixtures
under the pinned Nix shell. The runner copies its two declared Python inputs
into `$TEST_TMPDIR` and requires Python and Git from `/nix/store`. That check
is a guard against host tools, not proof of the flake's exact pin.
`.bazelrc` passes the shell's `PATH` into every test (`--test_env=PATH`), so
run tests from `nix develop`. The fixtures
check that BUILD metadata and known browser harness changes need no version
bump, unknown harness and package script changes still need one, and runtime
reference checks work even with binary assets. This target does not scan the
real extension source or replace the full release check. The CTO
chose 0.12.25 for this onboarding change; it is a source version only, not a
Store release.

`//:fsrs_test` and `//:package_boundary_test` run the pinned Linux x64 Bun, so
they are Linux x86_64 only. `//:version_classifier_test` has no platform input
and carries no platform constraint. All three carry Bazel's Linux sandbox
network block. Remote execution must separately prove worker architecture,
archive execution, and isolation before it is qualified.

The binary needs an AVX2-capable x86_64 worker and a glibc-compatible runtime.
The runner copies its three declared source and fixture inputs from Bazel's
runfiles tree into the writable test directory before Bun starts, so Bun
cannot follow an input symlink back into the source checkout.

`MODULE.bazel.lock` is committed, and `.bazelrc` runs every command with
`--lockfile_mode=error`, so
`nix develop --command bazel test //:fsrs_test //:package_boundary_test //:version_classifier_test`
works on a fresh checkout and fails if a `bazel_dep` drifts from the lock.
The Bun archive is a repository rule, which the lock does not record; its
SHA-256 in `MODULE.bazel` guards it instead.
After a reviewed `MODULE.bazel` change, regenerate the lock with
`nix develop --command bazel mod deps --lockfile_mode=update`, review the
diff and commit it with the change.

## Full extension regressions

```sh
nix develop --command bazel test --spawn_strategy=linux-sandbox //:extension_test
```

This Linux x86-64 target runs Bun's discovery over `extension/test/`,
including the happy-dom tests, the dev and Store ZIP fixture tests, and the
curriculum and lexicon regressions. For fresh counts, add
`--nocache_test_results --test_output=all` and read Bun's summary. Bazel
reports the entire suite as one test target.

Bazel uses the pinned Bun to install from `extension/package.json` and
`extension/bun.lock` in an external repository. A change to either file or
to the pinned Bun executable triggers a fresh install. The install uses the
public npm registry, freezes the lock and skips lifecycle scripts. The test
action copies the resolved modules and declared source files into the sandbox
and runs Bun with automatic installs disabled. The documented
`--spawn_strategy=linux-sandbox` invocation enforces the test's network block.
No local `node_modules` is needed.

The tests need the source layout, including licenses and data outside
`extension/`. They run without Git metadata. The packaging tests build
their own ZIPs from those inputs. `//:beta_zip` needs the Git checkout to
archive the committed `HEAD` and `//:beta_install_test` takes an existing
release ZIP and a Chromium executable. The full Git-based version check
and the other browser gates are tracked in `bazel-graph-remaining-gates`.

## Unpacked beta gates

On Linux x86-64, confirm `git status --short` is empty in the release checkout,
then package the unpacked ZIP in a new directory and run the focused language
and backup regressions with Bazel.

```sh
nix develop --command bazel run //:beta_zip -- /absolute/new/output/directory
nix develop --command bazel test //:fsrs_test //:package_boundary_test //:version_classifier_test //:extension_release_test
```

The target packages the committed files at `HEAD` and prints that commit's
SHA. It writes `lang-weave-<version>.zip` in the new output directory. Tag the
printed commit so GitHub's source archives on the release page correspond to
the extension. The ZIP includes `LICENSE`, `LICENSE-MIT` and `NOTICE`.

Pass absolute paths to the ZIP just produced and to a Chromium executable
in a fresh disposable profile. The Chromium installed by Playwright 1.64.1
matches the driver pinned in this target.

```sh
nix develop --command bazel test --nocache_test_results //:beta_install_test \
  --test_env=LANG_WEAVE_BETA_ZIP=/absolute/path/to/the-release.zip \
  --test_env=LANG_WEAVE_CHROMIUM=/absolute/path/to/chromium --test_output=errors
```

The browser test checks the manifest and license files against the checkout,
then loads the extracted ZIP as-is and checks first-run setup,
the interactive local demo, the stable extension ID and per-site consent.
It also selects bundled Paraguayan Guaraní and reviews a word offline.
The My words check exercises the packaged popup, review-tab reuse after a
worker restart, and deliberate card selection and rating. To also test the
native keyboard shortcut and window focus, supply a disposable X11 display
with a window manager via `--test_env=DISPLAY` and an absolute xdotool path
via `--test_env=LANG_WEAVE_REVIEW_XDOTOOL=/path/to/xdotool`.
It uses no real account or key. The focused Bun target covers language,
backup and resource-manifest regressions without npm test dependencies.

## Python and release version gates

`//:inherited_python_test` runs the full `unittest discover -s tests` suite
from declared runfiles. It copies the fixtures and source into a temporary
directory and gives each run a disposable home for inherited setup tests.
Use the explicit Linux sandbox strategy below to enforce the test's
`block-network` tag and fail if the sandbox is unavailable. The suite uses
Python and Git from the Nix shell and `ps` from the local system for process
detection tests.

```sh
nix develop --command bazel test --spawn_strategy=linux-sandbox //:inherited_python_test //:version_classifier_test
```

Run the live version check before accepting a release candidate. Pass a local
base ref such as the previous release commit. The check compares the candidate
to the merge base and prints both full commit IDs. A missing base, an invalid
ref or a version failure exits nonzero. Make the needed history available
locally before running the check.

When the selected snapshot declares the root `lang_weave` module, its
literal version in `MODULE.bazel` must match the plugin and extension
versions. Historical snapshots without a root module retain the existing
plugin and extension checks.

```sh
# Use HEAD of the clean Bazel checkout.
nix develop --command bazel run //:release_version_check -- --base refs/tags/PREVIOUS_RELEASE

# Check a committed candidate by name in a different local checkout.
nix develop --command bazel run //:release_version_check -- \
  --repo /absolute/path/to/checkout --base refs/tags/PREVIOUS_RELEASE --head refs/heads/CANDIDATE
```

With `--head`, only committed snapshots enter the comparison and the working
tree can be dirty. Without `--head`, the selected worktree must have no
tracked or untracked changes reported by Git. Bazel can reuse the launcher's
build. Each invocation reads the requested repository and resolves its refs
again. Use the printed head SHA when recording release evidence.
