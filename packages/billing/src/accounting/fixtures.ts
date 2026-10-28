import {
  emptyAccountingSources,
  type AccountingSources,
  type BillingIncident,
  type BillingLedgerEntry,
  type ExtraSession,
  type HelperRecovery,
  type HelperTransfer,
  type ManualPayout,
  type PaymentTaxLine,
  type SessionRefund
} from '@repo/db';

/**
 * Test support for the accountant's views (Tier 3 step 5): one contract
 * (Fiona the family, Hana the helper), a cycle, a session and its charge,
 * and builders for each kind of row the ledger reads. Exported so the API's
 * route tests build the same world.
 */

export const ACCOUNTING_IDS = {
  contract: '0198b000-0000-7000-8000-00000000c001',
  cycle: '0198b000-0000-7000-8000-00000000c002',
  session: '0198b000-0000-7000-8000-00000000c003',
  payment: '0198b000-0000-7000-8000-00000000c004',
  family: 'family-fiona',
  helper: 'helper-hana',
  accountant: 'accountant-ada',
  admin: 'admin-alex'
} as const;

const T = (iso: string) => new Date(iso);

export const taxLine = (
  supplyType: string,
  baseCents: number,
  taxCents: number
): PaymentTaxLine => ({
  supplyType,
  jurisdiction: 'ON',
  component: 'hst',
  rateMillipercent: 13000,
  baseCents,
  taxCents,
  label: 'HST (ON) 13%',
  registrationNumber: null
});

export const refundRow = (overrides: Partial<SessionRefund> = {}): SessionRefund => ({
  id: '0198b000-0000-7000-8000-000000000b01',
  refundKey: 'res-1:family_late:0',
  sessionId: ACCOUNTING_IDS.session,
  resolutionId: '0198b000-0000-7000-8000-00000000d001',
  cycleId: ACCOUNTING_IDS.cycle,
  contractId: ACCOUNTING_IDS.contract,
  paymentId: ACCOUNTING_IDS.payment,
  careCents: 4688,
  careTaxLines: [],
  careTaxCents: 0,
  feeCents: 312,
  feeTaxLines: [taxLine('family_fee', 312, 41)],
  feeTaxCents: 41,
  totalCents: 5041,
  commissionCents: 937,
  commissionTaxLines: [taxLine('provider_commission', 937, 122)],
  status: 'succeeded',
  attempts: 1,
  providerReference: 're_1',
  failureReason: null,
  noticesSent: [],
  refundedAt: T('2026-11-04T15:00:00.000Z'),
  resolvedByUserId: null,
  resolvedNote: null,
  handledAt: null,
  createdAt: T('2026-11-04T14:59:00.000Z'),
  updatedAt: T('2026-11-04T15:00:00.000Z'),
  ...overrides
});

export const recoveryRow = (overrides: Partial<HelperRecovery> = {}): HelperRecovery =>
  ({
    id: '0198b000-0000-7000-8000-000000000b02',
    recoveryKey: 'rec-1',
    helperUserId: ACCOUNTING_IDS.helper,
    contractId: ACCOUNTING_IDS.contract,
    sessionId: ACCOUNTING_IDS.session,
    resolutionId: null,
    cardDisputeId: null,
    amountCents: 4212,
    recoveredCents: 0,
    status: 'outstanding',
    createdAt: T('2026-11-10T12:00:00.000Z'),
    updatedAt: T('2026-11-10T12:00:00.000Z'),
    ...overrides
  }) as HelperRecovery;

export const transferRow = (overrides: Partial<HelperTransfer> = {}): HelperTransfer => ({
  id: '0198b000-0000-7000-8000-000000000b03',
  cycleId: ACCOUNTING_IDS.cycle,
  contractId: ACCOUNTING_IDS.contract,
  helperUserId: ACCOUNTING_IDS.helper,
  sequence: 1,
  status: 'manual_review',
  dueAt: T('2026-11-07T05:00:00.000Z'),
  grossCents: 10531,
  recoveredCents: 0,
  amountCents: 10531,
  attempts: 0,
  providerReference: null,
  sourceReference: null,
  failureReason: null,
  noticesSent: [],
  fixedAt: T('2026-11-07T05:00:00.000Z'),
  sentAt: null,
  paidAt: null,
  payoutReference: null,
  payoutMatch: null,
  createdAt: T('2026-11-07T05:00:00.000Z'),
  updatedAt: T('2026-11-07T05:00:00.000Z'),
  ...overrides
});

export const manualPayoutRow = (overrides: Partial<ManualPayout> = {}): ManualPayout => ({
  id: '0198b000-0000-7000-8000-000000000b04',
  transferId: transferRow().id,
  helperUserId: ACCOUNTING_IDS.helper,
  amountCents: 10531,
  method: 'interac_etransfer',
  reference: 'ET-42',
  reason: 'restricted account for 60 days',
  status: 'pending_approval',
  recordedByUserId: ACCOUNTING_IDS.admin,
  recordedAt: T('2027-01-06T12:00:00.000Z'),
  decidedByUserId: null,
  decidedAt: null,
  decisionNote: null,
  createdAt: T('2027-01-06T12:00:00.000Z'),
  updatedAt: T('2027-01-06T12:00:00.000Z'),
  ...overrides
});

