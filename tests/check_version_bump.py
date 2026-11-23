#!/usr/bin/env python3
"""Version checks for a release: run by CI, and locally before a push.

  python3 tests/check_version_bump.py                  versions agree (plugin.json, marketplace.json if it has one,
                                                       extension/manifest.json, extension/package.json,
                                                       MODULE.bazel for the root Lang Weave module)
  python3 tests/check_version_bump.py --base REF       also: if a file the plugin ships changed since REF (merge base
                                                       with HEAD), .claude-plugin/plugin.json's version changed too
  ... --head REF                                       check REF instead of the working tree (CI, tests)
  ... --repo DIR                                       the repository (default: the one this file is in)
  ... --strict --base REF [--head REF]                  release acceptance; resolve both commits locally
                                                       (with no --head, require a clean worktree and use HEAD)

`claude plugin update` only delivers a new copy when plugin.json's version changes, so a shipped change without a
bump never reaches anyone who already installed. Python 3.9+, standard library only. Exit 1 on a failed check.
"""
import argparse
import ast
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

PLUGIN = '.claude-plugin/plugin.json'
MODULE = 'MODULE.bazel'
VERSIONED = (PLUGIN, '.claude-plugin/marketplace.json', 'extension/manifest.json', 'extension/package.json')
# Installed runtime roots. Some developer-only files under these roots are
# copied by setup but never loaded by the plugin or unpacked extension.
SHIPPED = ('.claude-plugin/', 'scripts/', 'hooks/', 'commands/', 'skills/', 'agents/', 'data/', 'extension/')
# Developer-only tools do not need an installed runtime version bump. Only
# the known harness entry points are exempt. New e2e files fail closed.
NOT_SHIPPED = ('extension/test/', 'extension/node_modules/', 'extension/package.json', 'extension/bun.lock',
               'extension/bun.lockb')
E2E_HARNESSES = ('extension/e2e/smoke.mjs', 'extension/e2e/gradual.mjs',
                 'extension/e2e/again.mjs', 'extension/e2e/adaptive.mjs',
                 'extension/e2e/highlights.mjs', 'extension/e2e/badge.mjs',
                 'extension/e2e/welcome.mjs')
ZERO = re.compile(r'^0+$')  # GitHub's "before" SHA for a new branch


def git(repo, *args, check=True, text=True):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=text)
    if check and result.returncode:
        error = result.stderr if text else os.fsdecode(result.stderr)
        raise RuntimeError(f'git {" ".join(args)}: {error.strip() or f"exited {result.returncode}"}')
    return result


def read(repo, path, ref=None):
    """Parsed JSON of path at ref (None: the working tree), or None when it doesn't exist."""
    if ref is None:
        file = Path(repo) / path
        return json.loads(file.read_text()) if file.exists() else None
    result = git(repo, 'show', f'{ref}:{path}', check=False)
    return json.loads(result.stdout) if result.returncode == 0 else None


