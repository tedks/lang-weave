import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger, createSqliteStorage, IDEMPOTENCY_MS, STALE_MS, sha256 } from '../src/ledger.js';
import { PRICE_ROWS } from '../src/pricing.js';
import { makeLedger } from './helpers.js';

const day = '2026-11-28';
const price = PRICE_ROWS[0].id;
const ceiling = 2_000_000;
const hash = (value = 'key') => sha256(value);
const body = hash('body');
const packMicros = 10_000_000;

test('reservations check unreserved balance, daily account costs, global costs, and both in-flight limits', () => {
  const { ledger, db, account } = makeLedger();
  try {
    const ids = Array.from({ length: 5 }, () => account(100).id);
    const reserve = (id, reader = 100, provider = 400_000, key = 'key') =>
      ledger.reserve(id, reader, provider, price, ceiling, hash(key), body);
    expect(reserve(ids[0], 101)).toBe('BALANCE');
    const first = reserve(ids[0], 100, 800_000);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(reserve(ids[0], 0, 10, 'other')).toBe('BUSY');
    const second = reserve(ids[1], 100, 800_000);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(reserve(ids[2], 100, 400_001)).toBe('CEILING');
    expect(reserve(ids[2], 100, 200_000)).toMatch(/^[0-9a-f]{32}$/);
    expect(reserve(ids[3], 100, 200_000)).toMatch(/^[0-9a-f]{32}$/);
    expect(reserve(ids[4], 1, 1)).toBe('BUSY');
    ledger.settle(first, 0, 800_000, 'stop');
    expect(reserve(ids[0], 100, 200_001, 'new')).toBe('DAILY_CAP');
    ledger.release(second);
    expect(reserve(ids[0], 100, 200_000, 'new')).toMatch(/^[0-9a-f]{32}$/);
  } finally { db.close(); }
});

test('settle, release and expiry return their winner and only debit once', () => {
  const { ledger, db, account, now, tick } = makeLedger();
  try {
    const { id } = account(500);
    const first = ledger.reserve(id, 100, 200, price, ceiling, hash(), body);
    expect(ledger.release(first)).toMatchObject({ state: 'released', costMicros: 0, providerActual: 0 });
    expect(ledger.settle(first, 100, 200, 'stop').state).toBe('released');
    const second = ledger.reserve(id, 100, 200, price, ceiling, hash('second'), body);
    const settled = ledger.settle(second, 300, 150, 'stop');
    expect(settled).toMatchObject({ state: 'settled', balanceMicros: 400, costMicros: 100, providerActual: 150 });
    expect(ledger.release(second)).toEqual({ ...settled, won: false });
    const stale = ledger.reserve(id, 60, 100, price, ceiling, hash('stale'), body);
    tick(STALE_MS);
    expect(ledger.expireStale(now())).toEqual([]);
    tick(1);
    const [winner] = ledger.expireStale(now());
    expect(winner).toMatchObject({ reservationId: stale, state: 'provisional', reason: 'timeout', costMicros: 60 });
    expect(ledger.expireStale(now())).toEqual([]);
    expect(ledger.release(stale)).toEqual({ ...winner, won: false });
    expect(ledger.settle(stale, 0, 0, 'stop')).toEqual({ ...winner, won: false });
  } finally { db.close(); }
});

test('idempotency claims are atomic and the 60 s clock starts at settlement', () => {
  const { ledger, db, account, now, tick } = makeLedger();
  try {
    const { id } = account(100);
    const reserve = (digest = body) => ledger.reserve(id, 20, 100, price, ceiling, hash(), digest);
    const first = reserve();
    tick(30_000);
    expect(reserve()).toMatchObject({ kind: 'BUSY' });
    expect(reserve(hash('other body'))).toMatchObject({ kind: 'KEY_REUSE' });
    expect(ledger.getIdempotency(id, hash()).expiresAt).toBeNull();
    ledger.settle(first, 20, 70, 'stop');
    expect(ledger.getIdempotency(id, hash())).toMatchObject({ expiresAt: now() + IDEMPOTENCY_MS, costMicros: 20 });
    tick(IDEMPOTENCY_MS - 1);
    expect(reserve()).toMatchObject({ kind: 'DUPLICATE', reservationId: first, charged: true });
    tick(1);
    expect(reserve()).not.toBe(first);
    expect(reserve()).toMatchObject({ kind: 'BUSY' });
  } finally { db.close(); }
});

