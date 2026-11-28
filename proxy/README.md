# Managed key proxy tracer

This package is the preparation-only E2–E6 implementation of the managed-key spec. It exports a Fetch-style handler, a transactional SQLite ledger, a provider adapter requiring an injected transport and an HTTPS `.invalid` base, and a Stripe webhook verifier. The tracer has no listener, host configuration, account setup, or service credentials.

Run the offline suite from the repository root of this worktree:

```sh
nix develop --command bazel test --spawn_strategy=linux-sandbox //proxy:proxy_test
```

The JSON fixtures in `test/fixtures/` are hand-written. They use the field shapes documented for [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/object), [Charges](https://docs.stripe.com/api/charges/object), and [Disputes](https://docs.stripe.com/api/disputes/object). Tests compute `Stripe-Signature` locally over the raw bytes using a fixture secret and an injected clock.

The default SQLite store is in memory. It holds the idempotency hashes in the same transaction as the reservation. Each handler keeps replay bodies in its own memory for up to 60 seconds. Crash recovery requires file-backed SQLite. Keep the ledger and its adjacent `.finalizations` SQLite journal together when reopening it. The journal stages primary outcomes and late evidence separately and holds billing metadata such as reservation IDs and token counts. Enrollment, account-opening rate limits, active pricing and the operator stop latch are shared by handlers that open the same ledger. Admission checks the price row against the ledger clock and its 30-day freshness limit. The table carries an unverified output bound and a calendar-based freshness test. Real provider billing, account configuration, and deployment remain gated by the spec.
