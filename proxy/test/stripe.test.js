import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
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

function setup() {
  const context = makeLedger();
  const webhook = createStripeWebhook({
    ledger: context.ledger, endpointSecret: secret, paymentLinkId: 'plink_fixture',
    amountCents: 1000, packMicros, now: context.now,
  });
  const request = (raw, header) => new Request(url, {
    method: 'POST', headers: { 'Stripe-Signature': header }, body: raw,
  });
  const seconds = () => context.now() / 1000;
  const fixture = (name) => Bun.file(new URL(`fixtures/${name}.json`, import.meta.url)).json();
  async function deliver(name, changes = {}, eventId) {
    const event = await fixture(name);
    if (eventId) event.id = eventId;
    Object.assign(event.data.object, changes);
    const raw = JSON.stringify(event, null, 2) + '\n';
    const response = await webhook(request(raw, sign(raw, seconds())));
    expect(response.status).toBe(200);
  }
  return { ...context, webhook, request, fixture, seconds, deliver };
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
      expect(ledger.getPayment(payment_intent)).toMatchObject({ grantState: 'pending', accountId: null });
      expect(ledger.getPaymentDiagnostic(eventId).reason).toBe('checkout_pack_mismatch');
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

test('a full refund before completion produces a zero grant; a dispute before completion refuses without freezing', async () => {
  const { deliver, ledger, db, account } = setup();
  try {
    const { id } = account();
    await deliver('charge-refunded', { amount_refunded: 1000 });
    await deliver('checkout-paid', { client_reference_id: id });
    expect(ledger.getPayment(intentId)).toMatchObject({ grantState: 'granted', reversalTarget: packMicros });
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
