import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { MAX_INBOUND_BYTES } from '../src/request-body.js';
import { createStripeWebhook } from '../src/stripe.js';
import { makeLedger } from './helpers.js';

const secret = 'whsec_fixture_only';
const packMicros = 10_000_000;
const checkoutId = 'cs_test_fixture';
const intentId = 'pi_fixture';
const url = 'https://fixture.invalid/v0/stripe/webhook';

function sign(raw, seconds, key = secret) {
  return `t=${seconds},v1=${createHmac('sha256', key).update(`${seconds}.`).update(raw).digest('hex')}`;
}

function setup(options = {}) {
  const context = makeLedger();
  const diagnostics = [];
  const webhook = createStripeWebhook({
    ledger: context.ledger, endpointSecret: secret, paymentLinkId: 'plink_fixture',
    amountCents: 1000, packMicros, now: context.now, diagnostic: (entry) => diagnostics.push(entry), ...options,
  });
  const request = (raw, header, mediaType = 'application/json') => new Request(url, {
    method: 'POST', headers: {
      'Stripe-Signature': header, ...(mediaType ? { 'Content-Type': mediaType } : {}),
    }, body: raw,
  });
  const seconds = () => context.now() / 1000;
  const fixture = (name) => Bun.file(new URL(`fixtures/${name}.json`, import.meta.url)).json();
  async function deliver(name, changes = {}, eventId, eventChanges = {}) {
    const event = await fixture(name);
    if (eventId) event.id = eventId;
    Object.assign(event, eventChanges);
    Object.assign(event.data.object, changes);
    const raw = JSON.stringify(event, null, 2) + '\n';
    const response = await webhook(request(raw, sign(raw, seconds())));
    expect(response.status).toBe(200);
  }
  return { ...context, webhook, request, fixture, seconds, deliver, diagnostics };
}

test('signs the raw bytes with v1, accepts the 300 s boundary and rejects tampered or stale payloads', async () => {
  const { webhook, request, seconds, fixture, ledger, db, account } = setup();
  try {
    const { id } = account();
    const event = await fixture('checkout-paid');
    event.data.object.client_reference_id = id;
    const raw = JSON.stringify(event, null, 2) + '\n';
    const t = seconds();
    const good = sign(raw, t);
    for (const [body, header] of [
      [raw + ' ', good], [raw, sign(raw, t - 301)], [raw, sign(raw, t + 301)],
      [raw, good.replace('v1=', 'v0=')], [raw, sign(raw, t, 'other')],
      ['{ bad json', sign('{ bad json', t)],
    ]) {
      expect((await webhook(request(body, header))).status).toBe(400);
      expect(ledger.getPayment(intentId)).toBeNull();
      expect(ledger.getAccount(id).balanceMicros).toBe(0);
    }
    const allowed = sign(raw, t - 300).replace(',v1=', ',v1=0000,v1=');
    expect((await webhook(request(raw, allowed))).status).toBe(200);
    expect(ledger.getAccount(id).balanceMicros).toBe(packMicros);
  } finally { db.close(); }
});

test('Checkout paid and async deliveries grant once; link, currency and amount mismatches grant nothing', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    for (const [caseName, changes] of [
      ['link', { payment_link: 'plink_wrong' }],
      ['currency', { currency: 'eur' }],
      ['amount', { amount_total: 999 }],
    ]) {
      const payment_intent = `pi_${caseName}`;
      const eventId = `evt_bad_${caseName}`;
      await deliver('checkout-paid', { ...changes, payment_intent, id: `cs_${caseName}`, client_reference_id: id }, eventId);
      if (caseName === 'link') {
        expect(ledger.getPayment(payment_intent)).toBeNull();
        expect(ledger.getCheckoutDisposition(`cs_${caseName}`)).toBeNull();
        expect(ledger.getPaymentDiagnostic(eventId).reason).toBe('unowned_checkout');
      } else {
        expect(ledger.getPayment(payment_intent)).toMatchObject({
          grantState: 'refused', accountId: null, paidMicros: caseName === 'amount' ? 9_990_000 : null,
        });
        expect(ledger.getOrphanCheckout(`cs_${caseName}`).status).toBe(caseName === 'amount' ? 'open' : 'manual');
        expect(ledger.getPaymentDiagnostic(eventId).reason).toBe('checkout_pack_mismatch');
      }
    }
    expect(ledger.getAccount(id).balanceMicros).toBe(0);
    await deliver('checkout-paid', { client_reference_id: id });
    await deliver('checkout-paid', { client_reference_id: id });
    await deliver('checkout-async-paid', { client_reference_id: id });
    expect(ledger.getPayment(intentId)).toMatchObject({ accountId: id, grantState: 'granted', paidMicros: packMicros });
    expect(ledger.getAccount(id).balanceMicros).toBe(packMicros);
  } finally { db.close(); }
});

