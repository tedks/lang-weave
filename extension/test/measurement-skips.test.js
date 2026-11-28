import { test, expect } from 'bun:test';
test('refused measurements persist a bounded diagnostic and survive a failed write', async () => {
  const { MEASUREMENTS_SKIPPED_KEY, MAX_MEASUREMENTS_SKIPPED, measurementsSkipped,
    noteMeasurementSkipped } = await import('../src/measurement-skips.js?isolated-test');
  let saved = 0;
  let fail = false;
  const storage = {
    async get() { return { [MEASUREMENTS_SKIPPED_KEY]: saved }; },
    async set(value) { if (fail) throw new Error('storage unavailable'); saved = value[MEASUREMENTS_SKIPPED_KEY]; },
  };
  await noteMeasurementSkipped(storage);
  expect(await measurementsSkipped(storage)).toBe(1);
  fail = true;
  await noteMeasurementSkipped(storage, 2);
  expect(await measurementsSkipped(storage)).toBe(3);
  fail = false;
  await noteMeasurementSkipped(storage);
  expect(saved).toBe(4);
  await noteMeasurementSkipped(storage, MAX_MEASUREMENTS_SKIPPED);
  expect(await measurementsSkipped(storage)).toBe(MAX_MEASUREMENTS_SKIPPED);
});

test('overlapping refused measurements do not clear a later increment', async () => {
  const { measurementsSkipped, noteMeasurementSkipped } =
    await import('../src/measurement-skips.js?concurrent-test');
  let saved = 0;
  let releaseFirstWrite;
  let firstWriteStarted;
  const firstStarted = new Promise((resolve) => { firstWriteStarted = resolve; });
  const firstWrite = new Promise((resolve) => { releaseFirstWrite = resolve; });
  let writes = 0;
  const storage = {
    async get() { return { measurementsSkipped: saved }; },
    async set(value) {
      if (++writes === 1) { firstWriteStarted(); await firstWrite; }
      saved = value.measurementsSkipped;
    },
  };
  const first = noteMeasurementSkipped(storage);
  await firstStarted;
  const second = noteMeasurementSkipped(storage);
  releaseFirstWrite();
  await Promise.all([first, second]);
  expect(saved).toBe(2);
  expect(await measurementsSkipped(storage)).toBe(2);
});