test('provisional holds stay on the original day, reconcile once, and raise a global overage alarm', () => {
  const { ledger, db, account, tick } = makeLedger();
  try {
    const { id } = account(500);
    const first = ledger.reserve(id, 100, 200, price, 200, hash(), body);
    expect(ledger.settle(first, 0, null, 'prompt_blocked', { providerRequestId: 'remote-id' })).toMatchObject({
      dayKey: day, providerRequestId: 'remote-id', state: 'provisional', costMicros: 0, providerActual: null,
    });
    expect(ledger.reserve(id, 100, 1, price, 200, hash('next'), body)).toBe('CEILING');
    tick(86_400_000);
    const next = ledger.reserve(id, 100, 200, price, 200, hash('next'), body);
    expect(next).toMatch(/^[0-9a-f]{32}$/);
    ledger.release(next);
    expect(ledger.reconcileProviderRequest('unknown-id', 1)).toBeNull();
    expect(ledger.getReservation(first).providerActual).toBeNull();
    expect(ledger.reconcileProviderRequest('remote-id', 190))
      .toMatchObject({ providerActual: 190, overage: 0, costMicros: 0 });
    expect(ledger.reconcile(first, 201)).toMatchObject({ providerActual: 190, overage: 0 });
    const nextDay = ledger.reserve(id, 100, 200, price, 200, hash('second day'), body);
    ledger.settle(nextDay, 25, null, 'safety');
    expect(ledger.reconcile(nextDay, 201)).toMatchObject({ providerActual: 201, overage: 1, costMicros: 25 });
    expect(ledger.reserve(id, 0, 0, price, ceiling, hash('after overage'), body)).toBe('STOPPED');
  } finally { db.close(); }
});

test('known overage records the full cost while capping the debit and closes all admission', () => {
  const { ledger, db, account } = makeLedger();
  try {
    const { id } = account(100);
    const other = account(100).id;
    const first = ledger.reserve(id, 99, 10, price, ceiling, hash(), body);
    expect(ledger.settle(first, 120, 19, 'stop')).toMatchObject({ providerActual: 19, costMicros: 99, overage: 1 });
    expect(ledger.reserve(other, 1, 1, price, ceiling, hash(), body)).toBe('STOPPED');
    expect(ledger.clearStop('operator: verified correction')).toBeTrue();
    expect(ledger.reserve(other, 1, 1, price, ceiling, hash(), body)).toBe('STOPPED');
    expect(ledger.reconcile(first, 9)).toMatchObject({ providerActual: 9, overage: 1 });
    expect(ledger.reserve(other, 1, 1, price, ceiling, hash(), body)).toMatch(/^[a-f0-9]{32}$/);
  } finally { db.close(); }
});