test('partial refund before Checkout reduces the grant and cumulative refunds never go backward', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    await deliver('charge-refunded');
    expect(ledger.getPayment(intentId)).toMatchObject({
      grantState: 'pending', refundedMicros: 2_500_000, reversalTarget: 2_500_000, reversedMicros: 0,
    });
    await deliver('checkout-paid', { client_reference_id: id });
    expect(ledger.getAccount(id).balanceMicros).toBe(7_500_000);
    await deliver('charge-refunded', { amount_refunded: 150 }, 'evt_old_refund');
    expect(ledger.getAccount(id).balanceMicros).toBe(7_500_000);
    await deliver('charge-refunded', { amount_refunded: 999 }, 'evt_more_refund');
    expect(ledger.getPayment(intentId)).toMatchObject({ refundedMicros: 9_990_000, reversedMicros: 7_490_000 });
    expect(ledger.getAccount(id).balanceMicros).toBe(10_000);
  } finally { db.close(); }
});

test('a full prior refund grants zero and a prior dispute refuses credit without freezing', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    await deliver('charge-refunded', { amount_refunded: 1000 });
    await deliver('checkout-paid', { client_reference_id: id });
    expect(ledger.getPayment(intentId)).toMatchObject({ grantState: 'granted', reversalTarget: packMicros });
    expect(ledger.getCheckoutDisposition(checkoutId)).toMatchObject({ disposition: 'granted' });
    expect(ledger.getOrphanCheckout(checkoutId)).toBeNull();
    expect(ledger.getAccount(id).balanceMicros).toBe(0);

    await deliver('dispute-created', { payment_intent: 'pi_open_first' });
    await deliver('checkout-paid', {
      id: 'cs_open_first', payment_intent: 'pi_open_first', client_reference_id: id,
    }, 'evt_open_first_checkout');
    expect(ledger.getPayment('pi_open_first')).toMatchObject({ grantState: 'refused', dispute: 'open' });
    expect(ledger.getOrphanCheckout('cs_open_first')).toMatchObject({ status: 'disputed', owedMicros: null });
    expect(ledger.getAccount(id)).toMatchObject({ balanceMicros: 0, frozenReason: null });
  } finally { db.close(); }
});

test('a granted dispute reverses only the remainder and closes without unfreezing', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    await deliver('checkout-paid', { client_reference_id: id });
    await deliver('charge-refunded');
    await deliver('dispute-closed', { status: 'won' });
    expect(ledger.getAccount(id)).toMatchObject({ balanceMicros: 7_500_000, frozenReason: null });
    await deliver('dispute-created');
    expect(ledger.getPayment(intentId)).toMatchObject({
      dispute: 'won', reversedMicros: packMicros, refundedMicros: 2_500_000, reversalTarget: packMicros,
    });
    expect(ledger.getAccount(id)).toMatchObject({ balanceMicros: 0, frozenReason: 'dispute' });
  } finally { db.close(); }
});

test('refused grants never debit or freeze; orphan amount owed follows refund and partial dispute evidence', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account(packMicros);
    await deliver('checkout-paid', { client_reference_id: id });
    expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({ status: 'open', owedMicros: packMicros });
    expect(ledger.markOrphanSettled(intentId, 'unsupported-usd-marker')).toBe('NOT_MANUAL');
    await deliver('charge-refunded');
    expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({ status: 'open', owedMicros: 7_500_000 });
    await deliver('dispute-created');
    expect(ledger.getOrphanCheckout(checkoutId).status).toBe('disputed');
    await deliver('dispute-closed');
    expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({ status: 'open', owedMicros: 4_500_000 });
    await deliver('charge-refunded', { amount_refunded: 700 }, 'evt_finish_refund');
    expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({ status: 'settled', owedMicros: null });
    expect(ledger.getPayment(intentId)).toMatchObject({ dispute: 'lost', disputeLostMicros: 3_000_000, reversedMicros: 0 });
    expect(ledger.getAccount(id)).toMatchObject({ balanceMicros: packMicros, frozenReason: null });
  } finally { db.close(); }
});

