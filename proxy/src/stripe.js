import { createHmac, timingSafeEqual } from 'node:crypto';
import { bodyTooLarge, hasJsonMediaType, readBoundedBytes } from './request-body.js';

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
  if (times.length !== 1 || times[0].length !== 2 || !/^\d{1,16}$/.test(timestamp) ||
      Math.abs(Math.floor(now / 1000) - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  return fields.some(([key, value, extra]) => key === 'v1' && extra === undefined &&
    typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value) && timingSafeEqual(expected, Buffer.from(value, 'hex')));
}

function stripeId(value, prefix) {
  const id = typeof value === 'string' ? value : value?.id;
  return typeof id === 'string' && id.startsWith(prefix) && /^[a-zA-Z0-9_]{4,255}$/.test(id) ? id : null;
}

const isCurrency = (value) => typeof value === 'string' && /^[a-z]{3}$/.test(value);
const validAmount = (amount, currency) => Number.isSafeInteger(amount) && amount >= 0 &&
  (currency !== 'usd' || Number.isSafeInteger(amount * 10_000));

function paidFacts(currency, amount) {
  const valid = isCurrency(currency) && validAmount(amount, currency);
  return {
    paidCurrency: isCurrency(currency) ? currency : null,
    paidMicros: valid && currency === 'usd' ? amount * 10_000 : null,
    paidMinor: valid && currency !== 'usd' ? amount : null,
  };
}

function refundTarget(packMicros, paid, refunded) {
  const denominator = BigInt(paid);
  return Number((BigInt(packMicros) * BigInt(Math.min(refunded, paid)) + denominator - 1n) / denominator);
}

