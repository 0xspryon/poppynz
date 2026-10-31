import type {
  AccountingRepo,
  ReconciliationRepo,
  BillingClockRunRepo,
  ApprovalRepo,
  ApprovalRequestRepo,
  BillingCustomerRepo,
  CheckOrderRepo,
  ContractAgreementRepo,
  CardDisputeRepo,
  SessionResolutionRepo,
  SessionMoneyRepo,
  ExtraSessionRepo,
  ContractReplacementRepo,
  ContractBillingRepo,
  ContractRepo,
  ConversationRepo,
  FamilySearchOutboxRepo,
  FamilySearchRepo,
  KycDocumentRepo,
  KycDocumentTypeRepo,
  PaymentRepo,
  PayoutAccountRepo,
  ServiceCatalogueRepo,
  ServiceNeededRepo,
  ServiceOfferedRepo,
  SessionRepo,
  TcDocumentRepo,
  UserDismissalRepo,
  SignupIntentRepo,
  ProviderSearchOutboxRepo,
  ProviderSearchRepo,
  ReferralRepo,
  SafetyVerificationRepo,
  StripeWebhookEventRepo,
  TaxConfigRepo,
  TaxReportRepo,
  UserDirectoryRepo,
  UserProfileRepo,
  UserRepo,
  UserSearchRepo,
  VouchRepo
} from '@repo/db';
import type { CardDisputeLedger, CycleSettlement } from '@repo/billing';
import type { GooglePlaces } from '@repo/google';
import type { Credibled } from '@repo/credibled';
import type { NotificationHub } from '@repo/notify';
import type { ObjectStorage } from '@repo/objs';
import type { Payments } from '@repo/payments';
import type { FamilySearchQueue, ProviderSearchQueue, SafetyVerificationQueue } from '@repo/queue';
import type { FamilySearchIndex, ProviderSearchIndex } from '@repo/typesense';
import type { ManagedRuntime } from 'effect';
import type { SigninService } from './routes/app/auth/signin/signin.handler';
import type { SignupService } from './routes/app/auth/signup/signup.handler';
import type { AuthService } from './lib/effect-auth';
import type { Mailer } from './lib/mailer';
import type { Env, Handler } from 'hono';

export type AppServices =
  | SignupIntentRepo
  | SigninService
  | SignupService
  | UserProfileRepo
  | UserRepo
  | SessionRepo
  | ApprovalRepo
  | ApprovalRequestRepo
  | KycDocumentRepo
  | KycDocumentTypeRepo
  | ServiceCatalogueRepo
  | ServiceNeededRepo
  | ServiceOfferedRepo
  | TcDocumentRepo
  | UserDismissalRepo
  | ProviderSearchOutboxRepo
  | ProviderSearchRepo
  | FamilySearchOutboxRepo
  | FamilySearchRepo
  | ReferralRepo
  | VouchRepo
  | SafetyVerificationRepo
  | CheckOrderRepo
  | PaymentRepo
  | BillingCustomerRepo
  | StripeWebhookEventRepo
  | TaxConfigRepo
  | TaxReportRepo
  | PayoutAccountRepo
  | UserDirectoryRepo
  | UserSearchRepo
  | ConversationRepo
  | ContractRepo
  | ContractBillingRepo
  | ContractAgreementRepo
  | CardDisputeRepo
  | SessionResolutionRepo
  | SessionMoneyRepo
  | ExtraSessionRepo
  | ContractReplacementRepo
  // Tier 3 step 5: the accountant's ledger, reports and reconciliation.
  | AccountingRepo
  | ReconciliationRepo
  | BillingClockRunRepo
  | CardDisputeLedger
  | CycleSettlement
  | NotificationHub
  | Mailer
  | GooglePlaces
  | ObjectStorage
  | ProviderSearchQueue
  | ProviderSearchIndex
  | FamilySearchQueue
  | FamilySearchIndex
  | SafetyVerificationQueue
  | Credibled
  | Payments
  | AuthService;

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>;

export type BaseAppEnv = {
  Variables: {
    runtime: AppRuntime;
    language: 'en' | 'fr';
  };
};

export type HonoEnv = {
  Variables: {
    requestId: string;
  } & BaseAppEnv['Variables'];
};
export type HonoContext<T extends Env> = Parameters<Handler<T>>[0];