def module_version(repo, ref=None):
    """Read the literal Lang Weave root module version from the selected snapshot."""
    if ref is None:
        path = Path(repo) / MODULE
        try:
            mode = path.lstat().st_mode
        except FileNotFoundError:
            return None
        if not stat.S_ISREG(mode):
            raise ValueError(f'{MODULE} must be a regular file')
        source = path.read_text(encoding='utf-8')
    else:
        # Distinguish a historical tree with no MODULE.bazel from a missing blob.
        entry = git(repo, 'ls-tree', '--full-tree', ref, '--', MODULE).stdout
        if not entry:
            return None
        if entry.split(' ', 1)[0] not in ('100644', '100755'):
            raise ValueError(f'{MODULE} must be a regular file')
        source = git(repo, 'show', f'{ref}:{MODULE}', text=False).stdout.decode('utf-8')

    # The declaration uses Python-compatible call and string literal syntax.
    # Parse it without evaluating any of the candidate's Bazel code.
    try:
        tree = ast.parse(source, filename=MODULE)
    except SyntaxError as error:
        raise ValueError(f'{MODULE}:{error.lineno}: {error.msg}') from error
    declarations = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'module'
    ]
    if not declarations:
        return None
    if len(declarations) > 1:
        raise ValueError(f'{MODULE} must have at most one module declaration')
    declaration = declarations[0]
    if declaration.args or any(keyword.arg is None for keyword in declaration.keywords):
        raise ValueError(f'{MODULE} module declaration must use explicit keyword arguments')
    fields = {keyword.arg: keyword.value for keyword in declaration.keywords}
    name = fields.get('name')
    if name is None:
        # An anonymous root carries no Lang Weave module metadata.
        return None
    if not isinstance(name, ast.Constant) or not isinstance(name.value, str):
        raise ValueError(f'{MODULE} module name must be a string literal')
    if name.value != 'lang_weave':
        return None
    version = fields.get('version')
    if not isinstance(version, ast.Constant) or not isinstance(version.value, str) or not version.value:
        raise ValueError(f'{MODULE} lang_weave version must be a nonempty string literal')
    return version.value


def versions(repo, ref=None):
    """{file: version} for every versioned file that exists and carries a version."""
    found = {}
    for path in VERSIONED:
        data = read(repo, path, ref)
        if data is None:
            continue
        if path.endswith('marketplace.json'):
            entries = [p for p in data.get('plugins', []) if isinstance(p, dict) and 'version' in p]
            if 'version' in (data.get('metadata') or {}):
                found[f'{path} (metadata)'] = str(data['metadata']['version'])
            for entry in entries:
                found[f'{path} ({entry.get("name", "plugin")})'] = str(entry['version'])
        elif 'version' in data:
            found[path] = str(data['version'])
    bazel_version = module_version(repo, ref)
    if bazel_version is not None:
        found[MODULE] = bazel_version
    return found


def shipped(path):
    # Bazel package metadata under the extension is omitted from both ZIPs.
    if path.startswith('extension/') and Path(path).name in ('BUILD', 'BUILD.bazel'):
        return False
    return path.startswith(SHIPPED) and not path.startswith(NOT_SHIPPED) and path not in E2E_HARNESSES


def e2e_runtime_references(repo, ref=None):
    """Conservatively reject e2e path references anywhere in installed runtime files."""
    root = Path(repo) / 'extension'
    def runtime(path):
        return path.startswith('extension/') and not path.startswith('extension/e2e/') and shipped(path)
    if ref is None:
        return [str(path.relative_to(repo)) for path in root.rglob('*')
                if path.is_file() and runtime(str(path.relative_to(repo)))
                and b'e2e/' in path.read_bytes()]
    listed = git(repo, 'ls-tree', '-r', '-z', '--name-only', ref, '--', 'extension', text=False).stdout
    paths = os.fsdecode(listed).split('\0')
    return [path for path in paths
            if runtime(path) and b'e2e/' in git(repo, 'show', f'{ref}:{path}', text=False).stdout]


def key(version):
    return tuple(int(part) if part.isdigit() else 0 for part in re.split(r'[.+-]', version))


