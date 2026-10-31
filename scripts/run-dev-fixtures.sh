#!/bin/sh
# DEV ONLY. Run by the compose `dev-fixtures` service after the seeds: creates
# (or reuses) the ready-made UAT accounts so a fresh `docker compose up` can be
# tested straight away — Fiona (billing-family@example.test), Hana
# (billing-helper@example.test) and the replacement helpers Robin, Theo and
# Paula. Idempotent; the billing fixture's own guards refuse anything but a
# local dev database.
#
# Opt in from apps/api/.env with ENVIRONMENT=dev and DEV_FIXTURES=enabled.
# DEV_HELPER_PAYOUT_ACCOUNT=acct_… (a Stripe TEST connected account) also links
# Hana's payout account, so contracts with her can be billed. Create one with:
#   bun --env-file=apps/api/.env packages/payments/scripts/e2e-payout-account.ts create-ready
set -eu

if [ "${ENVIRONMENT:-}" != "dev" ] || [ "${DEV_FIXTURES:-}" != "enabled" ]; then
	printf 'Dev fixtures skipped (set ENVIRONMENT=dev and DEV_FIXTURES=enabled to create the UAT accounts)\n'
	exit 0
fi

set -- --replacement-helpers
if [ -n "${DEV_HELPER_PAYOUT_ACCOUNT:-}" ]; then
	set -- "$@" --payout-account "$DEV_HELPER_PAYOUT_ACCOUNT"
else
	printf 'DEV_HELPER_PAYOUT_ACCOUNT is not set: Hana gets no payout account, so contracts with her wait for payout setup\n'
fi

TZ=UTC BILLING_DEV_CLOCK=enabled bun apps/worker/src/dev/billing-fixture.ts "$@"
printf 'Dev fixtures ready\n'