export const absorbedEntry = (overrides: Partial<BillingLedgerEntry> = {}): BillingLedgerEntry => ({
  id: '0198b000-0000-7000-8000-000000000b05',
  contractId: ACCOUNTING_IDS.contract,
  cycleId: ACCOUNTING_IDS.cycle,
  sessionId: null,
  paymentId: null,
  entryKey: `cycle:${ACCOUNTING_IDS.cycle}:carry_absorbed`,
  kind: 'carry_absorbed',
  party: 'platform',
  amountCents: 37,
  label: null,
  createdAt: T('2026-11-03T05:00:00.000Z'),
  ...overrides
});

export const incidentRow = (overrides: Partial<BillingIncident> = {}): BillingIncident => ({
  id: '0198b000-0000-7000-8000-000000000b06',
  contractId: ACCOUNTING_IDS.contract,
  cycleId: ACCOUNTING_IDS.cycle,
  kind: 'capture_failed',
  detail: 'the hold expired before the capture',
  resolvedAt: null,
  createdAt: T('2026-11-05T05:00:00.000Z'),
  ...overrides
});

export const extraSessionRow = (overrides: Partial<ExtraSession> = {}): ExtraSession =>
  ({
    id: '0198b000-0000-7000-8000-000000000b07',
    contractId: ACCOUNTING_IDS.contract,
    proposedByUserId: ACCOUNTING_IDS.family,
    proposedBySide: 'family',
    date: '2026-11-06',
    startMinutes: 540,
    endMinutes: 660,
    startsAt: T('2026-11-06T14:00:00.000Z'),
    endsAt: T('2026-11-06T16:00:00.000Z'),
    elapsedMinutes: 120,
    serviceId: 'babysitting',
    serviceName: 'Babysitting',
    rateCents: 2500,
    valueCents: 5000,
    quotedTotalCents: 5283,
    note: null,
    status: 'charge_failed',
    respondBy: T('2026-11-08T14:00:00.000Z'),
    respondedByUserId: ACCOUNTING_IDS.helper,
    respondedAt: T('2026-11-06T17:00:00.000Z'),
    responseNote: null,
    familyAuthorisedAt: T('2026-11-06T13:00:00.000Z'),
    familyAuthorisedCents: 5283,
    agreedAt: T('2026-11-06T17:00:00.000Z'),
    chargeAt: T('2026-11-06T18:00:00.000Z'),
    cancelledByUserId: null,
    cancelledAt: null,
    sessionId: '0198b000-0000-7000-8000-00000000c013',
    cycleId: ACCOUNTING_IDS.cycle,
    paymentId: '0198b000-0000-7000-8000-00000000c014',
    chargeAttempts: 2,
    nextRetryAt: T('2026-11-07T06:00:00.000Z'),
    familyTotalCents: 5283,
    taxLines: [],
    chargedAt: null,
    lastError: 'Your card was declined.',
    noticesSent: [],
    createdAt: T('2026-11-06T13:00:00.000Z'),
    updatedAt: T('2026-11-06T18:00:00.000Z'),
    ...overrides
  }) as ExtraSession;

/** The world's contract, cycle, session, payment and people, plus rows. */
export const accountingSources = (
  overrides: Partial<AccountingSources> = {}
): AccountingSources => ({
  ...emptyAccountingSources(),
  sessions: [
    {
      id: ACCOUNTING_IDS.session,
      contractId: ACCOUNTING_IDS.contract,
      cycleId: ACCOUNTING_IDS.cycle,
      date: '2026-11-05',
      serviceName: 'Babysitting',
      startMinutes: 540
    }
  ],
  cycles: [
    {
      id: ACCOUNTING_IDS.cycle,
      contractId: ACCOUNTING_IDS.contract,
      index: 0,
      startsOn: '2026-11-05',
      endsOn: '2026-11-07',
      paymentId: ACCOUNTING_IDS.payment,
      providerShareCents: 10531
    }
  ],
  contracts: [
    {
      id: ACCOUNTING_IDS.contract,
      familyUserId: ACCOUNTING_IDS.family,
      providerUserId: ACCOUNTING_IDS.helper
    }
  ],
  payments: [
    {
      id: ACCOUNTING_IDS.payment,
      userId: ACCOUNTING_IDS.family,
      kind: 'contract_cycle',
      provider: 'stripe',
      providerReference: 'pi_1',
      refundReference: null,
      status: 'captured',
      totalCents: 13206,
      capturedCents: 13206,
      taxCents: 0,
      taxLines: [],
      capturedAt: T('2026-11-04T05:00:00.000Z'),
      refundedAt: null
    }
  ],
  users: [
    { id: ACCOUNTING_IDS.family, name: 'Fiona Family', email: 'fiona@example.test' },
    { id: ACCOUNTING_IDS.helper, name: 'Hana Helper', email: 'hana@example.test' },
    { id: ACCOUNTING_IDS.accountant, name: 'Ada Accountant', email: 'ada@example.test' },
    { id: ACCOUNTING_IDS.admin, name: 'Alex Admin', email: 'alex@example.test' }
  ],
  ...overrides
});
