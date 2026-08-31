import {
  ApprovalRepoDefault,
  ApprovalRequestRepoDefault,
  ContractRepoDefault,
  ConversationRepoDefault,
  FamilySearchOutboxRepoDefault,
  FamilySearchRepoDefault,
  KycDocumentRepoDefault,
  KycDocumentTypeRepoDefault,
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
  UserDirectoryRepoDefault,
  UserProfileRepoDefault,
  UserRepoDefault,
  UserSearchRepoDefault
} from '@repo/db';
import { CredibledDefault } from '@repo/credibled';
import { GooglePlacesLive } from '@repo/google';
import { NotificationHubLive } from '@repo/notify';
import { ObjectStorageLive } from '@repo/objs';
import { PaymentsMock } from '@repo/payments';
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
  SafetyVerificationRepoDefault,
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
  // Stripe lands in its own PR; until then the port resolves to the mock so
  // the ordering, refund and retry paths are exercised end to end.
  PaymentsMock,
  SigninServiceLive,
  SignupServiceLive,
  AuthServiceLive
);

export const makeAppRuntime = (): AppRuntime => ManagedRuntime.make(AppLive) as AppRuntime;
