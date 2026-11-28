import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300;
const CHECKOUT_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
const REFUND = 'charge.refunded';
const DISPUTE_OPEN = 'charge.dispute.created';
const DISPUTE_CLOSED = 'charge.dispute.closed';
const ACCOUNT_ID = /^acct_[A-Z2-7]{26}$/;

function validSignature(raw, header, secret, now) {
  const fields = (header ?? '').split(',').map((entry) => entry.trim().split('='));
  const times = fields.filter(([key]) => key === 't');
  const timestamp = times[0]?.[1];
  if (times.length !== 1 || !/^\d{1,16}$/.test(timestamp) ||
      Math.abs(Math.floor(now / 1000) - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  return fields.some(([key, value]) => key === 'v1' && typeof value === 'string' &&
    /^[a-fA-F0-9]{64}$/.test(value) && timingSafeEqual(expected, Buffer.from(value, 'hex')));
}

function stripeId(value, prefix) {
  const id = typeof value === 'string' ? value : value?.id;
  return typeof id === 'string' && id.startsWith(prefix) && /^[a-zA-Z0-9_]{4,255}$/.test(id) ? id : null;
}

function refundTarget(packMicros, paid, refunded) {
  const paidUnits = BigInt(paid);
  const refundedUnits = BigInt(Math.min(paid, refunded));
  return Number((BigInt(packMicros) * refundedUnits + paidUnits - 1n) / paidUnits);
}

export function createStripeWebhook({
  ledger, endpointSecret, paymentLinkId, amountCents, packMicros, now = Date.now,
}) {
  if (typeof endpointSecret !== 'string' || !endpointSecret || !stripeId(paymentLinkId, 'plink_') ||
      !Number.isSafeInteger(amountCents) || !Number.isSafeInteger(amountCents * 10_000) || amountCents <= 0 ||
      !Number.isSafeInteger(packMicros) || packMicros <= 0) {
    throw new TypeError('Invalid Stripe webhook configuration');
  }

  function apply(eventId, type, object) {
    const isCheckout = CHECKOUT_EVENTS.has(type);
    const paid = isCheckout && object.mode === 'payment' && object.payment_status === 'paid';
    const paymentIntentId = stripeId(object.payment_intent, 'pi_');
    const checkoutSessionId = isCheckout ? stripeId(object.id, 'cs_') : null;
    const paidMicros = paid && object.currency === 'usd' && Number.isSafeInteger(object.amount_total) &&
      object.amount_total > 0 && Number.isSafeInteger(object.amount_total * 10_000) ? object.amount_total * 10_000 : null;
    const customerId = isCheckout ? stripeId(object.customer, 'cus_') : null;
    const reference = object.client_reference_id;
    const accountId = typeof reference === 'string' && ACCOUNT_ID.test(reference) ? reference : null;
    return ledger.applyPaymentEvent(eventId, (tx) => {
      if (!paymentIntentId) tx.recordDiagnostic(type, 'no_payment_intent');
      if (checkoutSessionId && tx.attachCheckoutIds({ checkoutSessionId, paymentIntentId, customerId })) {
        return;
      }
      if (!paymentIntentId) {
        if (paid && checkoutSessionId) {
          tx.recordOrphanCheckout(checkoutSessionId, 'paid_without_payment_intent', customerId,
            paidMicros, packMicros, accountId);
        }
        return;
      }
      if (isCheckout && !checkoutSessionId) {
        tx.recordDiagnostic(type, 'no_checkout_session');
        return;
      }

      const payment = { paymentIntentId, packMicros };
      if (isCheckout) {
        const matchingPack = stripeId(object.payment_link, 'plink_') === paymentLinkId &&
          object.currency === 'usd' && object.amount_total === amountCents;
        tx.recordPayment({
          ...payment, checkoutSessionId, customerId,
          paidMicros: matchingPack ? paidMicros : null,
          accountId: paid && matchingPack ? accountId : null,
        });
        if (!paid) return;
        if (!matchingPack) {
          tx.recordDiagnostic(type, 'checkout_pack_mismatch');
          return;
        }
        const result = tx.grant(paymentIntentId);
        if (result.grantState === 'refused') tx.recordDiagnostic(type, 'grant_refused');
      } else if (type === REFUND) {
        // A Charge reports both the intended and the captured amounts.
        // Reversal is relative to the money actually paid.
        const captured = object.amount_captured ?? object.amount;
        const refunded = object.amount_refunded;
        if (object.currency !== 'usd' || !Number.isSafeInteger(captured * 10_000) || captured <= 0 ||
            !Number.isSafeInteger(refunded * 10_000) || refunded < 0 ||
            !Number.isInteger(captured) || !Number.isInteger(refunded)) {
          tx.recordPayment(payment);
          tx.recordDiagnostic(type, 'invalid_refund_amount');
          return;
        }
        tx.recordPayment({ ...payment, paidMicros: captured * 10_000, refundedMicros: refunded * 10_000 });
        tx.reverse(paymentIntentId, refundTarget(packMicros, captured, refunded));
      } else if (type === DISPUTE_OPEN) {
        tx.recordPayment({ ...payment, dispute: 'open' });
        tx.reverse(paymentIntentId, packMicros);
      } else {
        const dispute = object.status === 'lost' ? 'lost' : 'won';
        const validAmount = object.currency === 'usd' && Number.isSafeInteger(object.amount) &&
          object.amount >= 0 && Number.isSafeInteger(object.amount * 10_000);
        if (dispute === 'lost' && !validAmount) tx.recordDiagnostic(type, 'invalid_dispute_amount');
        if (!['lost', 'won', 'warning_closed'].includes(object.status)) {
          tx.recordDiagnostic(type, 'unrecognized_dispute_close');
        }
        tx.recordPayment({ ...payment, dispute, disputeLostMicros: dispute === 'lost' && validAmount ? object.amount * 10_000 : 0 });
      }
    });
  }

  const badRequest = () => Response.json({ error: { category: 'request_failed' } }, { status: 400 });
  return async function stripeWebhook(request) {
    if (request.method !== 'POST') return badRequest();
    let event;
    try {
      const raw = Buffer.from(await request.arrayBuffer());
      if (!validSignature(raw, request.headers.get('stripe-signature'), endpointSecret, now())) return badRequest();
      event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      return badRequest();
    }
    const eventId = stripeId(event?.id, 'evt_');
    const type = event?.type;
    if (!eventId || typeof type !== 'string') return badRequest();
    if (CHECKOUT_EVENTS.has(type) || type === REFUND || type === DISPUTE_OPEN || type === DISPUTE_CLOSED) {
      const object = event.data?.object;
      if (!object || typeof object !== 'object' || Array.isArray(object)) return badRequest();
      apply(eventId, type, object);
    }
    return Response.json({ received: true });
  };
}
