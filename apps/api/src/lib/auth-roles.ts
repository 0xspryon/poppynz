import { createAccessControl } from 'better-auth/plugins';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';

export const appAc = createAccessControl({
  // better-auth admin plugin resources (user, session) — required so its
  // endpoints (list/ban/impersonate) can authorize against our custom roles.
  ...defaultStatements,
  approval: ['write'],
  // `review` is the admin-only decision capability: deciding (reject/approve)
  // a submitted request and setting the admin's own general remarks on it.
  // Applicants keep `write` only, to create/submit their own request —
  // ownership there is enforced at the route (findSubmittedByUserId), since a
  // permission can't express "but only yours".
  approvalRequest: ['read', 'write', 'review'],
  // The card on file and payment history. Only families keep a card (it
  // funds contract billing); helpers pay one-off and never hold this.
  billing: ['read', 'write'],
  // Tier 3 step 4: card disputes (chargebacks). `read` lists them, `finance`
  // shows what Poppynz bears (the debit, the fee, what came back) — admins
  // and the accountant; `review` opens one with its evidence pack (the
  // signed agreement, messages), `respond` drafts and submits the evidence,
  // `decide` suspends or resumes a family's contracts and allocates a lost
  // dispute — admins only. Every action is audited.
  cardDispute: ['read', 'review', 'respond', 'decide', 'finance'],
  // `review` is the admin-only capability over someone else's contracts —
  // reading any contract's signed service agreement. Members keep read/write,
  // and ownership of their own contracts is enforced at the route.
  contract: ['read', 'write', 'review'],
  conversation: ['read', 'write'],
  // Tier 3 step 3: a party's own extra sessions — proposing one, answering
  // the other side's (the family with its authorisation of the charge),
  // withdrawing or cancelling. Being the contract's family or helper is
  // enforced at the route.
  extraSession: ['read', 'write'],
  familySearch: ['read', 'reindex'],
  // `review` is the admin-only capability over someone else's documents
  // (e.g. correcting an expiry date). Applicants keep `write`, which only
  // submits their own — ownership is enforced at the route.
  kycDocument: ['read', 'write', 'review'],
  kycDocumentType: ['read', 'write'],
  // A helper's own payout account (Stripe Connect). Ownership is implicit:
  // every /payouts route acts on the session user only.
  payouts: ['read', 'write'],
  // Tier 3 step 2: the manual payout queue — reading transfers that could
  // not be sent, recording a payout made outside Stripe, and approving one
  // another admin recorded (never your own). Admin-only; every action is
  // audited.
  payoutQueue: ['read', 'record', 'approve'],
  profile: ['read', 'update'],
  providerSearch: ['read', 'reindex'],
  referral: ['read', 'write'],
  // Tier 3 step 2: failed session refunds — reading them, retrying one and
  // marking one settled another way. Admins and the accountant.
  refundQueue: ['read', 'write'],
  // `review` is the admin-only decision capability: approving or rejecting a
  // verification, and reading the underlying report. Applicants get read+write
  // for their own record only — ownership is enforced at the route, since a
  // permission can't express "but only yours".
  safetyVerification: ['read', 'write', 'review'],
  serviceCatalogue: ['read', 'write'],
  serviceNeeded: ['read', 'write'],
  // `review` is the admin-only decision on a helper's custom service.
  serviceOffered: ['read', 'write', 'review'],
  // Tier 3: the admin dispute queue — reading contested session resolutions
  // (statements, the session, nearby messages, the signed agreement) and
  // deciding them. Admin-only; every decision is audited.
  sessionDispute: ['read', 'decide'],
  // Tier 3: a party's own session actions — cancelling, proposing a day off,
  // reporting, disputing and answering the other side. Being the contract's
  // family or helper is enforced at the route.
  sessionResolution: ['read', 'write'],
  // Sales-tax configuration (rates, supply-type treatments, registrations)
  // and its reports — the tax portal. Granted to admins and to the
  // accountant role; always checked as a permission, never a role.
  tax: ['read', 'write'],
  taxReport: ['read'],
  tcs: ['read', 'accept', 'write'],
  userSearch: ['read', 'write'],
  vouch: ['read', 'write', 'review']
});

export const familyRole = appAc.newRole({
  profile: ['read', 'update'],
  billing: ['read', 'write'],
  contract: ['read', 'write'],
  conversation: ['read', 'write'],
  extraSession: ['read', 'write'],
  providerSearch: ['read'],
  approvalRequest: ['write'],
  kycDocument: ['write'],
  referral: ['read', 'write'],
  safetyVerification: ['read', 'write'],
  serviceCatalogue: ['read'],
  serviceNeeded: ['read', 'write'],
  serviceOffered: ['read', 'write'],
  sessionResolution: ['read', 'write'],
  tcs: ['read', 'accept'],
  userSearch: ['write'],
  vouch: ['read', 'write']
});

export const spRole = appAc.newRole({
  profile: ['read', 'update'],
  contract: ['read', 'write'],
  conversation: ['read', 'write'],
  extraSession: ['read', 'write'],
  // familySearch is additionally gated on a live approval at the route level —
  // the permission alone doesn't make an unapproved provider a searcher.
  familySearch: ['read'],
  approvalRequest: ['write'],
  kycDocument: ['write'],
  payouts: ['read', 'write'],
  referral: ['read', 'write'],
  safetyVerification: ['read', 'write'],
  serviceCatalogue: ['read'],
  serviceOffered: ['read', 'write'],
  sessionResolution: ['read', 'write'],
  tcs: ['read', 'accept'],
  vouch: ['read', 'write']
});

export const adminRole = appAc.newRole({
  // Grants the admin plugin's own admin permissions (user ban/list/impersonate,
  // session management) — deliberately without "impersonate-admins".
  ...adminAc.statements,
  approval: ['write'],
  approvalRequest: ['read', 'write', 'review'],
  cardDispute: ['read', 'review', 'respond', 'decide', 'finance'],
  contract: ['read', 'write', 'review'],
  conversation: ['read', 'write'],
  familySearch: ['read', 'reindex'],
  kycDocument: ['read', 'write', 'review'],
  kycDocumentType: ['read', 'write'],
  payoutQueue: ['read', 'record', 'approve'],
  profile: ['read', 'update'],
  providerSearch: ['read', 'reindex'],
  referral: ['read', 'write'],
  refundQueue: ['read', 'write'],
  safetyVerification: ['read', 'write', 'review'],
  serviceCatalogue: ['read', 'write'],
  serviceNeeded: ['read', 'write'],
  serviceOffered: ['read', 'write', 'review'],
  sessionDispute: ['read', 'decide'],
  tax: ['read', 'write'],
  taxReport: ['read'],
  tcs: ['read', 'accept', 'write'],
  userSearch: ['read', 'write'],
  vouch: ['read', 'write', 'review']
});

/** Poppynz's accountant: the tax portal — the configuration (read and
 * correct, every change audited) and the tax-collected reports — and the
 * failed session refunds. */
export const accountantRole = appAc.newRole({
  // Card disputes: the list and what Poppynz bears, read-only (step 4).
  cardDispute: ['read', 'finance'],
  // Failed session refunds land with the accountant too (Tier 3 step 2).
  refundQueue: ['read', 'write'],
  tax: ['read', 'write'],
  taxReport: ['read']
});

export const roles = {
  admin: adminRole,
  accountant: accountantRole,
  family: familyRole,
  'service-provider': spRole
};

export type Role = keyof typeof roles;
export type Roles = Role;

export const isSupportedRole = (input: string): input is Role =>
  Object.prototype.hasOwnProperty.call(roles, input);
