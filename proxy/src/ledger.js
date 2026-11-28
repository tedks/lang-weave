import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { finalizationOutcome, openFinalizationJournal } from './finalizations.js';
import { activePriceRow, PRICE_ROWS, quotePriceRow, utcDay } from './pricing.js';

export const ACCOUNT_DAILY_PROVIDER_MAX = 1_000_000;
export const IN_FLIGHT_MAX = 4;
export const STALE_MS = 5 * 60_000;
export const IDEMPOTENCY_MS = 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const SIGNUP_LIMIT = 5;

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const newToken = () => `lwk_${randomBytes(32).toString('base64url')}`;

function newAccountId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let buffered = 0;
  let id = 'acct_';
  for (const byte of randomBytes(16)) {
    buffered = (buffered << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      id += alphabet[(buffered >>> bits) & 31];
    }
  }
  return id + alphabet[(buffered << (5 - bits)) & 31];
}

const schema = `
  CREATE TABLE IF NOT EXISTS accounts (
    accountId TEXT PRIMARY KEY,
    tokenHash TEXT UNIQUE,
    balanceMicros INTEGER NOT NULL DEFAULT 0,
    reservedMicros INTEGER NOT NULL DEFAULT 0,
    frozen INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0, 1)),
    frozenReason TEXT,
    CHECK ((frozen = 0 AND frozenReason IS NULL) OR (frozen = 1 AND frozenReason IS NOT NULL AND length(trim(frozenReason)) > 0)),
    CHECK (balanceMicros >= reservedMicros AND reservedMicros >= 0)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS enrolled_accounts (
    accountId TEXT PRIMARY KEY REFERENCES accounts
  ) STRICT;
  CREATE TABLE IF NOT EXISTS account_creations (
    ipDigest TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS creations_digest ON account_creations(ipDigest, createdAt);
  CREATE INDEX IF NOT EXISTS creations_expiry ON account_creations(createdAt);
  CREATE TABLE IF NOT EXISTS price_rows (
    id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    checkedOn TEXT NOT NULL,
    startsOn TEXT,
    endsBefore TEXT,
    input INTEGER NOT NULL CHECK (input >= 0),
    output INTEGER NOT NULL CHECK (output >= 0),
    modelMaxOutputTokens INTEGER NOT NULL CHECK (modelMaxOutputTokens >= 0),
    readerMarkup INTEGER NOT NULL CHECK (readerMarkup >= 1)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS prices_model ON price_rows(model);
  CREATE TABLE IF NOT EXISTS managed_stop (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    reservationId TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS stop_clearances (
    ref TEXT PRIMARY KEY,
    clearedAt INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS reservations (
    reservationId TEXT PRIMARY KEY,
    accountId TEXT NOT NULL REFERENCES accounts,
    dayKey TEXT NOT NULL,
    priceRowId TEXT NOT NULL REFERENCES price_rows,
    createdAt INTEGER NOT NULL,
    readerWorst INTEGER NOT NULL CHECK (readerWorst >= 0),
    providerMax INTEGER NOT NULL CHECK (providerMax >= 0),
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'settled', 'released', 'provisional')),
    costMicros INTEGER,
    balanceMicros INTEGER,
    providerActual INTEGER,
    providerOverflowMicros TEXT,
    providerOverflowPending INTEGER NOT NULL DEFAULT 0 CHECK (providerOverflowPending IN (0, 1)),
    appliedLateReceipt INTEGER NOT NULL DEFAULT 0,
    providerRequestId TEXT,
    model TEXT,
    promptTokens INTEGER,
    outputTokens INTEGER,
    thoughtTokens INTEGER,
    reason TEXT,
    settledAt INTEGER,
    overage INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS open_account
    ON reservations(accountId) WHERE state = 'open';
  CREATE INDEX IF NOT EXISTS reservation_day ON reservations(dayKey, accountId);
  CREATE TABLE IF NOT EXISTS provider_request_ids (
    reservationId TEXT NOT NULL REFERENCES reservations,
    requestId TEXT NOT NULL,
    PRIMARY KEY (requestId, reservationId)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS idempotency (
    accountId TEXT NOT NULL REFERENCES accounts,
    keyHash TEXT NOT NULL,
    bodyHash TEXT NOT NULL,
    reservationId TEXT NOT NULL UNIQUE REFERENCES reservations,
    expiresAt INTEGER,
    PRIMARY KEY (accountId, keyHash)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idempotency_expiry ON idempotency(expiresAt);
  CREATE TABLE IF NOT EXISTS payments (
    paymentIntentId TEXT PRIMARY KEY,
    checkoutSessionId TEXT,
    accountId TEXT,
    packMicros INTEGER NOT NULL CHECK (packMicros > 0),
    grantState TEXT NOT NULL DEFAULT 'pending' CHECK (grantState IN ('pending', 'granted', 'refused')),
    reversalTarget INTEGER NOT NULL DEFAULT 0 CHECK (reversalTarget BETWEEN 0 AND packMicros),
    reversedMicros INTEGER NOT NULL DEFAULT 0 CHECK (reversedMicros BETWEEN 0 AND reversalTarget),
    dispute TEXT NOT NULL DEFAULT 'none' CHECK (dispute IN ('none', 'open', 'won', 'lost')),
    paidMicros INTEGER,
    paidCurrency TEXT,
    paidMinor INTEGER,
    refundedMicros INTEGER NOT NULL DEFAULT 0,
    uncapturedRefundMicros INTEGER NOT NULL DEFAULT 0,
    pairedRefundedMicros INTEGER NOT NULL DEFAULT 0,
    grantDeferred INTEGER NOT NULL DEFAULT 0 CHECK (grantDeferred IN (0, 1)),
    refundedMinor INTEGER NOT NULL DEFAULT 0,
    disputeLostMicros INTEGER NOT NULL DEFAULT 0,
    disputeLostMinor INTEGER NOT NULL DEFAULT 0,
    disputeFreezeApplied INTEGER NOT NULL DEFAULT 0 CHECK (disputeFreezeApplied IN (0, 1))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS payment_account ON payments(accountId);
  CREATE TABLE IF NOT EXISTS payment_events (eventId TEXT PRIMARY KEY) STRICT;
  CREATE TABLE IF NOT EXISTS payment_diagnostics (
    eventId TEXT PRIMARY KEY REFERENCES payment_events,
    type TEXT NOT NULL,
    reason TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS checkout_dispositions (
    checkoutSessionId TEXT PRIMARY KEY,
    disposition TEXT NOT NULL CHECK (disposition IN ('granted', 'orphan')),
    paymentIntentId TEXT UNIQUE,
    eventId TEXT REFERENCES payment_events,
    paidMicros INTEGER,
    paidCurrency TEXT,
    paidMinor INTEGER,
    packMicros INTEGER NOT NULL,
    accountId TEXT,
    reason TEXT
  ) STRICT;
  CREATE TABLE IF NOT EXISTS orphan_settlements (
    ref TEXT PRIMARY KEY,
    checkoutSessionId TEXT NOT NULL REFERENCES checkout_dispositions
  ) STRICT;
  CREATE INDEX IF NOT EXISTS orphan_settlement_session ON orphan_settlements(checkoutSessionId);
  CREATE TABLE IF NOT EXISTS corrections (
    ref TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    accountId TEXT NOT NULL,
    toAccountId TEXT,
    deltaMicros INTEGER NOT NULL,
    reason TEXT
  ) STRICT;
`;

