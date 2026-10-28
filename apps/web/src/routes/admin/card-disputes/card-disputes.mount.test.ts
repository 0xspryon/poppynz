// @vitest-environment jsdom
import { flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	listCardDisputes: vi.fn(),
	getCardDispute: vi.fn(),
	saveCardDisputeSummary: vi.fn(),
	submitCardDisputeEvidence: vi.fn(),
	allocateCardDispute: vi.fn(),
	suspendFamilyContracts: vi.fn(),
	resumeFamilyContracts: vi.fn(),
	getCardDisputeFlags: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn()
}));

vi.mock('$lib/api/card-disputes', () => api);
vi.mock('$lib/toast.svelte', () => ({
	toast: { success: api.toastSuccess, error: api.toastError, info: vi.fn() }
}));
vi.mock('$app/state', () => ({ page: { params: { id: 'dispute-1' } } }));

import AccountantCardDisputesPage from '../../accountant/card-disputes/+page.svelte';
import CardDisputeDetailPage from './[id]/+page.svelte';
import CardDisputesPage from './+page.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};
const click = (selector: string) => {
	document.querySelector<HTMLElement>(selector)?.click();
	flushSync();
};
const dialogButton = (label: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
		(button) => button.textContent?.trim() === label
	);
const type = (selector: string, value: string) => {
	const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
	element.value = value;
	element.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
};

const item = {
	id: 'dispute-1',
	providerReference: 'du_1',
	paymentId: 'payment-1',
	familyUserId: 'family-1',
	familyName: 'Priya Tester',
	contractId: 'contract-1',
	scope: 'cycle',
	amountCents: 13206,
	currency: 'cad',
	reason: 'fraudulent',
	status: 'needs_response',
	triage: 'needs_response',
	evidenceDueBy: '2099-11-05T23:59:59.000Z',
	openedAt: '2026-11-02T13:00:00.000Z',
	closedAt: null,
	money: { withdrawnCents: 13206, reinstatedCents: 0, feeCents: 1500, netCents: 14706 }
};

const session = {
	sessionId: 'session-1',
	date: '2026-11-02',
	serviceName: 'Childcare',
	startMinutes: 930,
	endMinutes: 1080,
	status: 'completed',
	familyTotalCents: 6604,
	helperShareCents: 5265,
	disputedCents: 6604,
	defaultHelperForfeitCents: 5265,
	allocation: null,
	allocationReason: null,
	helperForfeitCents: 0,
	recovered: false,
	allocatedAt: null,
	resolution: null,
	extraAuthorisation: null
};