test('missing, malformed, and unknown account references create operator orphans without granting', async () => {
  const { deliver, ledger, db } = setup();
  try {
    for (const [index, reference] of [null, 'not-an-id', 'acct_AAAAAAAAAAAAAAAAAAAAAAAAAA'].entries()) {
      const payment_intent = `pi_orphan_${index}`;
      const id = `cs_orphan_${index}`;
      await deliver('checkout-paid', { client_reference_id: reference, id, payment_intent }, `evt_orphan_${index}`);
      expect(ledger.getPayment(payment_intent).grantState).toBe('refused');
      expect(ledger.getOrphanCheckout(id)).toMatchObject({ status: 'open', owedMicros: packMicros });
    }
  } finally { db.close(); }
});

test('unpaid Checkout, Charge and Dispute events with null intent record only diagnostics', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    for (const name of ['checkout-unpaid-no-intent', 'charge-refunded-no-intent', 'dispute-created-no-intent']) {
      await deliver(name);
      await deliver(name);
      const eventId = 'evt_' + name.replaceAll('-', '_');
      expect(ledger.getPaymentDiagnostic(eventId)).toMatchObject({ eventId, reason: 'no_payment_intent' });
    }
    expect(ledger.getCheckoutDisposition(checkoutId)).toBeNull();
    expect(ledger.getPayment(intentId)).toBeNull();
    await deliver('checkout-async-paid', { client_reference_id: id });
    expect(ledger.getAccount(id).balanceMicros).toBe(packMicros);
  } finally { db.close(); }
});

test('paid Checkout without intent is terminal before or after a grant', async () => {
  for (const firstOrphan of [true, false]) {
    const { deliver, ledger, db, account } = setup();
    try {
      const { id } = account();
      const names = ['checkout-paid-no-intent', 'checkout-paid'];
      if (!firstOrphan) names.reverse();
      for (const name of names) await deliver(name, { client_reference_id: id });
      const expectedBalance = firstOrphan ? 0 : packMicros;
      expect(ledger.getAccount(id).balanceMicros).toBe(expectedBalance);
      expect(ledger.getCheckoutDisposition(checkoutId).disposition).toBe(firstOrphan ? 'orphan' : 'granted');
      expect(ledger.getPayment(intentId).grantState).toBe(firstOrphan ? 'refused' : 'granted');
      if (firstOrphan) {
        expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({ paymentIntentId: intentId, status: 'open' });
      } else {
        expect(ledger.getOrphanCheckout(checkoutId)).toBeNull();
      }
    } finally { db.close(); }
  }
});

test('a session-keyed orphan links to earlier refund evidence once and warning_closed counts as won', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    await deliver('checkout-paid-no-intent', { client_reference_id: id });
    expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({ paymentIntentId: null, owedMicros: packMicros });
    await deliver('charge-refunded');
    expect(ledger.linkOrphan(checkoutId, intentId)).toMatchObject({ paymentIntentId: intentId });
    expect(ledger.linkOrphan(checkoutId, 'pi_conflict')).toBe('CONFLICT');
    await deliver('dispute-created');
    await deliver('dispute-closed', { status: 'warning_closed' });
    expect(ledger.getPayment(intentId)).toMatchObject({
      grantState: 'refused', accountId: id, dispute: 'won', refundedMicros: 2_500_000,
    });
    expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({ status: 'open', owedMicros: 7_500_000 });
    expect(ledger.getAccount(id)).toMatchObject({ balanceMicros: 0, frozenReason: null });
  } finally { db.close(); }
});

