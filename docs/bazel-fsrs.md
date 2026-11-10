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
