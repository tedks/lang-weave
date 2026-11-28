import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger, createSqliteStorage, IDEMPOTENCY_MS, STALE_MS, sha256 } from '../src/ledger.js';
import { makeLedger } from './helpers.js';

const day = '2026-11-28';
const tomorrow = '2026-11-29';
const ceiling = 2_000_000;
const hash = (value = 'key') => sha256(value);
const body = hash('body');
const packMicros = 10_000_000;

test('reservations check unreserved balance, daily account costs, global costs, and both in-flight limits', () => {
  const { ledger, db, account } = makeLedger();
  try {
    const ids = Array.from({ length: 5 }, () => account(100).id);
    const reserve = (id, reader = 100, provider = 400_000, key = 'key') =>
      ledger.reserve(id, reader, provider, day, ceiling, hash(key), body);
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
    const first = ledger.reserve(id, 100, 200, day, ceiling, hash(), body);
    expect(ledger.release(first)).toMatchObject({ state: 'released', costMicros: 0, providerActual: 0 });
    expect(ledger.settle(first, 100, 200, 'stop').state).toBe('released');
    const second = ledger.reserve(id, 100, 200, day, ceiling, hash('second'), body);
    const settled = ledger.settle(second, 300, 150, 'stop');
    expect(settled).toMatchObject({ state: 'settled', balanceMicros: 400, costMicros: 100, providerActual: 150 });
    expect(ledger.release(second)).toEqual(settled);
    const stale = ledger.reserve(id, 60, 100, day, ceiling, hash('stale'), body);
    tick(STALE_MS);
    expect(ledger.expireStale(now())).toEqual([]);
    tick(1);
    const [winner] = ledger.expireStale(now());
    expect(winner).toMatchObject({ reservationId: stale, state: 'provisional', reason: 'timeout', costMicros: 60 });
    expect(ledger.expireStale(now())).toEqual([]);
    expect(ledger.release(stale)).toEqual(winner);
  } finally { db.close(); }
});

test('idempotency claims are atomic and the 60 s clock starts at settlement', () => {
  const { ledger, db, account, now, tick } = makeLedger();
  try {
    const { id } = account(100);
    const reserve = (digest = body) => ledger.reserve(id, 20, 100, day, ceiling, hash(), digest);
    const first = reserve();
    tick(30_000);
    expect(reserve()).toBe('BUSY');
    expect(reserve(hash('other body'))).toBe('KEY_REUSE');
    expect(ledger.getIdempotency(id, hash()).expiresAt).toBeNull();
    ledger.settle(first, 20, 70, 'stop');
    expect(ledger.getIdempotency(id, hash())).toMatchObject({ expiresAt: now() + IDEMPOTENCY_MS, costMicros: 20 });
    tick(IDEMPOTENCY_MS - 1);
    expect(reserve()).toBe('DUPLICATE');
    tick(1);
    expect(reserve()).not.toBe(first);
    expect(reserve()).toBe('BUSY');
  } finally { db.close(); }
});

test('provisional holds stay on the original day, reconcile once, and raise a global overage alarm', () => {
  const { ledger, db, account } = makeLedger();
  try {
    const { id } = account(500);
    const first = ledger.reserve(id, 100, 200, day, 200, hash(), body);
    expect(ledger.settle(first, 0, null, 'prompt_blocked', { providerRequestId: 'remote-id' })).toMatchObject({
      dayKey: day, providerRequestId: 'remote-id', state: 'provisional', costMicros: 0, providerActual: null,
    });
    expect(ledger.reserve(id, 100, 1, day, 200, hash('next'), body)).toBe('CEILING');
    const next = ledger.reserve(id, 100, 200, tomorrow, 200, hash('next'), body);
    expect(next).toMatch(/^[0-9a-f]{32}$/);
    ledger.release(next);
    expect(ledger.reconcileProviderRequest('unknown-id', 1)).toBeNull();
    expect(ledger.getReservation(first).providerActual).toBeNull();
    expect(ledger.reconcileProviderRequest('remote-id', 190))
      .toMatchObject({ providerActual: 190, overage: 0, costMicros: 0 });
    expect(ledger.reconcile(first, 201)).toMatchObject({ providerActual: 190, overage: 0 });
    const nextDay = ledger.reserve(id, 100, 200, tomorrow, 200, hash('second day'), body);
    ledger.settle(nextDay, 25, null, 'safety');
    expect(ledger.reconcile(nextDay, 201)).toMatchObject({ providerActual: 201, overage: 1, costMicros: 25 });
    expect(ledger.reserve(id, 0, 0, day, ceiling, hash('after overage'), body)).toBe('CEILING');
  } finally { db.close(); }
});

test('known overage records the full cost while capping the debit and closes all admission', () => {
  const { ledger, db, account } = makeLedger();
  try {
    const { id } = account(100);
    const other = account(100).id;
    const first = ledger.reserve(id, 99, 10, day, ceiling, hash(), body);
    expect(ledger.settle(first, 120, 19, 'stop')).toMatchObject({ providerActual: 19, costMicros: 99, overage: 1 });
    expect(ledger.reserve(other, 1, 1, tomorrow, ceiling, hash(), body)).toBe('CEILING');
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
    const pending = ledger.reserve(from.id, 100, 200, day, ceiling, hash(), body);
    expect(ledger.transfer(from.id, to.id, 'recover')).toBe('BUSY');
    expect(ledger.adjust(from.id, -(packMicros + 1), 'correction', 'adj')).toMatchObject({ balanceMicros: 100, reservedMicros: 100 });
    expect(ledger.adjust(from.id, 1, 'correction', 'adj')).toBe('DUPLICATE');
    expect(ledger.revokeToken(from.tokenHash)).toBeTrue();
    expect(ledger.authenticate(from.tokenHash)).toBeNull();
    expect(ledger.reserve(from.id, 0, 0, day, ceiling, hash('revoked'), body, { tokenHash: from.tokenHash }))
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
    ledger.adjust(accountId, 100, 'fixture', 'fixture-ref');
    const reservation = ledger.reserve(accountId, 20, 30, day, ceiling, hash(), body);
    expect(ledger.settle(reservation, 20, 15, 'stop')).toMatchObject({ costMicros: 20 });
    return accountId;
  });
  withLedger((ledger) => {
    expect(ledger.getAccount(id)).toMatchObject({ balanceMicros: 80, reservedMicros: 0 });
    expect(ledger.reserve(id, 20, 30, day, ceiling, hash(), body)).toBe('DUPLICATE');
    expect(ledger.getIdempotency(id, hash())).toMatchObject({ costMicros: 20, expiresAt: now() + 60_000 });
  });
});