test('adjust, refund and token changes preserve reserved credit; transfer follows the payment', () => {
  const { ledger, db, account } = makeLedger();
  try {
    const from = account();
    const to = account();
    const intent = 'pi_recovery';
    ledger.recordPayment({ paymentIntentId: intent, accountId: from.id, packMicros });
    ledger.grant(intent);
    const pending = ledger.reserve(from.id, 100, 200, price, ceiling, hash(), body);
    expect(ledger.transfer(from.id, to.id, 'recover')).toBe('BUSY');
    expect(ledger.adjust(from.id, -(packMicros + 1), 'correction', 'adj')).toMatchObject({ balanceMicros: 100, reservedMicros: 100 });
    expect(ledger.adjust(from.id, 1, 'correction', 'adj')).toBe('DUPLICATE');
    expect(ledger.revokeToken(from.tokenHash)).toBeTrue();
    expect(ledger.authenticate(from.tokenHash)).toBeNull();
    expect(ledger.reserve(from.id, 0, 0, price, ceiling, hash('revoked'), body, { tokenHash: from.tokenHash }))
      .toBe('UNAUTHORIZED');
    const token = ledger.rotateToken(from.id);
    expect(token).toMatch(/^lwk_[\w-]{43}$/);
    expect(ledger.authenticate(sha256(token))).toBe(from.id);
    expect(ledger.settle(pending, 75, 10, 'stop').costMicros).toBe(75);
    expect(ledger.transfer(from.id, to.id, 'recover').balanceMicros).toBe(25);
    expect(ledger.transfer(from.id, to.id, 'recover')).toBe('DUPLICATE');
    expect(ledger.authenticate(sha256(token))).toBeNull();
    ledger.recordPayment({ paymentIntentId: intent, accountId: from.id, packMicros });
    expect(ledger.reverse(intent, 40)).toMatchObject({ accountId: to.id, reversedMicros: 25, reversalTarget: 40 });
    expect(ledger.reverse(intent, 20)).toMatchObject({ reversedMicros: 25, reversalTarget: 40 });
    expect(ledger.getAccount(to.id)).toMatchObject({ balanceMicros: 0, frozenReason: 'reversal_loss' });
    expect(ledger.transfer(to.id, account().id, 'another')).toBe('FROZEN');
  } finally { db.close(); }
});

test('failed webhook transaction rolls back the event marker and mutation', () => {
  const { ledger, db, account } = makeLedger();
  try {
    const { id } = account();
    const payment = { paymentIntentId: 'pi_atomic', packMicros, accountId: id, checkoutSessionId: 'cs_atomic' };
    expect(() => ledger.applyPaymentEvent('evt_atomic', (tx) => {
      tx.recordPayment(payment);
      tx.grant(payment.paymentIntentId);
      throw new Error('fixture rollback');
    })).toThrow('fixture rollback');
    expect(ledger.getPayment(payment.paymentIntentId)).toBeNull();
    expect(ledger.getCheckoutDisposition(payment.checkoutSessionId)).toBeNull();
    expect(ledger.getAccount(id).balanceMicros).toBe(0);
    expect(ledger.applyPaymentEvent('evt_atomic', (tx) => tx.recordPayment(payment))).toBeTruthy();
    expect(ledger.applyPaymentEvent('evt_atomic', () => { throw new Error('duplicate ran'); })).toBeNull();
  } finally { db.close(); }
});

test('a file-backed adapter preserves claims across reopening SQLite', () => {
  const filename = join(mkdtempSync(join(tmpdir(), 'idempotency-')), 'ledger.sqlite');
  const now = () => Date.parse('2026-11-28T23:58:00Z');
  function withLedger(operation) {
    const db = createSqliteStorage(filename);
    try {
      return operation(createLedger(db, { now }));
    } finally {
      db.close();
    }
  }

  const id = withLedger((ledger) => {
    const accountId = ledger.createAccount(hash('fixture token'));
    ledger.setEnrolled(accountId);
    ledger.adjust(accountId, 100, 'fixture', 'fixture-ref');
    const reservation = ledger.reserve(accountId, 20, 30, price, ceiling, hash(), body);
    expect(ledger.settle(reservation, 20, 15, 'stop')).toMatchObject({ costMicros: 20 });
    return accountId;
  });
  withLedger((ledger) => {
    expect(ledger.getAccount(id)).toMatchObject({ balanceMicros: 80, reservedMicros: 0 });
    expect(ledger.reserve(id, 20, 30, price, ceiling, hash(), body)).toMatchObject({ kind: 'DUPLICATE', charged: true });
    expect(ledger.getIdempotency(id, hash())).toMatchObject({ costMicros: 20, expiresAt: now() + 60_000 });
  });
}, { timeout: 25_000 });

