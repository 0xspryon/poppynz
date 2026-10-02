import {
  ApprovalRepoDefault,
  ApprovalRequestRepoDefault,
  BillingCustomerRepoDefault,
  CheckOrderRepoDefault,
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
  SignupIntentRepoDefault,
  ProviderSearchOutboxRepoDefault,
  ProviderSearchRepoDefault,
  ReferralRepoDefault,
  SafetyVerificationRepoDefault,
  StripeWebhookEventRepoDefault,
  UserDirectoryRepoDefault,
  UserProfileRepoDefault,
  UserRepoDefault,
  UserSearchRepoDefault,
  VouchRepoDefault
} from '@repo/db';
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

export const AppLive = Layer.mergeAll(
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
  PayoutAccountRepoDefault,
  UserDirectoryRepoDefault,
  UserSearchRepoDefault,
  ConversationRepoDefault,
  ContractRepoDefault,
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

export const makeAppRuntime = (): AppRuntime => ManagedRuntime.make(AppLive) as AppRuntime;
