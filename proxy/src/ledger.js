import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';

export const ACCOUNT_DAILY_PROVIDER_MAX = 1_000_000;
export const IN_FLIGHT_MAX = 4;
export const STALE_MS = 5 * 60_000;
export const IDEMPOTENCY_MS = 60_000;

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
    frozenReason TEXT,
    CHECK (balanceMicros >= reservedMicros AND reservedMicros >= 0)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS reservations (
    reservationId TEXT PRIMARY KEY,
    accountId TEXT NOT NULL REFERENCES accounts,
    dayKey TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    readerWorst INTEGER NOT NULL CHECK (readerWorst >= 0),
    providerMax INTEGER NOT NULL CHECK (providerMax >= 0),
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'settled', 'released', 'provisional')),
    costMicros INTEGER,
    balanceMicros INTEGER,
    providerActual INTEGER,
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
  CREATE INDEX IF NOT EXISTS reservation_request ON reservations(providerRequestId);
  CREATE INDEX IF NOT EXISTS overage_alarm ON reservations(overage) WHERE overage = 1;
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
    customerId TEXT,
    accountId TEXT,
    packMicros INTEGER NOT NULL CHECK (packMicros > 0),
    grantState TEXT NOT NULL DEFAULT 'pending' CHECK (grantState IN ('pending', 'granted', 'refused')),
    reversalTarget INTEGER NOT NULL DEFAULT 0 CHECK (reversalTarget BETWEEN 0 AND packMicros),
    reversedMicros INTEGER NOT NULL DEFAULT 0 CHECK (reversedMicros BETWEEN 0 AND reversalTarget),
    dispute TEXT NOT NULL DEFAULT 'none' CHECK (dispute IN ('none', 'open', 'won', 'lost')),
    paidMicros INTEGER,
    refundedMicros INTEGER NOT NULL DEFAULT 0
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
    paymentIntentId TEXT,
    customerId TEXT,
    eventId TEXT REFERENCES payment_events,
    paidMicros INTEGER,
    reason TEXT
  ) STRICT;
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
export function createSqliteStorage(filename = ':memory:') {
  const db = new Database(filename, { strict: true });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  const tx = {
    get: (sql, ...params) => db.query(sql).get(...params),
    all: (sql, ...params) => db.query(sql).all(...params),
    run: (sql, ...params) => db.query(sql).run(...params),
  };
  return {
    transaction: (operation) => db.transaction(() => operation(tx)).immediate(),
    close: () => db.close(),
  };
}

function checkMicros(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError('Invalid micro-dollar amount');
}

function account(tx, accountId) {
  return tx.get('SELECT accountId, balanceMicros, reservedMicros, frozenReason FROM accounts WHERE accountId = ?', accountId);
}

function reservation(tx, id) {
  return tx.get('SELECT * FROM reservations WHERE reservationId = ?', id);
}

function payment(tx, id) {
  return tx.get('SELECT * FROM payments WHERE paymentIntentId = ?', id);
}

function claim(tx, accountId, keyHash, now) {
  return tx.get(`
    SELECT i.bodyHash, i.expiresAt, r.reservationId, r.state, r.costMicros
    FROM idempotency i JOIN reservations r USING (reservationId)
    WHERE i.accountId = ? AND i.keyHash = ? AND (i.expiresAt IS NULL OR i.expiresAt > ?)
  `, accountId, keyHash, now);
}

function changeBalance(tx, current, deltaMicros) {
  const balance = current.balanceMicros + deltaMicros;
  checkMicros(balance, current.reservedMicros);
  tx.run('UPDATE accounts SET balanceMicros = ? WHERE accountId = ?', balance, current.accountId);
}

function freeze(tx, id, reason) {
  tx.run('UPDATE accounts SET frozenReason = COALESCE(frozenReason, ?) WHERE accountId = ?', reason, id);
}

