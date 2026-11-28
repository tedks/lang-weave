"""Fetch the extension's locked Bun dependencies before the test sandbox."""

def _extension_test_dependencies_impl(ctx):
    bun = ctx.path(ctx.attr.bun)
    ctx.watch(bun)
    ctx.file("package.json", ctx.read(ctx.attr.package_json), executable = False)
    ctx.file("bun.lock", ctx.read(ctx.attr.lockfile), executable = False)

    # Keep user npm/Bun configuration, credentials, and caches out of the install.
    env = ctx.which("env")
    if env == None:
        fail("Fetching the extension test dependencies requires env on PATH")
    home = str(ctx.path("."))
    result = ctx.execute([
        env,
        "-i",
        "HOME=" + home,
        "XDG_CONFIG_HOME=" + home,
        "DO_NOT_TRACK=1",
        bun,
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--linker=hoisted",
        "--no-cache",
        "--registry=https://registry.npmjs.org",
    ], timeout = 120)
    if result.return_code != 0:
        fail("Locked extension test dependency install failed:\n%s\n%s" % (result.stdout, result.stderr))

    ctx.file("BUILD.bazel", """
package(default_visibility = ["//visibility:public"])
exports_files(["package.json"])
filegroup(
    name = "node_modules",
    srcs = glob(["node_modules/**"], exclude = ["node_modules/.bin/**"], allow_empty = False),
)
""")

extension_test_dependencies = repository_rule(
    implementation = _extension_test_dependencies_impl,
    attrs = {
        "bun": attr.label(mandatory = True, allow_single_file = True),
        "lockfile": attr.label(mandatory = True, allow_single_file = True),
        "package_json": attr.label(mandatory = True, allow_single_file = True),
    },
)