const detail = (overrides: Record<string, unknown> = {}) => ({
	...item,
	chargeRefundable: false,
	evidenceSubmissionCount: 0,
	evidenceSummary: null,
	evidenceSummaryAt: null,
	suggestedSummary: 'Priya booked care with Sam through Poppynz.',
	evidenceFields: {
		uncategorized_text: 'Priya booked care with Sam through Poppynz.',
		customer_name: 'Priya Tester'
	},
	evidenceDocuments: { serviceDocumentation: ['Dispute'], customerCommunication: true },
	pack: {
		family: { userId: 'family-1', name: 'Priya Tester', email: 'p@x.test' },
		helper: { userId: 'helper-1', name: 'Sam Taylor' },
		contract: { id: 'contract-1', timeZone: 'America/Toronto', startsOn: '2026-11-02' },
		payment: null,
		cycle: null,
		agreement: [
			{
				side: 'family',
				signerName: 'Priya Tester',
				signedAt: '2026-10-26T00:00:00.000Z',
				contractVersion: 1,
				templateVersion: 2,
				locale: 'en',
				sha256: 'a'.repeat(64),
				cancellationPolicyVersion: 3,
				content: 'Service agreement text'
			}
		],
		sessions: [session],
		messages: [
			{ side: 'family', body: 'Thanks, all went well', sentAt: '2026-11-02T23:00:00.000Z' }
		],
		refunds: [],
		submissions: []
	},
	names: {},
	family: { suspended: false, contractIds: [], suspendable: ['contract-1'], history: [] },
	...overrides
});

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('the card disputes list', () => {
	it('lists disputes with what Poppynz bears, and links admins to each one', async () => {
		api.listCardDisputes.mockResolvedValue({
			ok: true,
			data: { disputes: [item], totals: { netCents: 14706, feeCents: 1500 } }
		});
		mount(CardDisputesPage, { target: document.body });
		await settle();
		expect(api.listCardDisputes).toHaveBeenCalledWith({ status: 'open', due: '' });
		expect(text()).toContain('Priya Tester');
		expect(text()).toContain('Response needed');
		expect(document.querySelector('[data-testid="card-dispute-borne"]')?.textContent).toContain(
			'147.06'
		);
		expect(document.querySelector('[data-testid="card-disputes-totals"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="card-dispute-open"]')).not.toBeNull();
		const due = document.querySelector<HTMLSelectElement>('[data-testid="card-disputes-due"]')!;
		due.value = 'overdue';
		due.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		expect(api.listCardDisputes).toHaveBeenLastCalledWith({ status: 'open', due: 'overdue' });
	});

	it('is read-only for the accountant', async () => {
		api.listCardDisputes.mockResolvedValue({
			ok: true,
			data: { disputes: [item], totals: { netCents: 14706, feeCents: 1500 } }
		});
		mount(AccountantCardDisputesPage, { target: document.body });
		await settle();
		expect(text()).toContain('Priya Tester');
		expect(document.querySelector('[data-testid="card-dispute-open"]')).toBeNull();
		expect(document.querySelector('[data-testid="card-dispute-borne"]')).not.toBeNull();
	});

	it('hides amounts the API did not return', async () => {
		api.listCardDisputes.mockResolvedValue({
			ok: true,
			data: { disputes: [{ ...item, money: null }], totals: null }
		});
		mount(CardDisputesPage, { target: document.body });
		await settle();
		expect(document.querySelector('[data-testid="card-dispute-borne"]')).toBeNull();
		expect(document.querySelector('[data-testid="card-disputes-totals"]')).toBeNull();
	});

	it('toasts when the list cannot be loaded', async () => {
		api.listCardDisputes.mockResolvedValue({
			ok: false,
			error: { code: 'FORBIDDEN', message: 'no' }
		});
		mount(CardDisputesPage, { target: document.body });
		await settle();
		expect(api.toastError).toHaveBeenCalledWith('You don’t have access to card disputes.');
	});
});