test('two connections arbitrate a same-day ceiling while one write transaction is open', async () => {
  const filename = join(mkdtempSync(join(tmpdir(), 'contention-')), 'ledger.sqlite');
  const at = Date.parse('2026-11-28T23:58:00Z');
  const store = createSqliteStorage(filename, { busyTimeoutMs: 0 });
  const ledger = createLedger(store, { now: () => at });
  const accounts = [ledger.createAccount(hash('first fixture')), ledger.createAccount(hash('second fixture'))];
  for (const id of accounts) {
    ledger.setEnrolled(id);
    ledger.adjust(id, 100, 'fixture', id);
  }

  const worker = new Worker(new URL('./fixtures/ledger-contender.js', import.meta.url), { type: 'module' });
  const began = Promise.withResolvers();
  const finished = Promise.withResolvers();
  worker.onmessage = ({ data }) => {
    if (data.holding) began.resolve();
    else finished.resolve(data);
  };
  worker.onerror = (err) => {
    began.reject(err);
    finished.reject(err);
  };
  const started = new SharedArrayBuffer(4);
  const latch = new Int32Array(started);
  function releaseWorker() {
    Atomics.store(latch, 0, 1);
    Atomics.notify(latch, 0);
  }
  try {
    worker.postMessage({ filename, at, id: accounts[0], priceRowId: price, keyHash: hash(), bodyHash: body, started });
    await began.promise;
    expect(ledger.lookupClaim(accounts[0], hash(), body)).toBeNull();
    const competingReserve = () => ledger.reserve(accounts[1], 60, 100_001, price, 1_000_000, hash(), body);
    expect(competingReserve).toThrow(/database is locked/);

    releaseWorker();
    const { reservationId } = await finished.promise;
    expect(competingReserve()).toBe('CEILING');
    expect(reservationId).toMatch(/^[a-f0-9]{32}$/);
    expect(ledger.getAccount(accounts[0])).toMatchObject({ balanceMicros: 100, reservedMicros: 60 });
    expect(ledger.getAccount(accounts[1])).toMatchObject({ balanceMicros: 100, reservedMicros: 0 });
    expect(ledger.lookupClaim(accounts[1], hash(), body)).toBeNull();
  } finally {
    releaseWorker();
    worker.terminate();
    store.close();
  }
}, { timeout: 25_000 });

test('an active price revision supersedes an overlapping row and a stale quote writes nothing', () => {
  const at = Date.parse('2026-11-29T12:00:00Z');
  const old = PRICE_ROWS[0];
  const revision = { ...old, id: 'fixture-revision', checkedOn: '2026-11-29', input: 40 };
  const { db, account, ledger } = makeLedger(at, { priceRows: [old, revision] });
  try {
    const { id } = account(100);
    const writes = () => db.transaction((tx) => tx.get('SELECT total_changes() AS count').count);
    const before = writes();
    expect(ledger.reserve(id, 1, 20, old.id, ceiling, hash(), body)).toBe('STALE_PRICE');
    expect(writes()).toBe(before);
    expect(ledger.lookupClaim(id, hash(), body)).toBeNull();
    expect(ledger.getActivePriceRow(old.model).id).toBe(revision.id);
    expect(ledger.reserve(id, 1, 20, revision.id, ceiling, hash(), body)).toMatch(/^[0-9a-f]{32}$/);
  } finally { db.close(); }
});

