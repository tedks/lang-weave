// Diagnostic only. A failed measurement must never fail the learning action.
// This top-level local key is not part of a learning backup.
export const MEASUREMENTS_SKIPPED_KEY = 'measurementsSkipped';
export const MAX_MEASUREMENTS_SKIPPED = 1000000;
let pending = 0;
let lastStored = 0;
const bounded = (n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MEASUREMENTS_SKIPPED ? n : 0;

export async function noteMeasurementSkipped(storage, count = 1) {
  pending = Math.min(MAX_MEASUREMENTS_SKIPPED, pending + count);
  try {
    const raw = (await storage.get([MEASUREMENTS_SKIPPED_KEY]))[MEASUREMENTS_SKIPPED_KEY];
    lastStored = Math.max(lastStored, bounded(raw));
    const total = Math.min(MAX_MEASUREMENTS_SKIPPED, lastStored + pending);
    await storage.set({ [MEASUREMENTS_SKIPPED_KEY]: total });
    lastStored = total;
    pending = 0;
  } catch { /* pending survives a transient storage failure in this worker */ }
}

export async function measurementsSkipped(storage) {
  try {
    const raw = (await storage.get([MEASUREMENTS_SKIPPED_KEY]))[MEASUREMENTS_SKIPPED_KEY];
    lastStored = Math.max(lastStored, bounded(raw));
  } catch { /* display the last known count plus this worker's pending count */ }
  return Math.min(MAX_MEASUREMENTS_SKIPPED, lastStored + pending);
}
