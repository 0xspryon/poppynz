import {
  ApprovalRepoDefault,
  ApprovalRequestRepoDefault,
  BillingCustomerRepoDefault,
  CheckOrderRepoDefault,
  ContractAgreementRepoDefault,
  ContractReplacementRepoDefault,
  CardDisputeRepoDefault,
  SessionResolutionRepoDefault,
  SessionMoneyRepoDefault,
  ContractBillingRepoDefault,
  ContractRepoDefault,
  ConversationRepoDefault,
  FamilySearchOutboxRepoDefault,
  FamilySearchRepoDefault,
  KycDocumentRepoDefault,
  KycDocumentTypeRepoDefault,
  PaymentRepoDefault,
  PayoutAccountRepoDefault,
  SessionRepoDefault,
  ServiceCatalogueRepoDefault,
  ServiceNeededRepoDefault,
  ServiceOfferedRepoDefault,
  TcDocumentRepoDefault,
  UserDismissalRepoDefault,
  SignupIntentRepoDefault,
  ProviderSearchOutboxRepoDefault,
  ProviderSearchRepoDefault,
  ReferralRepoDefault,
  SafetyVerificationRepoDefault,
  StripeWebhookEventRepoDefault,
  TaxConfigRepoDefault,
  TaxReportRepoDefault,
  UserDirectoryRepoDefault,
  UserProfileRepoDefault,
  UserRepoDefault,
  UserSearchRepoDefault,
  VouchRepoDefault
} from '@repo/db';
import { CycleSettlementLive } from '@repo/billing';
import { CredibledDefault } from '@repo/credibled';
import { GooglePlacesLive } from '@repo/google';
import { NotificationHubLive } from '@repo/notify';
import { ObjectStorageLive } from '@repo/objs';
import { PaymentsLive } from '@repo/payments';
import {
  FamilySearchQueueLive,
  ProviderSearchQueueLive,
  SafetyVerificationQueueLive
} from '@repo/queue';
import { FamilySearchIndexDefault, ProviderSearchIndexDefault } from '@repo/typesense';
import { Layer, ManagedRuntime } from 'effect';
import type { AppRuntime } from './app-env';
import { AuthServiceLive } from './lib/effect-auth';
import { MailerLive } from './lib/mailer';
import { SigninServiceLive } from './routes/app/auth/signin/signin.handler';
import { SignupServiceLive } from './routes/app/auth/signup/signup.handler';

const BaseLive = Layer.mergeAll(
  SignupIntentRepoDefault,
  UserProfileRepoDefault,
  UserRepoDefault,
  SessionRepoDefault,
  ApprovalRepoDefault,
  ApprovalRequestRepoDefault,
  KycDocumentRepoDefault,
  KycDocumentTypeRepoDefault,
  ServiceCatalogueRepoDefault,
  ServiceNeededRepoDefault,
  ServiceOfferedRepoDefault,
  TcDocumentRepoDefault,
  UserDismissalRepoDefault,
  ProviderSearchOutboxRepoDefault,
  ProviderSearchRepoDefault,
  FamilySearchOutboxRepoDefault,
  FamilySearchRepoDefault,
  ReferralRepoDefault,
  VouchRepoDefault,
  SafetyVerificationRepoDefault,
  CheckOrderRepoDefault,
  PaymentRepoDefault,
  BillingCustomerRepoDefault,
  StripeWebhookEventRepoDefault,
  TaxConfigRepoDefault,
  TaxReportRepoDefault,
  PayoutAccountRepoDefault,
  UserDirectoryRepoDefault,
  UserSearchRepoDefault,
  ConversationRepoDefault,
  ContractRepoDefault,
  ContractBillingRepoDefault,
  ContractAgreementRepoDefault,
  ContractReplacementRepoDefault,
  // Tier 3 step 4: card disputes (chargebacks).
  CardDisputeRepoDefault,
  SessionResolutionRepoDefault,
  // Tier 3 step 2: session refunds, transfers, the manual payout queue.
  SessionMoneyRepoDefault,
  NotificationHubLive,
  GooglePlacesLive,
  MailerLive,
  ObjectStorageLive,
  ProviderSearchQueueLive,
  ProviderSearchIndexDefault,
  FamilySearchQueueLive,
  FamilySearchIndexDefault,
  SafetyVerificationQueueLive,
  CredibledDefault,
  // PAYMENTS_PROVIDER picks the gateway (default `mock`); with `stripe` a
  // missing or live secret key fails the boot rather than charging nothing.
  PaymentsLive,
  SigninServiceLive,
  SignupServiceLive,
  AuthServiceLive
);

// Contract-cycle payments settle through the one settle path with contract
// billing's own dependencies (piece 3).
export const AppLive = CycleSettlementLive.pipe(Layer.provideMerge(BaseLive));

export const makeAppRuntime = (): AppRuntime => ManagedRuntime.make(AppLive) as AppRuntime;
