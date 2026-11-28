#!/usr/bin/env bash
# Capture the original BYOK worker with only the release version changed.
set -euo pipefail

cd "$(git -C "$(dirname -- "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
baseline=39b264a6815335f49c63a909a63e7e79ad5d3b8d
version=$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')
lock="$(git rev-parse --path-format=absolute --git-common-dir)/managed-tracer-bazel.lock"
scratch_root="${XDG_CACHE_HOME:-$HOME/.cache}/lang-weave"
mkdir -p "$scratch_root"
snapshot=$(mktemp -d "$scratch_root/byok-baseline.XXXXXXXX")
cleanup() {
  if [[ $? == 0 ]]; then
    rm -rf -- "$snapshot"
  else
    printf 'Baseline snapshot and logs retained at %s\n' "$snapshot" >&2
  fi
}
trap cleanup EXIT

git archive "$baseline" | tar -xf - -C "$snapshot"
python3 - "$snapshot" "$version" <<'PY'
from pathlib import Path
import re
import sys

root, version = Path(sys.argv[1]), sys.argv[2]
assert re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version)
for file in (".claude-plugin/plugin.json", "extension/manifest.json",
             "extension/package.json", "MODULE.bazel"):
    path = root / file
    text, count = re.subn(r'("version": |version = )"[0-9.]+",', rf'\g<1>"{version}",', path.read_text(), count=1)
    assert count == 1, file
    path.write_text(text)
PY

cp extension/test/managed-worker-fixture.js "$snapshot/extension/test/"
cat > "$snapshot/extension/test/capture-byok.test.js" <<'JS'
import { expect, test } from 'bun:test';
import { captureByok } from './managed-worker-fixture.js';
import manifest from '../manifest.json';

test('capture both BYOK modes from the original worker', async () => {
  const cases = {};
  for (const [mode, gradual] of [['ordinary', false], ['gradual', true]]) {
    const { calls, ids, reply } = await captureByok({ version: manifest.version, gradual });
    expect(reply).toEqual({ results: { [ids[0]]: [] } });
    expect(calls).toHaveLength(2);
    const body = calls[0].body;
    expect(calls[1].body).toBe(body);
    cases[mode] = { calls: calls.map(({ body, ...request }) => request), body };
  }
  console.log('BYOK_BASELINE ' + JSON.stringify(cases));
});
JS

flock --close "$lock" nix develop --command bash -c '
  set -euo pipefail
  cd "$1"
  trap "bazel shutdown" EXIT
  bazel test --spawn_strategy=linux-sandbox --test_output=errors //:extension_test
  cp bazel-testlogs/extension_test/test.log "$1/bun.log"
' bash "$snapshot"

python3 - "$snapshot/bun.log" "$baseline" "$version" <<'PY'
import json
from pathlib import Path
import sys

log, baseline, version = sys.argv[1:]
prefix = "BYOK_BASELINE "
rows = [line.removeprefix(prefix) for line in Path(log).read_text().splitlines() if line.startswith(prefix)]
assert len(rows) == 1
capture = {"recordedFrom": baseline, "manifestVersion": version, "cases": json.loads(rows[0])}
path = Path(f"extension/test/byok-{version}-baseline.json")
path.write_text(json.dumps(capture, ensure_ascii=False, indent=2) + "\n")
print(f"Wrote {path}")
PY