// The ledger requires a synchronous transaction that supplies get/all/run
// with SQLite-compatible SQL and positional parameters. A thrown operation
// rolls back the entire transaction, including webhook deduplication.
export function createSqliteStorage(filename = ':memory:', {
  priceRows = PRICE_ROWS, now = Date.now, busyTimeoutMs = 2000,
} = {}) {
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 2_147_483_647) {
    throw new RangeError('Invalid SQLite busy timeout');
  }
  const db = new Database(filename, { strict: true });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  const tx = {
    get: (sql, ...params) => db.query(sql).get(...params),
    all: (sql, ...params) => db.query(sql).all(...params),
    run: (sql, ...params) => db.query(sql).run(...params),
  };
  function transaction(operation, { readOnly = false } = {}) {
    const run = db.transaction(() => operation(tx));
    return readOnly ? run.deferred() : run.immediate();
  }

  let finalizations;
  try {
    transaction(() => {
      db.exec(schema);
      const columns = new Set(tx.all('PRAGMA table_info(reservations)').map(({ name }) => name));
      if (!columns.has('providerOverflowPending')) {
        tx.run(`ALTER TABLE reservations ADD COLUMN providerOverflowPending
          INTEGER NOT NULL DEFAULT 0 CHECK (providerOverflowPending IN (0, 1))`);
        tx.run(`UPDATE reservations SET providerOverflowPending = 1
          WHERE providerActual IS NULL AND providerOverflowMicros IS NOT NULL`);
      }
      if (!columns.has('appliedLateReceipt')) {
        tx.run('ALTER TABLE reservations ADD COLUMN appliedLateReceipt INTEGER NOT NULL DEFAULT 0');
      }
      for (const row of priceRows) {
        const values = [row.model, row.checkedOn, row.from ?? null, row.until ?? null, row.input, row.output,
          row.modelMaxOutputTokens, row.readerMarkup];
        tx.run(`
          INSERT OR IGNORE INTO price_rows
            (id, model, checkedOn, startsOn, endsBefore, input, output, modelMaxOutputTokens, readerMarkup)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, row.id, ...values);
        const saved = tx.get(`
          SELECT model, checkedOn, startsOn, endsBefore, input, output, modelMaxOutputTokens, readerMarkup
          FROM price_rows WHERE id = ?
        `, row.id);
        if (Object.values(saved).some((value, i) => value !== values[i])) throw new Error('Immutable price row changed');
      }
    });
    finalizations = openFinalizationJournal(filename);
  } catch (error) {
    db.close();
    throw error;
  }

  // One hour of history is sufficient for the limit. The periodic sweep
  // also drops inactive hashes when no further requests come in.
  const sweep = setInterval(() => {
    try {
      transaction((context) => context.run('DELETE FROM account_creations WHERE createdAt <= ?', now() - HOUR_MS));
    } catch {
      // A concurrent writer can defer housekeeping until the next sweep.
    }
  }, HOUR_MS);
  sweep.unref();
  return {
    transaction,
    finalizations,
    close() {
      clearInterval(sweep);
      finalizations.close();
      db.close();
    },
  };
}

function checkMicros(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError('Invalid micro-dollar amount');
}

function account(tx, accountId) {
  const row = tx.get('SELECT accountId, balanceMicros, reservedMicros, frozen, frozenReason FROM accounts WHERE accountId = ?', accountId);
  return row && { ...row, frozen: !!row.frozen };
}

function reservation(tx, id) {
  return tx.get('SELECT * FROM reservations WHERE reservationId = ?', id);
}

function payment(tx, id) {
  const row = tx.get('SELECT * FROM payments WHERE paymentIntentId = ?', id);
  return row && { ...row, disputeFreezeApplied: !!row.disputeFreezeApplied };
}

function claim(tx, accountId, keyHash, now) {
  return tx.get(`
    SELECT i.bodyHash, i.expiresAt, r.reservationId, r.state, r.costMicros
    FROM idempotency i JOIN reservations r USING (reservationId)
    WHERE i.accountId = ? AND i.keyHash = ? AND (i.expiresAt IS NULL OR i.expiresAt > ?)
  `, accountId, keyHash, now);
}

function claimResult(prior, bodyHash) {
  if (!prior) return null;
  const { reservationId, costMicros } = prior;
  if (prior.bodyHash !== bodyHash) return { kind: 'KEY_REUSE', reservationId };
  return prior.state === 'open' ? { kind: 'OPEN', reservationId }
    : { kind: 'DUPLICATE', reservationId, charged: costMicros > 0 };
}

function currentPrice(tx, model, day) {
  const rows = tx.all(`
    SELECT id, model, checkedOn, startsOn AS "from", endsBefore AS "until", input, output,
      modelMaxOutputTokens, readerMarkup
    FROM price_rows WHERE model = ?
  `, model);
  return activePriceRow(rows, model, day);
}

function isEnrolled(tx, id) {
  return !!tx.get('SELECT 1 FROM enrolled_accounts WHERE accountId = ?', id);
}

function validReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) throw new TypeError('A reason or operator reference is required');
}

function openStop(tx, id) {
  tx.run('INSERT OR IGNORE INTO managed_stop (singleton, reservationId) VALUES (1, ?)', id);
}

function changeBalance(tx, current, deltaMicros) {
  const balance = current.balanceMicros + deltaMicros;
  checkMicros(balance, current.reservedMicros);
  tx.run('UPDATE accounts SET balanceMicros = ? WHERE accountId = ?', balance, current.accountId);
}

function freeze(tx, id, reason) {
  validReason(reason);
  tx.run('UPDATE accounts SET frozen = 1, frozenReason = COALESCE(frozenReason, ?) WHERE accountId = ?', reason, id);
}

function recordPayment(tx, {
  paymentIntentId, packMicros, checkoutSessionId = null, accountId = null, dispute = 'none',
  paidCurrency = null, paidMicros = null, paidMinor = null, fromCheckout = false,
  refundedMicros = 0, refundedMinor = 0, uncapturedRefundMicros = 0, pairedRefundedMicros = 0,
  disputeLostMicros = 0, disputeLostMinor = 0,
}, eventId = null) {
  checkMicros(packMicros, 1);
  for (const amount of [paidMicros, paidMinor, refundedMicros, refundedMinor, uncapturedRefundMicros, pairedRefundedMicros,
    disputeLostMicros, disputeLostMinor]) {
    if (amount !== null) checkMicros(amount);
  }
  const prior = payment(tx, paymentIntentId);
  const currencyMatches = !prior?.paidCurrency || !paidCurrency || prior.paidCurrency === paidCurrency;
  if (!currencyMatches) {
    dispute = 'none';
    paidMicros = paidMinor = null;
    uncapturedRefundMicros = pairedRefundedMicros = 0;
    refundedMicros = refundedMinor = disputeLostMicros = disputeLostMinor = 0;
  }
  const paid = fromCheckout && currencyMatches;
  tx.run(`
    INSERT INTO payments (paymentIntentId, packMicros, checkoutSessionId, accountId, dispute, paidCurrency,
      paidMicros, paidMinor, refundedMicros, refundedMinor, uncapturedRefundMicros, pairedRefundedMicros,
      disputeLostMicros, disputeLostMinor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (paymentIntentId) DO UPDATE SET
      checkoutSessionId = COALESCE(payments.checkoutSessionId, excluded.checkoutSessionId),
      accountId = COALESCE(payments.accountId, excluded.accountId),
      dispute = CASE
        WHEN excluded.dispute = 'none' OR payments.dispute IN ('won', 'lost') THEN payments.dispute
        ELSE excluded.dispute
      END,
      paidCurrency = COALESCE(payments.paidCurrency, excluded.paidCurrency),
      paidMicros = CASE WHEN ? THEN COALESCE(excluded.paidMicros, payments.paidMicros)
        ELSE COALESCE(payments.paidMicros, excluded.paidMicros) END,
      paidMinor = CASE WHEN ? THEN COALESCE(excluded.paidMinor, payments.paidMinor)
        ELSE COALESCE(payments.paidMinor, excluded.paidMinor) END,
      refundedMicros = MAX(payments.refundedMicros, excluded.refundedMicros),
      refundedMinor = MAX(payments.refundedMinor, excluded.refundedMinor),
      uncapturedRefundMicros = MAX(payments.uncapturedRefundMicros, excluded.uncapturedRefundMicros),
      pairedRefundedMicros = MAX(payments.pairedRefundedMicros, excluded.pairedRefundedMicros),
      disputeLostMicros = CASE WHEN payments.dispute = 'won' THEN payments.disputeLostMicros
        ELSE MAX(payments.disputeLostMicros, excluded.disputeLostMicros) END,
      disputeLostMinor = CASE WHEN payments.dispute = 'won' THEN payments.disputeLostMinor
        ELSE MAX(payments.disputeLostMinor, excluded.disputeLostMinor) END
  `, paymentIntentId, packMicros, checkoutSessionId, accountId, dispute, paidCurrency,
  paidMicros, paidMinor, refundedMicros, refundedMinor, uncapturedRefundMicros, pairedRefundedMicros,
  disputeLostMicros, disputeLostMinor, Number(paid), Number(paid));

  let entry = payment(tx, paymentIntentId);
  // MK-06 uses the paid Checkout's total for missing captures. Both
  // values originate in Stripe cents, even though the ledger stores USD micros.
  if (entry.paidCurrency === 'usd' && entry.paidMicros > 0 && entry.uncapturedRefundMicros > 0) {
    const amountTotal = entry.paidMicros / 10_000;
    const amountRefunded = entry.uncapturedRefundMicros / 10_000;
    entry = reverse(tx, paymentIntentId, proportionalRefundTarget(entry.packMicros, amountTotal, amountRefunded));
  }
  if (entry.grantDeferred && entry.grantState === 'pending' && entry.dispute !== 'none') {
    return finishGrant(tx, entry, false, eventId, 'grant_refused');
  }
  const freezingEvent = dispute === 'open' || dispute === 'lost' && entry.dispute === 'lost';
  if (freezingEvent && entry.grantState === 'granted' && !entry.disputeFreezeApplied) {
    freeze(tx, entry.accountId, 'dispute');
    tx.run('UPDATE payments SET disputeFreezeApplied = 1 WHERE paymentIntentId = ?', paymentIntentId);
    return payment(tx, paymentIntentId);
  }
  return entry;
}

function checkoutDisposition(tx, checkoutSessionId) {
  return tx.get('SELECT * FROM checkout_dispositions WHERE checkoutSessionId = ?', checkoutSessionId);
}

function setDisposition(tx, checkoutSessionId, disposition, {
  paymentIntentId = null, eventId = null, reason = null, paidMicros = null, paidCurrency = null, paidMinor = null,
  packMicros, accountId = null,
} = {}) {
  if (!checkoutSessionId) return;
  tx.run(`
    INSERT INTO checkout_dispositions (checkoutSessionId, disposition, paymentIntentId, eventId, reason, paidMicros,
      paidCurrency, paidMinor, packMicros, accountId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (checkoutSessionId) DO NOTHING
  `, checkoutSessionId, disposition, paymentIntentId, eventId, reason, paidMicros, paidCurrency, paidMinor, packMicros, accountId);
}

function attachCheckoutIds(tx, { checkoutSessionId, paymentIntentId }) {
  const previous = checkoutDisposition(tx, checkoutSessionId);
  if (!previous) return false;
  if (previous.disposition !== 'orphan' || previous.paymentIntentId || !paymentIntentId) return true;
  const reservedSession = tx.get('SELECT checkoutSessionId FROM checkout_dispositions WHERE paymentIntentId = ?', paymentIntentId);
  const entry = payment(tx, paymentIntentId);
  if (reservedSession || entry?.grantState === 'granted' ||
      entry?.checkoutSessionId && entry.checkoutSessionId !== checkoutSessionId) return 'CONFLICT';
  if (previous.paidCurrency && entry?.paidCurrency && previous.paidCurrency !== entry.paidCurrency) return 'CONFLICT';

  tx.run('UPDATE checkout_dispositions SET paymentIntentId = ? WHERE checkoutSessionId = ?', paymentIntentId, checkoutSessionId);
  recordPayment(tx, {
    paymentIntentId, checkoutSessionId, packMicros: previous.packMicros, accountId: previous.accountId,
    paidCurrency: previous.paidCurrency, paidMicros: previous.paidMicros, paidMinor: previous.paidMinor, fromCheckout: true,
  });
  tx.run("UPDATE payments SET grantState = 'refused', grantDeferred = 0 WHERE paymentIntentId = ? AND grantState = 'pending'", paymentIntentId);
  return true;
}

function finishGrant(tx, entry, allowed, eventId, reason) {
  tx.run('UPDATE payments SET grantState = ?, grantDeferred = 0 WHERE paymentIntentId = ?',
    allowed ? 'granted' : 'refused', entry.paymentIntentId);
  setDisposition(tx, entry.checkoutSessionId, allowed ? 'granted' : 'orphan', {
    ...entry, eventId, reason,
  });
  return payment(tx, entry.paymentIntentId);
}

function grant(tx, id, eventId = null) {
  const entry = payment(tx, id);
  if (entry?.grantState !== 'pending') return entry;
  const current = account(tx, entry.accountId);
  const prior = checkoutDisposition(tx, entry.checkoutSessionId);
  const allowed = !prior && current && !current.frozen && isEnrolled(tx, current.accountId) &&
    (!entry.paidCurrency || entry.paidCurrency === 'usd') && entry.dispute === 'none' && current.balanceMicros < entry.packMicros;
  if (!allowed) return finishGrant(tx, entry, false, eventId, 'grant_refused');
  if (!entry.paidMicros && entry.uncapturedRefundMicros > entry.pairedRefundedMicros) {
    tx.run('UPDATE payments SET grantDeferred = 1 WHERE paymentIntentId = ?', id);
    return payment(tx, id);
  }
  changeBalance(tx, current, entry.packMicros - entry.reversalTarget);
  return finishGrant(tx, entry, true, eventId, null);
}

export function proportionalRefundTarget(packMicros, paid, refunded) {
  const denominator = BigInt(paid);
  return Number((BigInt(packMicros) * BigInt(Math.min(refunded, paid)) + denominator - 1n) / denominator);
}

function reverse(tx, id, target) {
  checkMicros(target, -Number.MAX_SAFE_INTEGER);
  const entry = payment(tx, id);
  if (!entry) return null;
  const cappedTarget = Math.max(entry.reversalTarget, Math.min(target, entry.packMicros));

  let debit = 0;
  if (entry.grantState === 'granted' && cappedTarget > entry.reversalTarget) {
    const current = account(tx, entry.accountId);
    const increase = cappedTarget - entry.reversalTarget;
    debit = Math.min(increase, current.balanceMicros - current.reservedMicros);
    changeBalance(tx, current, -debit);
    if (debit < increase) freeze(tx, entry.accountId, 'reversal_loss');
  }

  tx.run(`
    UPDATE payments SET reversalTarget = ?, reversedMicros = reversedMicros + ?
    WHERE paymentIntentId = ?
  `, cappedTarget, debit, id);
  return payment(tx, id);
}

function providerAmount(value) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new RangeError('Invalid provider amount');
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return { actual: null, overflow: value.toString() };
    return { actual: Number(value), overflow: null };
  }
  if (value !== null) checkMicros(value);
  return { actual: value, overflow: null };
}

function recordProviderIds(tx, id, { providerRequestId, providerRequestIds = [] }) {
  const ids = new Set([providerRequestId, ...providerRequestIds].filter(Boolean));
  for (const requestId of ids) {
    tx.run('INSERT OR IGNORE INTO provider_request_ids (reservationId, requestId) VALUES (?, ?)', id, requestId);
  }
  if (ids.size) {
    tx.run('UPDATE reservations SET providerRequestId = COALESCE(providerRequestId, ?) WHERE reservationId = ?',
      ids.values().next().value, id);
  }
}

function finish(tx, entry, {
  state, readerActual, providerActual, reason, now, providerRequestId, providerRequestIds, usage = null,
}) {
  if (!entry || entry.state !== 'open') return entry;
  const debit = Math.min(readerActual, entry.readerWorst);
  const { actual, overflow } = providerAmount(providerActual);
  const overage = !!overflow || actual > entry.providerMax;
  if (overage) openStop(tx, entry.reservationId);
  recordProviderIds(tx, entry.reservationId, { providerRequestId, providerRequestIds });
  tx.run('UPDATE accounts SET reservedMicros = reservedMicros - ?, balanceMicros = balanceMicros - ? WHERE accountId = ?',
    entry.readerWorst, debit, entry.accountId);
  const { balanceMicros } = account(tx, entry.accountId);
  tx.run(`
    UPDATE reservations SET state = ?, costMicros = ?, balanceMicros = ?, providerActual = ?,
      providerOverflowMicros = ?, providerOverflowPending = ?, reason = ?, settledAt = ?, overage = ?,
      promptTokens = ?, outputTokens = ?, thoughtTokens = ?
    WHERE reservationId = ?
  `, overflow ? 'provisional' : state, debit, balanceMicros, actual, overflow, Number(!!overflow), reason, now, Number(overage),
  usage?.promptTokenCount ?? null, usage?.candidatesTokenCount ?? null,
  usage?.thoughtsTokenCount ?? null, entry.reservationId);
  tx.run('UPDATE idempotency SET expiresAt = ? WHERE reservationId = ?', now + IDEMPOTENCY_MS, entry.reservationId);
  return reservation(tx, entry.reservationId);
}

function expireStale(tx, now) {
  const stale = tx.all("SELECT * FROM reservations WHERE state = 'open' AND createdAt < ?", now - STALE_MS);
  return stale.map((entry) => finish(tx, entry, {
    state: 'provisional', readerActual: entry.readerWorst, providerActual: null, reason: 'timeout', now,
  }));
}

function tryFinish(tx, entry, options) {
  if (!entry) return null;
  return { ...finish(tx, entry, options), won: entry.state === 'open' };
}

function reconcile(tx, entry, providerActual, { providerRequestId, providerRequestIds, usage = null } = {}) {
  if (!entry || entry.state === 'open') return entry;
  recordProviderIds(tx, entry.reservationId, { providerRequestId, providerRequestIds });
  const pending = entry.state === 'provisional' && entry.providerActual === null;
  const aboveBound = entry.providerActual > entry.providerMax;
  if (providerActual === null || (!pending && !aboveBound && !entry.providerOverflowPending)) {
    return reservation(tx, entry.reservationId);
  }
  const { actual, overflow } = providerAmount(providerActual);
  if (!entry.providerOverflowPending && aboveBound && actual === entry.providerActual) {
    return reservation(tx, entry.reservationId);
  }
  const newOverflow = overflow && !entry.providerOverflowPending;
  const overage = !!newOverflow || actual > entry.providerMax;
  if (overage) openStop(tx, entry.reservationId);
  tx.run(`
    UPDATE reservations SET providerActual = COALESCE(?, providerActual), overage = MAX(overage, ?),
      providerOverflowPending = ?,
      providerOverflowMicros = COALESCE(providerOverflowMicros, ?),
      promptTokens = COALESCE(?, promptTokens), outputTokens = COALESCE(?, outputTokens),
      thoughtTokens = COALESCE(?, thoughtTokens)
    WHERE reservationId = ?
  `, actual, Number(overage), Number(!!overflow), overflow, usage?.promptTokenCount ?? null, usage?.candidatesTokenCount ?? null,
  usage?.thoughtsTokenCount ?? null, entry.reservationId);
  return reservation(tx, entry.reservationId);
}

function applyFinalization(tx, prior, outcome, now) {
  const result = tryFinish(tx, prior, { ...outcome, now });
  if (!result || result.won) return result;
  recordProviderIds(tx, prior.reservationId, outcome);
  // Expiry could have won before this receipt was staged. Keep its reader
  // debit and apply the receipt as late evidence, never as a new charge.
  if (prior.state === 'provisional' && prior.providerActual === null) {
    return { ...reconcile(tx, prior, outcome.providerActual, outcome), won: false };
  }
  return reservation(tx, prior.reservationId);
}

function applyReceipts(tx, receipts, at, applied, alarms) {
  const pending = [];
  for (const receipt of receipts) {
    const { reservationId, kind } = receipt;
    const prior = reservation(tx, reservationId);
    if (!prior || (kind === 'late' && receipt.receiptId <= prior.appliedLateReceipt)) {
      applied.push(receipt);
      continue;
    }
    const outcome = finalizationOutcome(receipt);
    if (kind === 'late' && prior.state === 'open') {
      // IDs are attributable before settlement. Export matching must see
      // them even when the provider cost is waiting for the reader's result.
      recordProviderIds(tx, reservationId, outcome);
      pending.push(receipt);
      continue;
    }
    const entry = kind === 'late'
      ? reconcile(tx, prior, outcome.providerActual, outcome)
      : applyFinalization(tx, prior, outcome, at);
    if (kind === 'late') {
      // A retry after ledger commit must never replace a newer correction.
      tx.run('UPDATE reservations SET appliedLateReceipt = ? WHERE reservationId = ?', receipt.receiptId, reservationId);
    }
    if (entry.overage && !prior.overage) alarms.add(reservationId);
    applied.push(receipt);
  }
  return pending;
}

const dayCost = `
  SELECT COALESCE(SUM(CASE
    WHEN state = 'open' OR (state = 'provisional' AND providerActual IS NULL) THEN providerMax
    ELSE providerActual
  END), 0) AS total FROM reservations WHERE dayKey = ?
`;

// A null providerActual keeps providerMax held. The caller supplies the
// independent, already-classified reader amount from section 6.3.
export function createLedger(storage, {
  now = Date.now, onOverage = console.warn, onJournalError = console.warn,
} = {}) {
  const transaction = (operation, options) => storage.transaction(operation, options);
  function checkOverage(id, operation) {
    const result = transaction((tx) => {
      const previous = reservation(tx, id);
      const entry = operation(tx, previous);
      return { entry, alarm: !!entry?.overage && !previous?.overage };
    });
    if (result.alarm) onOverage({ reason: 'overage', reservationId: result.entry.reservationId });
    return result.entry;
  }
  function acknowledge(receipts) {
    if (!receipts.length) return;
    try {
      storage.finalizations.acknowledge(receipts);
    } catch {
      // The committed ledger wins. Unacknowledged receipts remain for replay.
      try { onJournalError({ reason: 'finalization_ack_failed' }); } catch {}
    }
  }
  function finalize(id, outcome) {
    const { receipt, sameOutcome } = storage.finalizations.stage(id, outcome);
    const result = checkOverage(id, (tx, prior) => tryFinish(tx, prior, { ...finalizationOutcome(receipt), now: now() }));
    // Losing to an unconfirmed provisional result does not change it.
    // Keep the evidence until explicit reconciliation or journal recovery.
    const needsReconciliation = result && !result.won && result.state === 'provisional' && result.providerActual === null;
    const hasAliases = outcome.providerRequestId || outcome.providerRequestIds?.length;
    if (!needsReconciliation && (!result || result.won || !hasAliases)) acknowledge([receipt]);
    return result && { ...result, won: result.won && sameOutcome };
  }

  function withAppliedReceipts(operation, at = now) {
    const applied = [];
    const alarms = new Set();
    const result = storage.finalizations.withSnapshot((receipts) => transaction((tx) => {
      const currentTime = at();
      const pending = applyReceipts(tx, receipts, currentTime, applied, alarms);
      return operation(tx, pending, currentTime, applied, alarms);
    }));
    acknowledge(applied);
    for (const reservationId of alarms) onOverage({ reason: 'overage', reservationId });
    return result;
  }

  return {
    createAccount(tokenHash, { digestForDay } = {}) {
      return transaction((tx) => {
        if (digestForDay) {
          const at = now();
          const digest = digestForDay(utcDay(at));
          const yesterday = digestForDay(utcDay(at - DAY_MS));
          const { count, earliest } = tx.get(`
            SELECT COUNT(*) AS count, MIN(createdAt) AS earliest FROM account_creations
            WHERE ipDigest IN (?, ?) AND createdAt > ?
          `, digest, yesterday, at - HOUR_MS);
          if (count >= SIGNUP_LIMIT) return { retryAfterMs: earliest + HOUR_MS - at };
          tx.run('DELETE FROM account_creations WHERE createdAt <= ?', at - HOUR_MS);
          tx.run('INSERT INTO account_creations (ipDigest, createdAt) VALUES (?, ?)', digest, at);
        }
        const id = newAccountId();
        tx.run('INSERT INTO accounts (accountId, tokenHash) VALUES (?, ?)', id, tokenHash);
        return id;
      });
    },
    setEnrolled(id, enrolled = true) {
      return transaction((tx) => enrolled
        ? tx.run('INSERT OR IGNORE INTO enrolled_accounts (accountId) VALUES (?)', id).changes > 0
        : tx.run('DELETE FROM enrolled_accounts WHERE accountId = ?', id).changes > 0);
    },
    clearStop(ref) {
      validReason(ref);
      return transaction((tx) => {
        if (!tx.run('INSERT OR IGNORE INTO stop_clearances (ref, clearedAt) VALUES (?, ?)', ref, now()).changes) return false;
        return tx.run('DELETE FROM managed_stop WHERE singleton = 1').changes > 0;
      });
    },
    getActivePriceRow(model) {
      return transaction((tx) => currentPrice(tx, model, utcDay(now())), { readOnly: true });
    },
    authenticate(tokenHash) {
      return transaction((tx) =>
        tx.get('SELECT accountId FROM accounts WHERE tokenHash = ?', tokenHash)?.accountId ?? null);
    },
    getAccount(id) {
      return withAppliedReceipts((tx) => account(tx, id));
    },
    getReservation(id) {
      return transaction((tx) => reservation(tx, id));
    },
    getPayment(id) {
      return transaction((tx) => payment(tx, id));
    },
    getPaymentDiagnostic(eventId) {
      return transaction((tx) => tx.get('SELECT * FROM payment_diagnostics WHERE eventId = ?', eventId));
    },
    getCheckoutDisposition(id) {
      return transaction((tx) => checkoutDisposition(tx, id));
    },
    getOrphanCheckout(id) {
      return transaction((tx) => {
        const disposition = checkoutDisposition(tx, id);
        if (!disposition) {
          const deferred = tx.get(`
            SELECT checkoutSessionId, paymentIntentId, accountId, paidMicros, packMicros
            FROM payments WHERE checkoutSessionId = ? AND grantState = 'pending' AND grantDeferred = 1
          `, id);
          return deferred ? { ...deferred, status: 'deferred', owedMicros: null } : null;
        }
        if (disposition.disposition !== 'orphan') return null;
        const entry = payment(tx, disposition.paymentIntentId);
        const paidCurrency = entry?.paidCurrency ?? disposition.paidCurrency;
        if (paidCurrency && paidCurrency !== 'usd') {
          const marked = tx.get('SELECT 1 FROM orphan_settlements WHERE checkoutSessionId = ? LIMIT 1', id);
          return { ...disposition, paidCurrency, paidMinor: entry?.paidMinor ?? disposition.paidMinor,
            paidMicros: null, refundedMinor: entry?.refundedMinor ?? 0, disputeLostMinor: entry?.disputeLostMinor ?? 0,
            status: marked ? 'settled' : 'manual', owedMicros: null };
        }
        const refundedMicros = entry?.refundedMicros ?? 0;
        const paidMicros = entry?.paidMicros ?? disposition.paidMicros;
        const owedMicros = paidMicros === null ? null
          : Math.max(0, paidMicros - refundedMicros - (entry?.disputeLostMicros ?? 0));
        const status = entry?.dispute === 'open' ? 'disputed' : owedMicros === 0 ? 'settled' : 'open';
        return { ...disposition, paidMicros, refundedMicros, status, owedMicros: status === 'open' ? owedMicros : null };
      });
    },
    linkOrphan(checkoutSessionId, paymentIntentId) {
      return withAppliedReceipts((tx) => {
        const previous = checkoutDisposition(tx, checkoutSessionId);
        if (previous?.disposition !== 'orphan') return 'NOT_ORPHAN';
        if (previous.paymentIntentId && previous.paymentIntentId !== paymentIntentId) return 'CONFLICT';
        attachCheckoutIds(tx, { checkoutSessionId, paymentIntentId });
        const linked = checkoutDisposition(tx, checkoutSessionId);
        return linked.paymentIntentId === paymentIntentId ? linked : 'CONFLICT';
      });
    },
    markOrphanSettled(id, ref) {
      validReason(ref);
      return transaction((tx) => {
        const orphan = tx.get(`
          SELECT c.checkoutSessionId, COALESCE(p.paidCurrency, c.paidCurrency) AS currency
          FROM checkout_dispositions c LEFT JOIN payments p USING (paymentIntentId)
          WHERE c.disposition = 'orphan' AND (c.checkoutSessionId = ? OR c.paymentIntentId = ?)
        `, id, id);
        if (!orphan) return 'NOT_ORPHAN';
        if (!orphan.currency || orphan.currency === 'usd') return 'NOT_MANUAL';
        return tx.run('INSERT OR IGNORE INTO orphan_settlements (ref, checkoutSessionId) VALUES (?, ?)',
          ref, orphan.checkoutSessionId).changes ? 'SETTLED' : 'DUPLICATE';
      });
    },
    getIdempotency(accountId, keyHash) {
      return transaction((tx) => claim(tx, accountId, keyHash, now()));
    },
    lookupClaim(accountId, keyHash, bodyHash) {
      return transaction((tx) => claimResult(claim(tx, accountId, keyHash, now()), bodyHash), { readOnly: true });
    },
    reserve(accountId, readerWorst, providerMax, priceRowId, ceiling, keyHash, bodyHash, {
      model, tokenHash, requestBytes, maxOutputTokens,
    } = {}) {
      checkMicros(ceiling);
      const priceRequest = requestBytes !== undefined;
      if (!priceRequest) {
        checkMicros(readerWorst);
        checkMicros(providerMax);
      }
      return withAppliedReceipts((tx, pending, at) => {
        if (tokenHash && !tx.get('SELECT 1 FROM accounts WHERE accountId = ? AND tokenHash = ?', accountId, tokenHash)) {
          return 'UNAUTHORIZED';
        }
        const prior = claimResult(claim(tx, accountId, keyHash, at), bodyHash);
        if (prior) return prior.kind === 'OPEN' ? { ...prior, kind: 'BUSY' } : prior;

        // Only trusted ledger callers may supply precomputed C2 amounts.
        // Authenticated API requests always use the row read here.
        if (tokenHash && !priceRequest) return 'NO_PRICE';

        const dayKey = utcDay(at);
        if (tx.get('SELECT 1 FROM managed_stop WHERE singleton = 1') || pending.length) return 'STOPPED';
        const quotedModel = model ?? tx.get('SELECT model FROM price_rows WHERE id = ?', priceRowId)?.model ?? null;
        const priceRow = currentPrice(tx, quotedModel, dayKey);
        if (priceRowId && priceRow?.id !== priceRowId) return 'STALE_PRICE';
        if (!priceRow) return 'NO_PRICE';
        if (tx.get(`
          SELECT 1 FROM reservations
          WHERE dayKey = ? AND (providerActual > providerMax OR providerOverflowPending = 1)
          LIMIT 1
        `, dayKey)) return 'STOPPED';
        if (priceRequest) {
          const quote = quotePriceRow(priceRow, requestBytes, maxOutputTokens);
          if (quote === 'NO_PRICE') return quote;
          readerWorst = quote.readerMicros;
          providerMax = quote.providerMax;
        }
        if (!isEnrolled(tx, accountId)) return 'STOPPED';
        const current = account(tx, accountId);
        if (current.frozen) return 'FROZEN';
        if (tx.get("SELECT 1 FROM reservations WHERE accountId = ? AND state = 'open'", accountId) ||
            tx.get("SELECT COUNT(*) AS count FROM reservations WHERE state = 'open'").count >= IN_FLIGHT_MAX) return 'BUSY';
        if (current.balanceMicros - current.reservedMicros < readerWorst) return 'BALANCE';
        const accountTotal = tx.get(`${dayCost} AND accountId = ?`, dayKey, accountId).total;
        if (providerMax > ACCOUNT_DAILY_PROVIDER_MAX - accountTotal) return 'DAILY_CAP';
        if (providerMax > ceiling - tx.get(dayCost, dayKey).total) return 'CEILING';

        const id = randomBytes(16).toString('hex');
        tx.run('DELETE FROM idempotency WHERE expiresAt <= ?', at);
        tx.run(`
          INSERT INTO reservations (reservationId, accountId, dayKey, priceRowId, createdAt, readerWorst, providerMax, model)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, id, accountId, dayKey, priceRow.id, at, readerWorst, providerMax, quotedModel);
        tx.run('INSERT INTO idempotency (accountId, keyHash, bodyHash, reservationId) VALUES (?, ?, ?, ?)',
          accountId, keyHash, bodyHash, id);
        tx.run('UPDATE accounts SET reservedMicros = reservedMicros + ? WHERE accountId = ?', readerWorst, accountId);
        return priceRequest ? { kind: 'RESERVED', reservationId: id, priceRow, readerWorst } : id;
      });
    },
    settle(id, readerActual, providerActual, reason, { providerRequestId, providerRequestIds, usage = null } = {}) {
      checkMicros(readerActual);
      providerAmount(providerActual);
      return finalize(id, {
        state: providerActual === null ? 'provisional' : 'settled',
        readerActual, providerActual, reason, providerRequestId, providerRequestIds, usage,
      });
    },
    release(id, { providerRequestId, providerRequestIds, reason = 'release' } = {}) {
      return finalize(id, {
        state: 'released', readerActual: 0, providerActual: 0, reason, providerRequestId, providerRequestIds,
      });
    },
    expireStale(at = now()) {
      return withAppliedReceipts((tx, pending, currentTime, applied, alarms) => {
        const expired = expireStale(tx, currentTime);
        if (expired.length && pending.length) applyReceipts(tx, pending, currentTime, applied, alarms);
        return expired;
      }, () => at);
    },
    // Direct reconciliation is for evidence already attributed to this request.
    reconcile(id, providerActual, details = {}) {
      providerAmount(providerActual);
      storage.finalizations.stageLate(id, { ...details, providerActual });
      return withAppliedReceipts((tx) => reservation(tx, id));
    },
    reconcileProviderRequest(providerRequestId, providerActual) {
      checkMicros(providerActual);
      return withAppliedReceipts((tx, _pending, _at, _applied, alarms) => {
        const matches = tx.all(`
          SELECT r.* FROM provider_request_ids i JOIN reservations r USING (reservationId)
          WHERE i.requestId = ? LIMIT 2
        `, providerRequestId);
        if (matches.length !== 1 || matches[0].state === 'open') return null;
        const result = reconcile(tx, matches[0], providerActual);
        if (result.overage && !matches[0].overage) alarms.add(result.reservationId);
        return result;
      });
    },
    recordPayment(input) {
      return withAppliedReceipts((tx) => recordPayment(tx, input));
    },
    grant(id) {
      return withAppliedReceipts((tx) => grant(tx, id));
    },
    reverse(id, target) {
      return withAppliedReceipts((tx) => reverse(tx, id, target));
    },
    freeze(id, reason) {
      return transaction((tx) => freeze(tx, id, reason));
    },
    unfreeze(id, ref) {
      validReason(ref);
      return transaction((tx) => {
        if (tx.get('SELECT 1 FROM corrections WHERE ref = ?', ref)) return false;
        const changed = tx.run('UPDATE accounts SET frozen = 0, frozenReason = NULL WHERE accountId = ? AND frozen = 1', id);
        if (!changed.changes) return false;
        tx.run("INSERT INTO corrections (ref, kind, accountId, deltaMicros) VALUES (?, 'unfreeze', ?, 0)", ref, id);
        return true;
      });
    },
    applyPaymentEvent(id, operation) {
      return withAppliedReceipts((tx) => {
        if (!tx.run('INSERT OR IGNORE INTO payment_events (eventId) VALUES (?)', id).changes) return null;
        return operation({
          recordPayment: (input) => recordPayment(tx, input, id),
          grant: (paymentId) => grant(tx, paymentId, id),
          refuse(paymentId, reason) {
            const entry = payment(tx, paymentId);
            return entry?.grantState === 'pending' ? finishGrant(tx, entry, false, id, reason) : entry;
          },
          isEnrolled: (accountId) => isEnrolled(tx, accountId),
          reverse: (paymentId, target) => reverse(tx, paymentId, target),
          freeze: (accountId, reason) => freeze(tx, accountId, reason),
          recordDiagnostic(type, reason) {
            return tx.run('INSERT INTO payment_diagnostics (eventId, type, reason) VALUES (?, ?, ?)', id, type, reason);
          },
          attachCheckoutIds: (checkout) => attachCheckoutIds(tx, checkout),
          recordOrphanCheckout(checkoutSessionId, facts) {
            setDisposition(tx, checkoutSessionId, 'orphan', { eventId: id, ...facts });
          },
        });
      });
    },
    adjust(id, deltaMicros, reason, ref) {
      checkMicros(deltaMicros, -Number.MAX_SAFE_INTEGER);
      return withAppliedReceipts((tx) => {
        if (tx.get('SELECT 1 FROM corrections WHERE ref = ?', ref)) return 'DUPLICATE';
        const current = account(tx, id);
        if (!current) return 'UNKNOWN_ACCOUNT';
        const delta = Math.max(deltaMicros, current.reservedMicros - current.balanceMicros);
        changeBalance(tx, current, delta);
        tx.run("INSERT INTO corrections (ref, kind, accountId, deltaMicros, reason) VALUES (?, 'adjust', ?, ?, ?)",
          ref, id, delta, reason);
        return account(tx, id);
      });
    },
    transfer(from, to, ref) {
      return withAppliedReceipts((tx) => {
        if (tx.get('SELECT 1 FROM corrections WHERE ref = ?', ref)) return 'DUPLICATE';
        const source = account(tx, from);
        const destination = account(tx, to);
        if (!source || !destination || from === to) return 'UNKNOWN_ACCOUNT';
        if (source.frozen || destination.frozen) return 'FROZEN';
        if (!isEnrolled(tx, to)) return 'STOPPED';
        if (tx.get("SELECT 1 FROM reservations WHERE accountId = ? AND state = 'open'", from)) return 'BUSY';
        changeBalance(tx, destination, source.balanceMicros);
        tx.run("UPDATE accounts SET balanceMicros = 0, tokenHash = NULL, frozen = 1, frozenReason = 'transfer' WHERE accountId = ?", from);
        tx.run('UPDATE payments SET accountId = ? WHERE accountId = ?', to, from);
        tx.run("INSERT INTO corrections (ref, kind, accountId, toAccountId, deltaMicros) VALUES (?, 'transfer', ?, ?, ?)",
          ref, from, to, source.balanceMicros);
        return account(tx, to);
      });
    },
    revokeToken(tokenHash) {
      return transaction((tx) => tx.run('UPDATE accounts SET tokenHash = NULL WHERE tokenHash = ?', tokenHash).changes > 0);
    },
    rotateToken(id) {
      return transaction((tx) => {
        const token = newToken();
        return tx.run('UPDATE accounts SET tokenHash = ? WHERE accountId = ?', sha256(token), id).changes ? token : null;
      });
    },
  };
}