describe('one card dispute', () => {
	it('shows the pack and submits the edited summary after confirming', async () => {
		api.getCardDispute.mockResolvedValue({ ok: true, data: { dispute: detail() } });
		api.submitCardDisputeEvidence.mockResolvedValue({
			ok: true,
			data: {
				submission: {
					id: 's-1',
					submittedAt: '2026-11-03T00:00:00.000Z',
					providerStatus: 'under_review'
				}
			}
		});
		mount(CardDisputeDetailPage, { target: document.body });
		await settle();
		expect(text()).toContain('Thanks, all went well');
		expect(text()).toContain('a'.repeat(64));
		expect(document.querySelector('[data-testid="family-flagged"]')).not.toBeNull();
		type('[data-testid="evidence-summary"]', 'winning_evidence');
		click('[data-testid="evidence-submit"]');
		dialogButton('Submit to Stripe')?.click();
		await settle();
		expect(api.submitCardDisputeEvidence).toHaveBeenCalledWith('dispute-1', 'winning_evidence');
		expect(api.toastSuccess).toHaveBeenCalledWith('Evidence submitted to Stripe');
	});

	it('names the session report and a refund waiting for the dispute in plain words', async () => {
		const pack = detail().pack;
		api.getCardDispute.mockResolvedValue({
			ok: true,
			data: {
				dispute: detail({
					pack: {
						...pack,
						sessions: [
							{
								...session,
								resolution: {
									kind: 'family_cancelled_early',
									status: 'confirmed',
									reportedBySide: 'family',
									recordedAt: '2026-11-01T00:00:00.000Z',
									note: null,
									response: null,
									respondedAt: null,
									decision: null,
									decisionReason: null,
									decidedAt: null,
									policyVersion: 1,
									events: []
								}
							}
						],
						refunds: [
							{
								id: 'refund-1',
								sessionId: 'session-1',
								totalCents: 6604,
								status: 'pending',
								refundedAt: null,
								createdAt: '2026-11-03T00:00:00.000Z'
							}
						]
					}
				})
			}
		});
		mount(CardDisputeDetailPage, { target: document.body });
		await settle();
		expect(text()).not.toContain('family_cancelled_early');
		expect(text()).not.toContain('family cancelled early');
		expect(text()).toContain('Waiting for the dispute');
		expect(text()).not.toContain('· pending');
	});

	it('saves a draft, and refuses an empty summary', async () => {
		api.getCardDispute.mockResolvedValue({ ok: true, data: { dispute: detail() } });
		api.saveCardDisputeSummary.mockResolvedValue({
			ok: true,
			data: { dispute: { id: 'dispute-1' } }
		});
		mount(CardDisputeDetailPage, { target: document.body });
		await settle();
		click('[data-testid="evidence-save"]');
		await settle();
		expect(api.saveCardDisputeSummary).toHaveBeenCalledWith(
			'dispute-1',
			'Priya booked care with Sam through Poppynz.'
		);
		type('[data-testid="evidence-summary"]', '  ');
		click('[data-testid="evidence-submit"]');
		expect(api.toastError).toHaveBeenCalledWith('Write the summary for the bank first.');
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it('records a lost dispute’s decision per session (a helper decision needs a reason)', async () => {
		api.getCardDispute.mockResolvedValue({
			ok: true,
			data: {
				dispute: detail({
					status: 'lost',
					triage: 'allocation_needed',
					closedAt: '2026-11-20T00:00:00.000Z'
				})
			}
		});
		api.allocateCardDispute.mockResolvedValue({ ok: true, data: { allocations: [] } });
		mount(CardDisputeDetailPage, { target: document.body });
		await settle();
		click('[data-testid="allocate-submit"]');
		expect(api.toastError).toHaveBeenCalledWith(
			'Choose for each session; a helper decision needs a reason.'
		);
		click('input[value="helper_not_provided"]');
		click('[data-testid="allocate-submit"]');
		expect(api.allocateCardDispute).not.toHaveBeenCalled();
		type('[data-testid="allocation-form"] textarea', 'The helper did not come');
		click('[data-testid="allocate-submit"]');
		await settle();
		expect(api.allocateCardDispute).toHaveBeenCalledWith('dispute-1', [
			{
				sessionId: 'session-1',
				allocation: 'helper_not_provided',
				reason: 'The helper did not come',
				helperForfeitCents: null
			}
		]);
		expect(api.toastSuccess).toHaveBeenCalledWith('Decision recorded');
	});

	it('suspends the family’s contracts with a reason and a note', async () => {
		api.getCardDispute.mockResolvedValue({ ok: true, data: { dispute: detail() } });
		api.suspendFamilyContracts.mockResolvedValue({
			ok: true,
			data: { contractIds: ['contract-1'] }
		});
		mount(CardDisputeDetailPage, { target: document.body });
		await settle();
		click('[data-testid="family-suspend"]');
		dialogButton('Suspend')?.click();
		flushSync();
		expect(api.toastError).toHaveBeenCalledWith('Choose a reason and describe what was found.');
		const reason = document.querySelector<HTMLSelectElement>('[data-testid="suspend-reason"]')!;
		reason.value = 'suspected_fraud';
		reason.dispatchEvent(new Event('change', { bubbles: true }));
		type('[data-testid="suspend-note"]', 'Card reported stolen');
		dialogButton('Suspend')?.click();
		await settle();
		expect(api.suspendFamilyContracts).toHaveBeenCalledWith('family-1', {
			reason: 'suspected_fraud',
			note: 'Card reported stolen',
			disputeId: 'dispute-1'
		});
		expect(api.toastSuccess).toHaveBeenCalledWith('The family’s contracts are suspended');
	});

	it('resumes them when an admin holds them', async () => {
		api.getCardDispute.mockResolvedValue({
			ok: true,
			data: {
				dispute: detail({
					family: { suspended: true, contractIds: ['contract-1'], suspendable: [], history: [] }
				})
			}
		});
		api.resumeFamilyContracts.mockResolvedValue({
			ok: true,
			data: { contractIds: ['contract-1'] }
		});
		mount(CardDisputeDetailPage, { target: document.body });
		await settle();
		expect(document.querySelector('[data-testid="family-suspended"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="family-suspend"]')).toBeNull();
		click('[data-testid="family-resume"]');
		type('[data-testid="resume-note"]', 'Cleared with the bank');
		dialogButton('Resume')?.click();
		await settle();
		expect(api.resumeFamilyContracts).toHaveBeenCalledWith('family-1', 'Cleared with the bank');
	});

	it('says when the dispute is not found', async () => {
		api.getCardDispute.mockResolvedValue({
			ok: false,
			error: { code: 'CARD_DISPUTE_NOT_FOUND', message: 'Not found.' }
		});
		mount(CardDisputeDetailPage, { target: document.body });
		await settle();
		expect(text()).toContain('This card dispute doesn’t exist.');
	});
});