test('ownership and mode checks keep unrelated paid sessions and replay IDs out of the refund ledger', async () => {
  const { deliver, ledger, db, account, diagnostics } = setup();
  try {
    const { id } = account();
    for (const payment_intent of [null, intentId]) {
      const event = `evt_unowned_${payment_intent ?? 'none'}`;
      await deliver('checkout-paid', { payment_intent, payment_link: 'plink_unrelated', client_reference_id: id }, event);
      expect(ledger.getPaymentDiagnostic(event).reason).toBe('unowned_checkout');
      expect(ledger.getCheckoutDisposition(checkoutId)).toBeNull();
    }
    await deliver('checkout-paid', { client_reference_id: id }, 'evt_mode', { livemode: true });
    expect(diagnostics).toContainEqual({ eventId: 'evt_mode', reason: 'livemode_mismatch' });
    expect(ledger.getPaymentDiagnostic('evt_mode')).toBeNull();
    expect(ledger.getPayment(intentId)).toBeNull();
    await deliver('checkout-paid', { client_reference_id: id }, 'evt_unhandled', { type: 'charge.succeeded' });
    expect(diagnostics).toContainEqual({ eventId: 'evt_unhandled', reason: 'verified_unhandled' });
    expect(ledger.getPaymentDiagnostic('evt_unhandled')).toBeNull();
    await deliver('checkout-paid', { client_reference_id: id }, 'evt_mode');
    expect(ledger.getAccount(id).balanceMicros).toBe(packMicros);
    expect(ledger.getPayment(intentId)).not.toHaveProperty('customerId');
  } finally { db.close(); }
});

test('an oversized unsigned Stripe stream fails before verification and leaves the ledger empty', async () => {
  const { webhook, request, ledger, db } = setup();
  try {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_INBOUND_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    } });
    const streamed = request(body, 'invalid');
    expect(streamed.headers.has('content-length')).toBeFalse();
    const response = await webhook(streamed);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { category: 'request_failed', tooLarge: 'body' } });
    expect(db.transaction((tx) => tx.all('SELECT eventId FROM payment_events'))).toEqual([]);
    expect(ledger.getPayment(intentId)).toBeNull();
  } finally { db.close(); }
});

test('an unpaid missing-intent event is diagnostic only even when the session already has a disposition', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    await deliver('checkout-paid', { client_reference_id: id });
    const before = ledger.getCheckoutDisposition(checkoutId);
    await deliver('checkout-unpaid-no-intent', { customer: 'cus_new_fixture' });
    expect(ledger.getCheckoutDisposition(checkoutId)).toEqual(before);
    expect(ledger.getPaymentDiagnostic('evt_checkout_unpaid_no_intent').reason).toBe('no_payment_intent');
    expect(ledger.getAccount(id).balanceMicros).toBe(packMicros);
  } finally { db.close(); }
});

test('enrollment disqualifies owned payments and malformed session references are never attached to no-intent orphans', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account(0, false);
    await deliver('checkout-paid', { client_reference_id: id });
    expect(ledger.getPayment(intentId)).toMatchObject({ grantState: 'refused', accountId: null });
    expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({ paidMicros: packMicros, status: 'open' });
    await deliver('checkout-paid-no-intent', { id: 'cs_reference_invalid', client_reference_id: 'malformed' });
    expect(ledger.getOrphanCheckout('cs_reference_invalid').accountId).toBeNull();
    expect(ledger.getAccount(id).balanceMicros).toBe(0);
  } finally { db.close(); }
});

