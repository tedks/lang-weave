import { expect } from 'bun:test';
import { createLedger, createSqliteStorage, sha256 } from '../src/ledger.js';

export function makeLedger(at = Date.parse('2026-11-28T00:00:00Z')) {
  const db = createSqliteStorage();
  const storage = {
    transaction(operation) {
      return db.transaction((tx) => {
        const result = operation(tx);
        expect(tx.all(`
          SELECT accountId FROM accounts
          WHERE balanceMicros < reservedMicros OR reservedMicros < 0
             OR reservedMicros != COALESCE((
               SELECT SUM(readerWorst) FROM reservations
               WHERE reservations.accountId = accounts.accountId AND state = 'open'
             ), 0)
        `)).toEqual([]);
        return result;
      });
    },
  };
  const now = () => at;
  const ledger = createLedger(storage, { now });
  let sequence = 0;
  function account(balance = 0) {
    const tokenHash = sha256(`fixture-token-${++sequence}`);
    const id = ledger.createAccount(tokenHash);
    if (balance) ledger.adjust(id, balance, 'fixture', `fund-${sequence}`);
    return { id, tokenHash };
  }
  return { db, ledger, now, tick: (ms) => { at += ms; }, account };
}
