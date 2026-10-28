import { CycleSettlementLive } from '@repo/billing';
import {
  BillingCustomerRepoDefault,
  ContractBillingRepoDefault,
  ContractRepoDefault,
  PaymentRepoDefault,
  PayoutAccountRepoDefault,
  SessionResolutionRepoDefault,
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
  TaxConfigRepoDefault,
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