def check(repo, base=None, head=None):
    """List of problems (empty: all good) and notes."""
    problems, notes = [], []
    found = versions(repo, head)
    if PLUGIN not in found:
        return [f'{PLUGIN} has no version.'], notes
    if len(set(found.values())) > 1:
        problems.append('Versions disagree; set them all to the same value:\n' +
                        '\n'.join(f'  {path}: {version}' for path, version in found.items()))
    references = e2e_runtime_references(repo, head)
    if references:
        problems.append('Runtime files reference developer-only extension/e2e/; remove that dependency or '
                        'reclassify e2e as shipped before excluding its changes from a version bump: ' +
                        ', '.join(references[:8]))
    if not base or ZERO.match(base):
        notes.append('No base to compare with: skipped the version-bump check.')
        return problems, notes
    if git(repo, 'rev-parse', '--verify', '--quiet', f'{base}^{{commit}}', check=False).returncode:
        notes.append(f'Base {base} is not in this clone (fetch more history): skipped the version-bump check.')
        return problems, notes
    merge_base = git(repo, 'merge-base', base, head or 'HEAD').stdout.strip()
    # A move out of a runtime path is a shipped deletion even when its new
    # path is developer-only. List both sides instead of a detected rename.
    diff = ['diff', '--no-renames', '--name-only', '-z', merge_base] + ([head] if head else []) + ['--']
    paths = os.fsdecode(git(repo, *diff, text=False).stdout).split('\0')
    changed = [path for path in paths if shipped(path)]
    if not changed:
        notes.append('No shipped files changed: no version bump needed.')
        return problems, notes
    old = (read(repo, PLUGIN, merge_base) or {}).get('version')
    new = found[PLUGIN]
    if old is not None and str(old) == new:
        shown = ', '.join(changed[:8]) + (f' and {len(changed) - 8} more' if len(changed) > 8 else '')
        problems.append(f'Files the plugin ships changed ({shown}), but {PLUGIN} is still version {new}. Bump the '
                        'version (and extension/manifest.json and extension/package.json to match): `claude plugin '
                        'update` only delivers a change to installed users when that version changes.')
    elif old is not None and key(new) < key(str(old)):
        problems.append(f'{PLUGIN} went from {old} down to {new}; versions only go up.')
    else:
        notes.append(f'Version {old} -> {new} for {len(changed)} shipped file(s).')
    return problems, notes


def release_refs(repo, base, head):
    """Resolve the live comparison once, before reading any version files."""
    if base is None:
        raise ValueError('--strict requires --base REF')
    # Git hook environments may point at another checkout, index or object
    # database. Resolve strictly against the repository the operator chose.
    for name in list(os.environ):
        if name.startswith('GIT_'):
            del os.environ[name]
    os.environ.update(GIT_NO_REPLACE_OBJECTS='1', GIT_NO_LAZY_FETCH='1', GIT_OPTIONAL_LOCKS='0')

    def commit(option, ref):
        revision = git(repo, 'rev-parse', '--verify', '--end-of-options', f'{ref}^{{commit}}', check=False)
        if not ref or revision.returncode:
            raise ValueError(f'{option} {ref!r} does not resolve to a local commit in {repo}')
        return revision.stdout.strip()

    base = commit('--base', base)
    if head is not None:
        return base, commit('--head', head)
    status = git(repo, '-c', 'core.fsmonitor=false', 'status',
                 '--porcelain=v1', '--untracked-files=normal', '--ignore-submodules=none').stdout
    if status:
        raise ValueError(f'{repo} has uncommitted changes. Use --head REF to check a committed candidate explicitly.')
    return base, commit('HEAD', 'HEAD')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--base', help='compare with this ref (merge base with HEAD)')
    parser.add_argument('--head', help='check this ref instead of the working tree')
    parser.add_argument('--repo', default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument('--strict', action='store_true', help='require a local base and compare committed snapshots')
    args = parser.parse_args(argv)
    try:
        if args.strict:
            args.base, args.head = release_refs(args.repo, args.base, args.head)
            print(f'Checking release versions: base={args.base} head={args.head}')
        problems, notes = check(args.repo, args.base, args.head)
    except (OSError, RuntimeError, ValueError) as error:
        print(f'version check failed to run: {error}', file=sys.stderr)
        return 1
    for note in notes:
        print(note)
    for problem in problems:
        print(f'FAIL: {problem}')
        if os.environ.get('GITHUB_ACTIONS') == 'true':  # also as an annotation on the run's summary page
            print('::error title=Version check::' + problem.replace('%', '%25').replace('\r', '').replace('\n', '%0A'))
    if not problems:
        print('Version check passed: ' + ', '.join(sorted(set(versions(args.repo, args.head).values()))))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