function recordPayment(tx, {
  paymentIntentId, packMicros, checkoutSessionId = null, customerId = null, accountId = null, dispute = 'none',
  paidMicros = null,
}) {
  checkMicros(packMicros, 1);
  tx.run(`
    INSERT INTO payments (paymentIntentId, packMicros, checkoutSessionId, customerId, accountId, dispute, paidMicros)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (paymentIntentId) DO UPDATE SET
      checkoutSessionId = COALESCE(payments.checkoutSessionId, excluded.checkoutSessionId),
      customerId = COALESCE(payments.customerId, excluded.customerId),
      accountId = COALESCE(payments.accountId, excluded.accountId),
      dispute = CASE
        WHEN excluded.dispute = 'none' OR payments.dispute IN ('won', 'lost') THEN payments.dispute
        ELSE excluded.dispute
      END,
      paidMicros = COALESCE(payments.paidMicros, excluded.paidMicros)
  `, paymentIntentId, packMicros, checkoutSessionId, customerId, accountId, dispute, paidMicros);
  const entry = payment(tx, paymentIntentId);
  if (entry.packMicros !== packMicros) throw new Error('Payment pack changed');
  if (dispute === 'open' && entry.grantState === 'granted') freeze(tx, entry.accountId, 'dispute');
  return entry;
}

function checkoutDisposition(tx, checkoutSessionId) {
  return tx.get('SELECT * FROM checkout_dispositions WHERE checkoutSessionId = ?', checkoutSessionId);
}

function setDisposition(tx, checkoutSessionId, disposition, {
  paymentIntentId = null, customerId = null, eventId = null, reason = null, paidMicros = null,
} = {}) {
  if (!checkoutSessionId) return;
  tx.run(`
    INSERT INTO checkout_dispositions (checkoutSessionId, disposition, paymentIntentId, customerId, eventId, reason, paidMicros)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (checkoutSessionId) DO NOTHING
  `, checkoutSessionId, disposition, paymentIntentId, customerId, eventId, reason, paidMicros);
}

function attachCheckoutIds(tx, { checkoutSessionId, paymentIntentId, customerId, packMicros }) {
  const previous = checkoutDisposition(tx, checkoutSessionId);
  if (!previous) return false;
  tx.run(`
    UPDATE checkout_dispositions SET paymentIntentId = COALESCE(paymentIntentId, ?),
      customerId = COALESCE(customerId, ?) WHERE checkoutSessionId = ?
  `, paymentIntentId, customerId, checkoutSessionId);

  const intent = previous.paymentIntentId ?? paymentIntentId;
  if (intent && intent === paymentIntentId) {
    recordPayment(tx, { paymentIntentId, checkoutSessionId, customerId, packMicros, paidMicros: previous.paidMicros });
    if (previous.disposition === 'orphan') {
      tx.run("UPDATE payments SET grantState = 'refused' WHERE paymentIntentId = ? AND grantState = 'pending'",
        paymentIntentId);
    }
  }
  return true;
}

function grant(tx, id, eventId = null) {
  const entry = payment(tx, id);
  if (entry?.grantState !== 'pending') return entry;
  const current = account(tx, entry.accountId);
  const prior = checkoutDisposition(tx, entry.checkoutSessionId);
  const allowed = !prior && current && !current.frozenReason && entry.dispute === 'none' && current.balanceMicros < entry.packMicros;
  if (allowed) changeBalance(tx, current, entry.packMicros - entry.reversalTarget);
  tx.run('UPDATE payments SET grantState = ? WHERE paymentIntentId = ?', allowed ? 'granted' : 'refused', id);
  setDisposition(tx, entry.checkoutSessionId, allowed ? 'granted' : 'orphan', {
    paymentIntentId: id, customerId: entry.customerId, eventId, reason: allowed ? null : 'grant_refused',
  });
  return payment(tx, id);
}

