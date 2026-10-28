import { CardDisputeLedgerNone, CycleSettlementLive } from '@repo/billing';
import {
  BillingCustomerRepoDefault,
  ReconciliationRepoDefault,
  ContractBillingRepoDefault,
  ContractRepoDefault,
  ExtraSessionRepoDefault,
  PaymentRepoDefault,
  PayoutAccountRepoDefault,
  SessionResolutionRepoDefault,
  SessionMoneyRepoDefault,
  TaxConfigRepoDefault,
  UserProfileRepoDefault,
  UserRepoDefault
} from '@repo/db';
import { MailerLive } from '@repo/mail';
import { NotificationHubLive } from '@repo/notify';
import { PaymentsLive } from '@repo/payments';
import { Layer } from 'effect';

/** Everything contract billing (piece 3) needs, shared by the worker's tick
 * and the dev-only clock so both run exactly the same program. */
export const ContractBillingBaseLive = Layer.mergeAll(
  ContractBillingRepoDefault,
  ContractRepoDefault,
  PaymentRepoDefault,
  BillingCustomerRepoDefault,
  PayoutAccountRepoDefault,
  // Tier 3: the session-resolution step of the same tick.
  SessionResolutionRepoDefault,
  // Tier 3 step 2: session refunds and transfers of the same tick.
  SessionMoneyRepoDefault,
  // Tier 3 step 3: extra sessions of the same tick.
  ExtraSessionRepoDefault,
  TaxConfigRepoDefault,
  // Tier 3 step 5: the scheduled reconciliation with the provider (card
  // disputes plug in through the step-4 adapter).
  ReconciliationRepoDefault,
  CardDisputeLedgerNone,
  UserRepoDefault,
  UserProfileRepoDefault,
  // Same PAYMENTS_PROVIDER switch as the API (default `mock`).
  PaymentsLive,
  MailerLive,
  NotificationHubLive
);

/** Adds the cycle branch of the one settle path on top of `base`. */
export const withCycleSettlement = <A, E, R>(base: Layer.Layer<A, E, R>) =>
  CycleSettlementLive.pipe(Layer.provideMerge(base));
