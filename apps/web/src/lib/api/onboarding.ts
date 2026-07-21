/** Provider onboarding state (screen 9a hub) + approval history (9d) +
 * submitting an approval request, backed by /me/onboarding and
 * /approval-requests. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const stateEndpoint = apiClient.me.onboarding.$get;
const historyEndpoint = apiClient.me.onboarding.history.$get;
const submitEndpoint = apiClient['approval-requests'].$post;

export type OnboardingState = Extract<Awaited<ReturnType<typeof getOnboardingState>>, { ok: true }>['data'];
export type OnboardingDocument = OnboardingState['documents'][number];
export type OnboardingHistory = Extract<Awaited<ReturnType<typeof getOnboardingHistory>>, { ok: true }>['data'];
export type OnboardingStateError = ErrorsOf<typeof stateEndpoint>;
export type OnboardingHistoryError = ErrorsOf<typeof historyEndpoint>;
export type SubmitApprovalRequestError = ErrorsOf<typeof submitEndpoint>;

export async function getOnboardingState() {
	return call(stateEndpoint());
}

export async function getOnboardingHistory() {
	return call(historyEndpoint());
}

export async function submitApprovalRequest() {
	return call(submitEndpoint());
}

export type { ApiResult };