test('EUR Checkout, JPY refund-first and session-keyed foreign orphans remain in native minor units', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    await deliver('checkout-paid', { currency: 'eur', client_reference_id: id });
    expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({
      paidCurrency: 'eur', paidMicros: null, paidMinor: 1000, status: 'manual',
    });
    await deliver('charge-refunded', { currency: 'eur' });
    await deliver('dispute-closed', { currency: 'eur' });
    expect(ledger.getPayment(intentId)).toMatchObject({
      paidCurrency: 'eur', refundedMinor: 250, disputeLostMinor: 300, refundedMicros: 0, disputeLostMicros: 0,
    });
    expect(ledger.getOrphanCheckout(checkoutId).status).toBe('manual');
    expect(ledger.markOrphanSettled(intentId, 'confirmed-eur')).toBe('SETTLED');
    expect(ledger.markOrphanSettled(checkoutId, 'confirmed-eur')).toBe('DUPLICATE');
    expect(ledger.getOrphanCheckout(checkoutId).status).toBe('settled');

    await deliver('charge-refunded', { currency: 'jpy', payment_intent: 'pi_jpy', amount_refunded: 125 }, 'evt_jpy_refund');
    await deliver('checkout-paid', { currency: 'jpy', payment_intent: 'pi_jpy', id: 'cs_jpy' }, 'evt_jpy_paid');
    expect(ledger.getOrphanCheckout('cs_jpy')).toMatchObject({
      paidCurrency: 'jpy', paidMicros: null, paidMinor: 1000, refundedMinor: 125, status: 'manual',
    });
    await deliver('checkout-paid-no-intent', { id: 'cs_foreign_unlinked', currency: 'eur' });
    expect(ledger.linkOrphan('cs_foreign_unlinked', 'pi_jpy')).toBe('CONFLICT');
    expect(ledger.markOrphanSettled('cs_foreign_unlinked', 'confirmed-before-link')).toBe('SETTLED');
    expect(ledger.linkOrphan('cs_foreign_unlinked', 'pi_linked_eur')).toMatchObject({ paymentIntentId: 'pi_linked_eur' });
    expect(ledger.linkOrphan('cs_foreign_unlinked', 'pi_linked_eur')).toMatchObject({ paymentIntentId: 'pi_linked_eur' });
    expect(ledger.getPayment('pi_linked_eur')).toMatchObject({
      grantState: 'refused', paidCurrency: 'eur', paidMinor: 1000, paidMicros: null,
    });
    expect(ledger.getOrphanCheckout('cs_foreign_unlinked')).toMatchObject({ status: 'settled', paidMinor: 1000 });
    expect(ledger.getAccount(id).balanceMicros).toBe(0);
  } finally { db.close(); }
});

test('old pack values survive configuration changes and a refund uses amount_captured', async () => {
  const { deliver, ledger, db, account, fixture, request, seconds } = setup();
  try {
    const { id } = account();
    await deliver('checkout-paid', { client_reference_id: id });
    const changedWebhook = createStripeWebhook({
      ledger, endpointSecret: secret, paymentLinkId: 'plink_fixture', amountCents: 2000, packMicros: 20_000_000,
      now: () => seconds() * 1000,
    });
    const refund = await fixture('charge-refunded');
    refund.data.object.amount = 5000;
    const raw = JSON.stringify(refund);
    expect((await changedWebhook(request(raw, sign(raw, seconds())))).status).toBe(200);
    expect(ledger.getPayment(intentId)).toMatchObject({ packMicros, reversalTarget: 2_500_000 });
    expect(ledger.getAccount(id).balanceMicros).toBe(7_500_000);
  } finally { db.close(); }
});

test('dispute close produces the same accounting in either event order or without a created event', async () => {
  for (const outcome of ['won', 'lost']) {
    for (const order of [['open', 'close'], ['close', 'open'], ['close']]) {
      const { deliver, ledger, db, account } = setup();
      try {
        const { id } = account();
        await deliver('checkout-paid', { client_reference_id: id });
        for (const step of order) {
          if (step === 'open') await deliver('dispute-created');
          else await deliver('dispute-closed', { status: outcome });
        }
        const reversed = outcome === 'lost' || order.includes('open');
        expect(ledger.getPayment(intentId)).toMatchObject({ dispute: outcome, disputeFreezeApplied: reversed });
        expect(ledger.getAccount(id)).toMatchObject({ frozen: reversed, balanceMicros: reversed ? 0 : packMicros });
      } finally { db.close(); }
    }
  }
});

test('lost close freezes the transferred credit holder once and rejects an empty freeze reason', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    const receiver = account().id;
    await deliver('checkout-paid', { client_reference_id: id });
    expect(() => ledger.freeze(receiver, '')).toThrow('reason');
    expect(ledger.getAccount(receiver).frozen).toBeFalse();
    ledger.transfer(id, receiver, 'move-payment');
    await deliver('dispute-closed');
    expect(ledger.getPayment(intentId)).toMatchObject({
      accountId: receiver, dispute: 'lost', reversalTarget: packMicros, disputeFreezeApplied: true,
    });
    expect(ledger.getAccount(receiver)).toMatchObject({ balanceMicros: 0, frozen: true, frozenReason: 'dispute' });
    expect(ledger.unfreeze(receiver, 'confirmed-closed')).toBeTrue();
    await deliver('dispute-created');
    expect(ledger.getAccount(receiver)).toMatchObject({ balanceMicros: 0, frozen: false });
    expect(ledger.getAccount(id).frozenReason).toBe('transfer');
  } finally { db.close(); }
});

