import type {
  ApprovalRepo,
  ApprovalRequestRepo,
  ContractRepo,
  ConversationRepo,
  FamilySearchOutboxRepo,
  FamilySearchRepo,
  KycDocumentRepo,
  KycDocumentTypeRepo,
  ServiceCatalogueRepo,
  ServiceNeededRepo,
  ServiceOfferedRepo,
  SessionRepo,
  TcDocumentRepo,
  SignupIntentRepo,
  ProviderSearchOutboxRepo,
  ProviderSearchRepo,
  ReferralRepo,
  SafetyVerificationRepo,
  UserDirectoryRepo,
  UserProfileRepo,
  UserRepo,
  UserSearchRepo
} from '@repo/db';
import type { GooglePlaces } from '@repo/google';
import type { Credibled } from '@repo/credibled';
import type { NotificationHub } from '@repo/notify';
import type { ObjectStorage } from '@repo/objs';
import type { Payments } from '@repo/payments';
import type {
  FamilySearchQueue,
  ProviderSearchQueue,
  SafetyVerificationQueue
} from '@repo/queue';
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
  | ProviderSearchOutboxRepo
  | ProviderSearchRepo
  | FamilySearchOutboxRepo
  | FamilySearchRepo
  | ReferralRepo
  | SafetyVerificationRepo
  | UserDirectoryRepo
  | UserSearchRepo
  | ConversationRepo
  | ContractRepo
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
    language: 'en' | 'es';
  };
};

export type HonoEnv = {
  Variables: {
    requestId: string;
  } & BaseAppEnv['Variables'];
};
export type HonoContext<T extends Env> = Parameters<Handler<T>>[0];
