/** Helper payout account (Stripe Connect, piece 2b), backed by /payouts. */
import { apiClient, call, type ErrorsOf } from './client';

const statusEndpoint = apiClient.payouts.$get;
const onboardingEndpoint = apiClient.payouts.onboarding.$post;
const refreshEndpoint = apiClient.payouts.refresh.$post;
const dashboardEndpoint = apiClient.payouts.dashboard.$post;

export type PayoutsState = Extract<Awaited<ReturnType<typeof getPayouts>>, { ok: true }>['data'];
export type PayoutsStatus = NonNullable<PayoutsState['status']>;

export type PayoutsStatusError = ErrorsOf<typeof statusEndpoint>;
export type PayoutsOnboardingError = ErrorsOf<typeof onboardingEndpoint>;
export type PayoutsRefreshError = ErrorsOf<typeof refreshEndpoint>;
export type PayoutsDashboardError = ErrorsOf<typeof dashboardEndpoint>;

export async function getPayouts() {
	return call(statusEndpoint());
}

/** Creates the account if needed; returns a short-lived Stripe onboarding URL. */
export async function startPayoutsOnboarding() {
	return call(onboardingEndpoint());
}

/** Re-fetches the status from Stripe (after returning from Stripe's pages). */
export async function refreshPayouts() {
	return call(refreshEndpoint());
}

/** A login link to the Stripe Express payout dashboard. */
export async function openPayoutsDashboard() {
	return call(dashboardEndpoint());
}