test('foreign dispute evidence can arrive before an owned paid Checkout', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    await deliver('dispute-closed', { currency: 'cad', amount: 250 });
    expect(ledger.getPayment(intentId)).toMatchObject({
      paidCurrency: 'cad', paidMicros: null, dispute: 'lost', disputeLostMicros: 0, disputeLostMinor: 250,
    });
    await deliver('checkout-paid', { currency: 'cad', client_reference_id: id });
    expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({
      paidCurrency: 'cad', paidMicros: null, paidMinor: 1000, disputeLostMinor: 250, status: 'manual',
    });
    expect(ledger.getAccount(id)).toMatchObject({ balanceMicros: 0, frozen: false });
  } finally { db.close(); }
});

test('a signed Stripe event requires JSON before it enters the ledger', async () => {
  const { webhook, request, ledger, db, account, fixture, seconds } = setup();
  try {
    const { id } = account();
    const event = await fixture('checkout-paid');
    event.data.object.client_reference_id = id;
    const raw = JSON.stringify(event, null, 2);
    const header = sign(raw, seconds());
    for (const mime of [null, 'text/plain', 'application/jsonp']) {
      expect((await webhook(request(raw, header, mime))).status).toBe(400);
      expect(ledger.getPayment(intentId)).toBeNull();
    }
    expect((await webhook(request(raw, header, 'application/json; charset=utf-8'))).status).toBe(200);
    expect(ledger.getAccount(id).balanceMicros).toBe(packMicros);
  } finally { db.close(); }
});

test('a currency-conflicting orphan link preserves both records and its operator marker', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    expect(ledger.linkOrphan(checkoutId, intentId)).toBe('NOT_ORPHAN');
    const { id } = account();
    await deliver('checkout-paid-no-intent', { currency: 'eur', client_reference_id: id });
    await deliver('charge-refunded', { currency: 'usd' });
    expect(ledger.markOrphanSettled(checkoutId, 'verified-by-operator')).toBe('SETTLED');
    const originalSession = ledger.getOrphanCheckout(checkoutId);
    const originalIntent = ledger.getPayment(intentId);
    expect(ledger.linkOrphan(checkoutId, intentId)).toBe('CONFLICT');
    expect(ledger.getOrphanCheckout(checkoutId)).toEqual(originalSession);
    expect(ledger.getPayment(intentId)).toEqual(originalIntent);
    await deliver('checkout-paid', { client_reference_id: id });
    expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({
      paymentIntentId: null, paidCurrency: 'eur', status: 'settled',
    });
    expect(ledger.getPayment(intentId)).toEqual(originalIntent);
    expect(ledger.getPaymentDiagnostic('evt_checkout_paid').reason).toBe('checkout_intent_conflict');
    expect(ledger.getAccount(id).balanceMicros).toBe(0);
  } finally { db.close(); }
});

test('with no captured amount the payment uses its own Checkout total in either delivery order', async () => {
  for (const checkoutFirst of [false, true]) {
    const { deliver, ledger, db, account } = setup();
    try {
      const { id } = account();
      const checkout = () => deliver('checkout-paid', { client_reference_id: id });
      if (checkoutFirst) await checkout();
      await deliver('charge-refunded', { amount_captured: null, amount_refunded: 600 });
      expect(ledger.getPayment(intentId)).toMatchObject({
        refundedMicros: 6_000_000, uncapturedRefundMicros: 6_000_000,
        reversalTarget: checkoutFirst ? 6_000_000 : 0,
      });
      expect(ledger.getPaymentDiagnostic('evt_charge_refunded').reason).toBe('invalid_refund_amount');
      await deliver('charge-refunded', { amount_refunded: 325, amount_captured: 1000 }, 'evt_usable_capture');
      if (!checkoutFirst) {
        expect(ledger.getPayment(intentId)).toMatchObject({ grantState: 'pending', reversalTarget: 3_250_000 });
        expect(ledger.getAccount(id).balanceMicros).toBe(0);
        await checkout();
      }
      expect(ledger.getPayment(intentId)).toMatchObject({
        refundedMicros: 6_000_000, reversalTarget: 6_000_000, grantState: 'granted',
      });
      expect(ledger.getAccount(id).balanceMicros).toBe(4_000_000);
    } finally { db.close(); }
  }
});

