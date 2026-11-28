// Diagnostic only. A failed measurement must never fail the learning action.
// This top-level local key is not part of a learning backup.
export const MEASUREMENTS_SKIPPED_KEY = 'measurementsSkipped';
export const MAX_MEASUREMENTS_SKIPPED = 1000000;
let pending = 0;
let lastStored = 0;
let writes = Promise.resolve();
const bounded = (n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MEASUREMENTS_SKIPPED ? n : 0;

export async function noteMeasurementSkipped(storage, count = 1) {
  pending = Math.min(MAX_MEASUREMENTS_SKIPPED, pending + count);
  writes = writes.then(async () => {
    try {
      const raw = (await storage.get([MEASUREMENTS_SKIPPED_KEY]))[MEASUREMENTS_SKIPPED_KEY];
      lastStored = Math.max(lastStored, bounded(raw));
      const writing = pending;
      const total = Math.min(MAX_MEASUREMENTS_SKIPPED, lastStored + writing);
      await storage.set({ [MEASUREMENTS_SKIPPED_KEY]: total });
      lastStored = total;
      pending -= writing;
    } catch { /* pending survives a transient storage failure in this worker */ }
  });
  await writes;
}

export async function measurementsSkipped(storage) {
  await writes;
  try {
    const raw = (await storage.get([MEASUREMENTS_SKIPPED_KEY]))[MEASUREMENTS_SKIPPED_KEY];
    lastStored = Math.max(lastStored, bounded(raw));
  } catch { /* display the last known count plus this worker's pending count */ }
  return Math.min(MAX_MEASUREMENTS_SKIPPED, lastStored + pending);
}