export function createStripeWebhook({
  ledger, endpointSecret, paymentLinkId, amountCents, packMicros, livemode = false,
  now = Date.now, diagnostic = console.warn,
}) {
  if (typeof endpointSecret !== 'string' || !endpointSecret || !stripeId(paymentLinkId, 'plink_') ||
      !validAmount(amountCents, 'usd') || amountCents <= 0 ||
      !Number.isSafeInteger(packMicros) || packMicros <= 0 || typeof livemode !== 'boolean') {
    throw new TypeError('Invalid Stripe webhook configuration');
  }

  function apply(eventId, type, object) {
    const checkout = CHECKOUT_EVENTS.has(type);
    const paid = checkout && object.mode === 'payment' && object.payment_status === 'paid';
    const paymentIntentId = stripeId(object.payment_intent, 'pi_');
    const sessionId = checkout ? stripeId(object.id, 'cs_') : null;
    const currency = isCurrency(object.currency) ? object.currency : null;
    return ledger.applyPaymentEvent(eventId, (tx) => {
      const note = (reason) => tx.recordDiagnostic(type, reason);
      if (checkout && stripeId(object.payment_link, 'plink_') !== paymentLinkId) return note('unowned_checkout');
      if (checkout && !sessionId) return note('no_checkout_session');

      const matchingPrice = currency === 'usd' && object.amount_total === amountCents;
      const reference = object.client_reference_id;
      const accountId = paid && matchingPrice && typeof reference === 'string' &&
        ACCOUNT_ID.test(reference) && tx.isEnrolled(reference) ? reference : null;
      const facts = paid ? paidFacts(currency, object.amount_total) : {};
      if (!paymentIntentId) {
        note('no_payment_intent');
        if (paid) tx.recordOrphanCheckout(sessionId, {
          ...facts, packMicros, accountId, reason: 'paid_without_payment_intent',
        });
        return;
      }
      if (checkout) {
        const attached = tx.attachCheckoutIds({ checkoutSessionId: sessionId, paymentIntentId });
        if (attached === 'CONFLICT') return note('checkout_intent_conflict');
        if (attached) return;
      }

      const payment = { paymentIntentId, packMicros, paidCurrency: currency };
      if (checkout) {
        const entry = tx.recordPayment({ ...payment, ...facts, checkoutSessionId: sessionId, accountId, fromCheckout: paid });
        if (!paid) return;
        if (!matchingPrice || entry.paidCurrency !== 'usd') {
          tx.refuse(paymentIntentId, 'checkout_pack_mismatch');
          return note('checkout_pack_mismatch');
        }
        if (!accountId) {
          tx.refuse(paymentIntentId, 'grant_refused');
          return note('grant_refused');
        }
        const grant = tx.grant(paymentIntentId);
        if (grant.grantState === 'refused') return note('grant_refused');
        if (grant.grantState === 'pending') return note('refund_capture_pending');
        return;
      }

      if (type === REFUND) {
        const captured = object.amount_captured;
        const refunded = object.amount_refunded;
        const captureKnown = currency && validAmount(captured, currency) && captured > 0;
        const refundKnown = currency && validAmount(refunded, currency);
        const usd = currency === 'usd';
        const entry = tx.recordPayment({
          ...payment, ...paidFacts(currency, captureKnown ? captured : null),
          refundedMicros: usd && refundKnown ? refunded * 10_000 : 0,
          refundedMinor: !usd && refundKnown ? refunded : 0,
          refundCapturedMicros: usd && captureKnown ? captured * 10_000 : null,
        });
        if (currency && entry.paidCurrency !== currency) return note('payment_currency_mismatch');
        if (!captureKnown || !refundKnown) note('invalid_refund_amount');
        if (usd && entry.refundCapturedMicros && entry.refundedMicros > 0) {
          tx.reverse(paymentIntentId, refundTarget(entry.packMicros, entry.refundCapturedMicros, entry.refundedMicros));
          if (entry.grantState === 'pending' && entry.checkoutSessionId && entry.accountId) tx.grant(paymentIntentId);
        }
        return;
      }

      const opened = type === DISPUTE_OPEN;
      const lost = !opened && object.status === 'lost';
      const dispute = opened ? 'open' : lost ? 'lost' : 'won';
      const amount = currency && validAmount(object.amount, currency) ? object.amount : null;
      const entry = tx.recordPayment({
        ...payment, dispute,
        disputeLostMicros: lost && currency === 'usd' && amount !== null ? amount * 10_000 : 0,
        disputeLostMinor: lost && currency !== 'usd' && amount !== null ? amount : 0,
      });
      if (currency && entry.paidCurrency !== currency) return note('payment_currency_mismatch');
      if ((opened || lost && entry.dispute === 'lost') && entry.paidCurrency === 'usd') {
        tx.reverse(paymentIntentId, entry.packMicros);
      }
      if (lost && amount === null) return note('invalid_dispute_amount');
      if (!opened && !['lost', 'won', 'warning_closed'].includes(object.status)) return note('unrecognized_dispute_close');
    });
  }

  const badRequest = () => Response.json({ error: { category: 'request_failed' } }, { status: 400 });
  const received = () => Response.json({ received: true });
  return async function stripeWebhook(request) {
    if (request.method !== 'POST') return badRequest();
    let event;
    try {
      const raw = await readBoundedBytes(request);
      if (raw.tooLarge) return Response.json(bodyTooLarge(), { status: 413 });
      if (!raw.bytes || !hasJsonMediaType(request) ||
          !validSignature(raw.bytes, request.headers.get('stripe-signature'), endpointSecret, now())) {
        return badRequest();
      }
      event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw.bytes));
    } catch {
      return badRequest();
    }
    const eventId = stripeId(event?.id, 'evt_');
    const type = event?.type;
    if (!eventId || typeof type !== 'string') return badRequest();
    if (event.livemode !== livemode) {
      diagnostic({ eventId, reason: 'livemode_mismatch' });
      return received();
    }
    if (!CHECKOUT_EVENTS.has(type) && type !== REFUND && type !== DISPUTE_OPEN && type !== DISPUTE_CLOSED) {
      diagnostic({ eventId, reason: 'verified_unhandled' });
      return received();
    }
    const object = event.data?.object;
    if (!object || typeof object !== 'object' || Array.isArray(object)) return badRequest();
    apply(eventId, type, object);
    return received();
  };
}