test('refunds preserve the max of their own ratios in both delivery orders', async () => {
  for (const reverseOrder of [false, true]) {
    const { deliver, ledger, db, account } = setup();
    try {
      const { id } = account();
      const snapshots = [
        ['evt_half_capture', { amount_refunded: 250, amount_captured: 500 }],
        ['evt_full_capture', { amount_refunded: 300, amount_captured: 1000 }],
      ];
      if (reverseOrder) snapshots.reverse();
      for (const [eventId, values] of snapshots) await deliver('charge-refunded', values, eventId);
      expect(ledger.getPayment(intentId)).toMatchObject({ refundedMicros: 3_000_000, reversalTarget: 5_000_000 });
      await deliver('checkout-paid', { client_reference_id: id });
      expect(ledger.getAccount(id).balanceMicros).toBe(5_000_000);
    } finally { db.close(); }
  }
});

test('a dispute refuses unresolved paid credit before or after it enters the deferred queue', async () => {
  for (const disputeFirst of [false, true]) {
    const { deliver, ledger, db, account } = setup();
    try {
      const { id } = account();
      await deliver('charge-refunded', { amount_captured: null });
      // Stage the defensive case of a paid session with no usable total.
      // The normal v0 webhook always has the fixed, validated Checkout total.
      ledger.recordPayment({
        paymentIntentId: intentId, checkoutSessionId: checkoutId,
        accountId: id, paidCurrency: 'usd', packMicros,
      });
      if (disputeFirst) await deliver('dispute-created');
      const outcome = ledger.grant(intentId);
      if (!disputeFirst) {
        expect(outcome.grantState).toBe('pending');
        expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({ status: 'deferred', owedMicros: null });
        await deliver('dispute-created');
      }
      expect(ledger.getPayment(intentId)).toMatchObject({ grantState: 'refused', dispute: 'open' });
      expect(ledger.getOrphanCheckout(checkoutId)).toMatchObject({ status: 'disputed' });
      expect(ledger.getAccount(id)).toMatchObject({ balanceMicros: 0, frozen: false });
    } finally { db.close(); }
  }
});

test('a frozen account terminally refuses instead of deferring an unresolved refund', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    await deliver('charge-refunded', { amount_captured: null });
    ledger.recordPayment({
      paymentIntentId: intentId, checkoutSessionId: checkoutId, accountId: id, paidCurrency: 'usd', packMicros,
    });
    ledger.freeze(id, 'fixture');
    expect(ledger.grant(intentId).grantState).toBe('refused');
    expect(ledger.getOrphanCheckout(checkoutId).status).toBe('open');
    expect(ledger.getAccount(id).balanceMicros).toBe(0);
  } finally { db.close(); }
});

test('MK-06 applies a nonround Checkout fallback in cents and leaves foreign refunds in minor units', async () => {
  for (const currency of ['usd', 'eur']) {
    const { deliver, ledger, db, account } = setup();
    try {
      const { id } = account();
      await deliver('charge-refunded', { currency, amount_refunded: 333, amount_captured: null });
      expect(ledger.getPayment(intentId).reversalTarget).toBe(0);
      await deliver('checkout-paid', { currency, amount_total: 999, client_reference_id: id });
      expect(ledger.getPayment(intentId)).toMatchObject(currency === 'usd'
        ? { paidMicros: 9_990_000, refundedMicros: 3_330_000, reversalTarget: 3_333_334, grantState: 'refused' }
        : { paidMicros: null, paidMinor: 999, refundedMinor: 333, reversalTarget: 0, grantState: 'refused' });
      expect(ledger.getAccount(id).balanceMicros).toBe(0);
    } finally { db.close(); }
  }
});