test('stale expiry recovers classified outcomes after the ledger and journal are reopened', () => {
  const filename = join(mkdtempSync(join(tmpdir(), 'outcomes-')), 'ledger.sqlite');
  let at = Date.parse('2026-11-28T23:58:00Z');
  const now = () => at;
  let store = createSqliteStorage(filename, { busyTimeoutMs: 0, now });
  const make = (onOverage = () => {}) => createLedger(store, { now, onOverage });
  const original = make();
  const accounts = [original.createAccount(hash('release-token')), original.createAccount(hash('settle-token'))];
  const ids = accounts.map((id) => {
    original.setEnrolled(id);
    original.adjust(id, 100, 'fixture', id);
    return original.reserve(id, 60, 100, price, ceiling, hash(), body);
  });
  const competingWriter = new Database(filename);
  try {
    competingWriter.exec('BEGIN IMMEDIATE');
    try {
      expect(() => original.release(ids[0], { reason: 'request_failed' })).toThrow(/database is locked/);
      expect(() => original.settle(ids[1], 70, 250, 'stop')).toThrow(/database is locked/);
      expect(store.finalizations.withSnapshot((receipts) => receipts.map((receipt) => receipt.reservationId).sort()))
        .toEqual([...ids].sort());
    } finally {
      competingWriter.exec('ROLLBACK');
    }
    store.close();
    at += STALE_MS + 1;
    store = createSqliteStorage(filename, { busyTimeoutMs: 0, now });
    const alarms = [];
    const restarted = make((alarm) => alarms.push(alarm));
    expect(restarted.expireStale()).toEqual([]);
    expect(restarted.getReservation(ids[0])).toMatchObject({ state: 'released', costMicros: 0, providerActual: 0 });
    expect(restarted.getReservation(ids[1])).toMatchObject({ state: 'settled', costMicros: 60, providerActual: 250, overage: 1 });
    expect(restarted.getAccount(accounts[0])).toMatchObject({ balanceMicros: 100, reservedMicros: 0 });
    expect(restarted.getAccount(accounts[1])).toMatchObject({ balanceMicros: 40, reservedMicros: 0 });
    expect(store.finalizations.withSnapshot((receipts) => receipts)).toEqual([]);
    expect(restarted.reserve(accounts[0], 1, 1, price, ceiling, hash('next'), body)).toBe('STOPPED');
    expect(alarms).toEqual([{ reason: 'overage', reservationId: ids[1] }]);
  } finally {
    competingWriter.close();
    store.close();
  }
}, { timeout: 25_000 });

test('recovery preserves an expiry winner while reconciling the journaled late outcome', () => {
  const filename = join(mkdtempSync(join(tmpdir(), 'expired-outcome-')), 'ledger.sqlite');
  let at = Date.parse('2026-11-28T23:58:00Z');
  const now = () => at;
  const store = createSqliteStorage(filename, { busyTimeoutMs: 0, now });
  const ledger = createLedger(store, { now, onOverage: () => {} });
  const competingWriter = new Database(filename);
  try {
    const id = ledger.createAccount(hash('fixture token'));
    ledger.setEnrolled(id);
    ledger.adjust(id, 100, 'fixture', 'credit');
    const reservationId = ledger.reserve(id, 60, 100, price, ceiling, hash(), body);
    at += STALE_MS + 1;
    expect(ledger.expireStale()[0]).toMatchObject({ reason: 'timeout', costMicros: 60 });
    competingWriter.exec('BEGIN IMMEDIATE');
    try {
      expect(() => ledger.settle(reservationId, 5, 40, 'stop', { providerRequestId: 'fixture-late-id' }))
        .toThrow(/database is locked/);
    } finally {
      competingWriter.exec('ROLLBACK');
    }
    expect(ledger.expireStale()).toEqual([]);
    expect(ledger.getReservation(reservationId)).toMatchObject({
      reason: 'timeout', costMicros: 60, providerActual: 40, providerRequestId: 'fixture-late-id', dayKey: day,
    });
    expect(ledger.getAccount(id).balanceMicros).toBe(40);
  } finally {
    competingWriter.close();
    store.close();
  }
}, { timeout: 25_000 });

