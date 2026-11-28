import { createLedger, createSqliteStorage } from '../../src/ledger.js';

globalThis.onmessage = ({ data: { filename, at, id, priceRowId, keyHash, bodyHash, started } }) => {
  const storage = createSqliteStorage(filename);
  const latch = new Int32Array(started);
  const ledger = createLedger({
    transaction(operation) {
      return storage.transaction((tx) => {
        const result = operation(tx);
        globalThis.postMessage({ holding: true });
        Atomics.wait(latch, 0, 0);
        return result;
      });
    },
  }, { now: () => at, onOverage: () => {} });
  try {
    const reservationId = ledger.reserve(id, 60, 900_000, priceRowId, 1_000_000, keyHash, bodyHash);
    globalThis.postMessage({ reservationId });
  } catch {
    globalThis.postMessage({ error: 'fixture reservation failed' });
  } finally {
    storage.close();
  }
};
