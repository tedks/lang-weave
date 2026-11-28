import { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';

export function isSqliteBusy(error) {
  return typeof error?.code === 'string' && /^SQLITE_BUSY(?:_|$)/.test(error.code);
}

// The journal has its own SQLite file so a fact about a provider call can
// commit while another connection holds the balance ledger's write lock.
export function openFinalizationJournal(filename) {
  const journal = new Database(filename === ':memory:' ? filename : `${filename}.finalizations`, { strict: true });
  try {
    journal.exec(`
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS pending_finalizations (
        reservationId TEXT PRIMARY KEY,
        receiptId TEXT NOT NULL,
        outcome TEXT NOT NULL
      ) STRICT;
    `);
  } catch (error) {
    journal.close();
    throw error;
  }
  const add = journal.query('INSERT OR IGNORE INTO pending_finalizations VALUES (?, ?, ?)');
  const get = journal.query('SELECT * FROM pending_finalizations WHERE reservationId = ?');
  const all = journal.query('SELECT * FROM pending_finalizations');
  const remove = journal.query('DELETE FROM pending_finalizations WHERE reservationId = ? AND receiptId = ?');

  return {
    stage(id, outcome) {
      const { state, readerActual, providerActual, reason, providerRequestId, providerRequestIds, usage } = outcome;
      const encoded = JSON.stringify({
        state, readerActual, reason, providerRequestId, providerRequestIds,
        providerActual: typeof providerActual === 'bigint' ? providerActual.toString() : providerActual,
        usage: usage ? {
          promptTokenCount: usage.promptTokenCount,
          candidatesTokenCount: usage.candidatesTokenCount,
          thoughtsTokenCount: usage.thoughtsTokenCount,
        } : null,
      });
      return journal.transaction(() => {
        add.run(id, randomBytes(16).toString('hex'), encoded);
        const receipt = get.get(id);
        return { receipt, sameOutcome: receipt.outcome === encoded };
      }).immediate();
    },
    // Hold the committed journal snapshot through ledger admission or expiry.
    // Those paths acquire the journal before the ledger. A finalizer commits
    // its journal write before acquiring the ledger and acknowledges afterwards.
    withSnapshot(operation) {
      return journal.transaction(() => operation(all.all())).deferred();
    },
    acknowledge({ reservationId, receiptId }) {
      try {
        remove.run(reservationId, receiptId);
      } catch (error) {
        if (!isSqliteBusy(error)) throw error;
        // Recovery can retry the deletion. The ledger is already terminal.
      }
    },
    close() {
      journal.close();
    },
  };
}

export function finalizationOutcome(receipt) {
  const outcome = JSON.parse(receipt.outcome);
  if (typeof outcome.providerActual === 'string') outcome.providerActual = BigInt(outcome.providerActual);
  return outcome;
}
