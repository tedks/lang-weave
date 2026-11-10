# Bazel FSRS slice

The first child Bazel target runs only the existing FSRS scheduling test
against `extension/src/fsrs.js` and its checked-in reference fixture. The
target does not import browser state, Gemini, packaging code, or inherited
companion tooling. `nix develop --command bazel test //:fsrs_test` uses the
official Bun v1.4.4 Linux x64 release archive pinned by SHA-256 in
`MODULE.bazel`. The archive is a single-binary toolchain input; a new Bun
version or platform requires a reviewed archive and checksum.

This first target is Linux x64 only. The test carries Bazel's Linux sandbox
network block. Remote execution must separately prove worker architecture,
archive execution, and isolation before it is qualified. The existing
standalone `bun install --frozen-lockfile` and `bun test` workflow remains
independent and still covers the broader extension.

The binary needs an AVX2-capable x86_64 worker and a glibc-compatible runtime.
The test also expects Bazel's runfiles tree. Before the documented test can run
on a fresh checkout, generate and review `MODULE.bazel.lock` with
`nix develop --command bazel mod deps --lockfile_mode=update`, then commit it;
subsequent runs use the committed lock under error mode.
