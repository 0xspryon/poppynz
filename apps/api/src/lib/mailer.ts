// The Mailer lives in @repo/mail so the worker can send too; this shim keeps
// the api's historical import path stable.
export * from '@repo/mail';