function reverse(tx, id, target, { paidMicros = null, refundedMicros = 0 } = {}) {
  checkMicros(target, -Number.MAX_SAFE_INTEGER);
  checkMicros(refundedMicros);
  if (paidMicros !== null) checkMicros(paidMicros, 1);
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
    UPDATE payments SET reversalTarget = ?, reversedMicros = reversedMicros + ?,
      paidMicros = COALESCE(paidMicros, ?), refundedMicros = MAX(refundedMicros, ?)
    WHERE paymentIntentId = ?
  `, cappedTarget, debit, paidMicros, refundedMicros, id);
  return payment(tx, id);
}

function finish(tx, entry, {
  state, readerActual, providerActual, reason, now, providerRequestId = null, usage = null,
}) {
  if (!entry || entry.state !== 'open') return entry;
  const debit = Math.min(readerActual, entry.readerWorst);
  tx.run('UPDATE accounts SET reservedMicros = reservedMicros - ?, balanceMicros = balanceMicros - ? WHERE accountId = ?',
    entry.readerWorst, debit, entry.accountId);
  const { balanceMicros } = account(tx, entry.accountId);
  tx.run(`
    UPDATE reservations SET state = ?, costMicros = ?, balanceMicros = ?, providerActual = ?,
      reason = ?, settledAt = ?, overage = ?, providerRequestId = ?, promptTokens = ?, outputTokens = ?, thoughtTokens = ?
    WHERE reservationId = ?
  `, state, debit, balanceMicros, providerActual, reason, now, Number(providerActual > entry.providerMax),
  providerRequestId, usage?.promptTokenCount ?? null, usage?.candidatesTokenCount ?? null,
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

const dayCost = `
  SELECT COALESCE(SUM(CASE
    WHEN state = 'open' OR (state = 'provisional' AND providerActual IS NULL) THEN providerMax
    ELSE providerActual
  END), 0) AS total FROM reservations WHERE dayKey = ?
`;

// A null providerActual keeps providerMax held. The caller supplies the
// independent, already-classified reader amount from section 6.3.
export function createLedger(storage, { now = Date.now } = {}) {
  const transaction = (operation) => storage.transaction(operation);
  return {
    createAccount(tokenHash) {
      return transaction((tx) => {
        const id = newAccountId();
        tx.run('INSERT INTO accounts (accountId, tokenHash) VALUES (?, ?)', id, tokenHash);
        return id;
      });
    },
    authenticate(tokenHash) {
      return transaction((tx) =>
        tx.get('SELECT accountId FROM accounts WHERE tokenHash = ?', tokenHash)?.accountId ?? null);
    },
    getAccount(id) {
      return transaction((tx) => account(tx, id));
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
        if (disposition?.disposition !== 'orphan') return null;
        const entry = payment(tx, disposition.paymentIntentId);
        const refundedMicros = entry?.refundedMicros ?? 0;
        const paidMicros = entry?.paidMicros ?? disposition.paidMicros;
        const status = entry?.dispute === 'open' ? 'disputed'
          : entry?.dispute === 'lost' ? 'settled'
            : paidMicros !== null && refundedMicros >= paidMicros ? 'refunded' : 'open';
        return {
          ...disposition, paidMicros, refundedMicros, status,
          owedMicros: status === 'open' && paidMicros !== null ? paidMicros - refundedMicros : null,
        };
      });
    },
    getIdempotency(accountId, keyHash) {
      return transaction((tx) => claim(tx, accountId, keyHash, now()));
    },
    reserve(accountId, readerWorst, providerMax, dayKey, ceiling, keyHash, bodyHash, { model = null } = {}) {
      checkMicros(readerWorst);
      checkMicros(providerMax);
      checkMicros(ceiling);
      return transaction((tx) => {
        const at = now();
        expireStale(tx, at);
        tx.run('DELETE FROM idempotency WHERE expiresAt <= ?', at);
        const prior = claim(tx, accountId, keyHash, at);
        if (prior) {
          if (prior.bodyHash !== bodyHash) return 'KEY_REUSE';
          return prior.state === 'open' ? 'BUSY' : 'DUPLICATE';
        }

        const current = account(tx, accountId);
        if (!current || current.frozenReason) return 'FROZEN';
        if (tx.get('SELECT 1 FROM reservations WHERE overage = 1 LIMIT 1')) return 'CEILING';
        if (tx.get("SELECT 1 FROM reservations WHERE accountId = ? AND state = 'open'", accountId) ||
            tx.get("SELECT COUNT(*) AS count FROM reservations WHERE state = 'open'").count >= IN_FLIGHT_MAX) return 'BUSY';
        if (current.balanceMicros - current.reservedMicros < readerWorst) return 'BALANCE';
        const accountTotal = tx.get(`${dayCost} AND accountId = ?`, dayKey, accountId).total;
        if (providerMax > ACCOUNT_DAILY_PROVIDER_MAX - accountTotal) return 'DAILY_CAP';
        if (providerMax > ceiling - tx.get(dayCost, dayKey).total) return 'CEILING';

        const id = randomBytes(16).toString('hex');
        tx.run(`
          INSERT INTO reservations (reservationId, accountId, dayKey, createdAt, readerWorst, providerMax, model)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, id, accountId, dayKey, at, readerWorst, providerMax, model);
        tx.run('INSERT INTO idempotency (accountId, keyHash, bodyHash, reservationId) VALUES (?, ?, ?, ?)',
          accountId, keyHash, bodyHash, id);
        tx.run('UPDATE accounts SET reservedMicros = reservedMicros + ? WHERE accountId = ?', readerWorst, accountId);
        return id;
      });
    },
    settle(id, readerActual, providerActual, reason, { providerRequestId = null, usage = null } = {}) {
      checkMicros(readerActual);
      if (providerActual !== null) checkMicros(providerActual);
      return transaction((tx) => finish(tx, reservation(tx, id), {
        state: providerActual === null ? 'provisional' : 'settled',
        readerActual, providerActual, reason, now: now(), providerRequestId, usage,
      }));
    },
    release(id, { providerRequestId = null, reason = 'release' } = {}) {
      return transaction((tx) => finish(tx, reservation(tx, id), {
        state: 'released', readerActual: 0, providerActual: 0, reason, now: now(), providerRequestId,
      }));
    },
    expireStale(at = now()) {
      return transaction((tx) => expireStale(tx, at));
    },
    // The caller already matched this exact reservation to a late response
    // or provider export. An unmatched export must never call reconcile.
    reconcile(id, providerActual) {
      checkMicros(providerActual);
      return transaction((tx) => {
        const entry = reservation(tx, id);
        if (entry?.state !== 'provisional' || entry.providerActual !== null) return entry;
        tx.run('UPDATE reservations SET providerActual = ?, overage = ? WHERE reservationId = ?',
          providerActual, Number(providerActual > entry.providerMax), id);
        return reservation(tx, id);
      });
    },
    recordPayment(input) {
      return transaction((tx) => recordPayment(tx, input));
    },
    grant(id) {
      return transaction((tx) => grant(tx, id));
    },
    reverse(id, target, refund) {
      return transaction((tx) => reverse(tx, id, target, refund));
    },
    freeze(id, reason) {
      return transaction((tx) => freeze(tx, id, reason));
    },
    applyPaymentEvent(id, operation) {
      return transaction((tx) => {
        if (!tx.run('INSERT OR IGNORE INTO payment_events (eventId) VALUES (?)', id).changes) return null;
        return operation({
          recordPayment: (input) => recordPayment(tx, input),
          grant: (paymentId) => grant(tx, paymentId, id),
          reverse: (paymentId, target, refund) => reverse(tx, paymentId, target, refund),
          freeze: (accountId, reason) => freeze(tx, accountId, reason),
          recordDiagnostic(type, reason) {
            return tx.run('INSERT INTO payment_diagnostics (eventId, type, reason) VALUES (?, ?, ?)', id, type, reason);
          },
          attachCheckoutIds: (checkout) => attachCheckoutIds(tx, checkout),
          recordOrphanCheckout(checkoutSessionId, reason, customerId, paidMicros) {
            setDisposition(tx, checkoutSessionId, 'orphan', { eventId: id, reason, customerId, paidMicros });
          },
        });
      });
    },
    adjust(id, deltaMicros, reason, ref) {
      checkMicros(deltaMicros, -Number.MAX_SAFE_INTEGER);
      return transaction((tx) => {
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
      return transaction((tx) => {
        if (tx.get('SELECT 1 FROM corrections WHERE ref = ?', ref)) return 'DUPLICATE';
        const source = account(tx, from);
        const destination = account(tx, to);
        if (!source || !destination || from === to) return 'UNKNOWN_ACCOUNT';
        if (source.frozenReason || destination.frozenReason) return 'FROZEN';
        if (tx.get("SELECT 1 FROM reservations WHERE accountId = ? AND state = 'open'", from)) return 'BUSY';
        changeBalance(tx, destination, source.balanceMicros);
        tx.run("UPDATE accounts SET balanceMicros = 0, tokenHash = NULL, frozenReason = 'transfer' WHERE accountId = ?", from);
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