test('export matching sees aliases in a durable receipt even before ledger finalization', () => {
  const filename = join(mkdtempSync(join(tmpdir(), 'pending-alias-')), 'ledger.sqlite');
  const now = () => Date.parse('2026-11-28T23:58:00Z');
  const store = createSqliteStorage(filename, { busyTimeoutMs: 0, now });
  const second = createSqliteStorage(filename, { busyTimeoutMs: 0, now });
  const ledger = createLedger(store, { now });
  const otherLedger = createLedger(second, { now });
  try {
    const ids = ['first', 'second'].map((fixture) => {
      const accountId = ledger.createAccount(hash(fixture));
      ledger.setEnrolled(accountId);
      ledger.adjust(accountId, 100, 'fixture', fixture);
      return ledger.reserve(accountId, 15, 200, price, ceiling, hash(), body);
    });
    ledger.settle(ids[0], 0, null, 'no_usage', { providerRequestId: 'shared-export-id' });
    store.transaction((tx) => {
      expect(() => otherLedger.settle(ids[1], 0, null, 'no_usage', { providerRequestId: 'shared-export-id' }))
        .toThrow(/database is locked/);
      expect(tx.get('SELECT COUNT(*) AS count FROM provider_request_ids WHERE requestId = ?', 'shared-export-id').count).toBe(1);
      expect(second.finalizations.withSnapshot((receipts) => receipts.map(({ kind }) => kind))).toEqual(['primary']);
    });

    expect(ledger.reconcileProviderRequest('shared-export-id', 55)).toBeNull();
    for (const id of ids) {
      expect(ledger.getReservation(id)).toMatchObject({ state: 'provisional', providerActual: null });
    }
    expect(second.finalizations.withSnapshot((receipts) => receipts)).toEqual([]);
  } finally {
    second.close();
    store.close();
  }
}, { timeout: 25_000 });

test('export matching sees an alias from late evidence still waiting on an open reservation', () => {
  const { db, ledger, account } = makeLedger();
  try {
    const provisional = ledger.reserve(account(100).id, 15, 200, price, ceiling, hash(), body);
    const open = ledger.reserve(account(100).id, 15, 200, price, ceiling, hash(), body);
    ledger.settle(provisional, 0, null, 'no_usage', { providerRequestId: 'shared-late-id' });
    db.finalizations.stageLate(open, { providerActual: 80, providerRequestId: 'shared-late-id' });
    expect(ledger.reconcileProviderRequest('shared-late-id', 55)).toBeNull();
    expect(ledger.getReservation(provisional).providerActual).toBeNull();
    expect(ledger.getReservation(open)).toMatchObject({ state: 'open', providerRequestId: 'shared-late-id' });
    expect(db.finalizations.withSnapshot((receipts) => receipts.map(({ kind }) => kind))).toEqual(['late']);
    expect(ledger.reserve(account(100).id, 15, 200, price, ceiling, hash(), body)).toBe('STOPPED');

    ledger.settle(open, 15, null, 'timeout');
    expect(ledger.expireStale()).toEqual([]);
    expect(ledger.getReservation(open)).toMatchObject({ state: 'provisional', providerActual: 80, costMicros: 15 });
    expect(db.finalizations.withSnapshot((receipts) => receipts)).toEqual([]);
  } finally { db.close(); }
});

test('an unrepresentable late reconcile keeps the day closed until a correction', () => {
  const { db, ledger, account } = makeLedger();
  try {
    const id = account(1_000).id;
    const reservationId = ledger.reserve(id, 20, 500, price, ceiling, hash(), body);
    ledger.settle(reservationId, 20, null, 'timeout');
    expect(ledger.reconcile(reservationId, 10_000_000_000_000_000n)).toMatchObject({
      providerActual: null, providerOverflowMicros: '10000000000000000', overage: 1, costMicros: 20,
    });
    expect(ledger.clearStop('fixture-reconcile-repair')).toBeTrue();
    expect(ledger.reserve(id, 20, 500, price, ceiling, hash('next'), body)).toBe('STOPPED');
    expect(ledger.reconcile(reservationId, 180)).toMatchObject({
      providerActual: 180, providerOverflowMicros: '10000000000000000', costMicros: 20,
    });
    expect(ledger.reserve(id, 20, 500, price, ceiling, hash('next'), body)).toMatch(/^[a-f0-9]{32}$/);
  } finally { db.close(); }
});
