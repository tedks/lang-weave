import { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';

export function isSqliteBusy(error) {
  return typeof error?.code === 'string' && /^SQLITE_BUSY(?:_|$)/.test(error.code);
}

function encodeOutcome(outcome) {
  const { state, readerActual, providerActual, reason, providerRequestId, providerRequestIds, usage } = outcome;
  return JSON.stringify({
    state, readerActual, reason, providerRequestId, providerRequestIds,
    providerActual: typeof providerActual === 'bigint' ? providerActual.toString() : providerActual,
    usage: usage ? {
      promptTokenCount: usage.promptTokenCount,
      candidatesTokenCount: usage.candidatesTokenCount,
      thoughtsTokenCount: usage.thoughtsTokenCount,
    } : null,
  });
}

// This file can commit while another connection holds the ledger write lock.
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
      CREATE TABLE IF NOT EXISTS late_finalizations (
        receiptId INTEGER PRIMARY KEY AUTOINCREMENT,
        reservationId TEXT NOT NULL,
        outcome TEXT NOT NULL,
        UNIQUE (reservationId, outcome)
      ) STRICT;
    `);
  } catch (error) {
    journal.close();
    throw error;
  }
  const addPrimary = journal.query('INSERT OR IGNORE INTO pending_finalizations VALUES (?, ?, ?)');
  const getPrimary = journal.query('SELECT * FROM pending_finalizations WHERE reservationId = ?');
  const addLate = journal.query('INSERT OR IGNORE INTO late_finalizations (reservationId, outcome) VALUES (?, ?)');
  const primary = journal.query("SELECT *, 'primary' AS kind FROM pending_finalizations");
  const late = journal.query("SELECT *, 'late' AS kind FROM late_finalizations ORDER BY receiptId");
  const removePrimary = journal.query('DELETE FROM pending_finalizations WHERE reservationId = ? AND receiptId = ?');
  const removeLate = journal.query('DELETE FROM late_finalizations WHERE reservationId = ? AND receiptId = ?');

  return {
    stage(id, outcome) {
      const encoded = encodeOutcome(outcome);
      return journal.transaction(() => {
        addPrimary.run(id, randomBytes(16).toString('hex'), encoded);
        const receipt = getPrimary.get(id);
        return { receipt: { ...receipt, kind: 'primary' }, sameOutcome: receipt.outcome === encoded };
      }).immediate();
    },
    stageLate(id, outcome) {
      addLate.run(id, encodeOutcome(outcome));
    },
    // Hold the committed snapshot through the ledger transaction. Always
    // apply primary outcomes first, then late evidence in arrival order.
    withSnapshot(operation) {
      return journal.transaction(() => operation([...primary.all(), ...late.all()])).deferred();
    },
    acknowledge(receipts) {
      journal.transaction(() => {
        for (const { kind, reservationId, receiptId } of receipts) {
          const remove = kind === 'late' ? removeLate : removePrimary;
          remove.run(reservationId, receiptId);
        }
      }).immediate();
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
