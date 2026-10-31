/** Staging UAT: the admin billing fast-forward, backed by /admin/billing-clock
 * (permission `billingClock`; mounted only where the API's switch is on) and
 * /admin/capabilities (always mounted: whether to show it in the nav). */
import { apiClient, call, type ErrorsOf } from './client';

const capabilitiesEndpoint = apiClient.admin.capabilities.$get;
const contractsEndpoint = apiClient.admin['billing-clock'].contracts.$get;
const contractEndpoint = apiClient.admin['billing-clock'].contracts[':id'].$get;
const runEndpoint = apiClient.admin['billing-clock'].contracts[':id'].runs.$post;

export type BillingClockOverview = Extract<
	Awaited<ReturnType<typeof listBillingClockContracts>>,
	{ ok: true }
>['data'];
export type BillingClockContractRow = BillingClockOverview['contracts'][number];
export type BillingClockDetail = Extract<
	Awaited<ReturnType<typeof getBillingClockContract>>,
	{ ok: true }
>['data'];
export type BillingClockEvent = BillingClockDetail['events'][number];
export type BillingClockRun = BillingClockDetail['runs'][number];

export type BillingClockError =
	| ErrorsOf<typeof contractsEndpoint>
	| ErrorsOf<typeof contractEndpoint>
	| ErrorsOf<typeof runEndpoint>;

export async function getAdminCapabilities() {
	return call(capabilitiesEndpoint());
}

export async function listBillingClockContracts() {
	return call(contractsEndpoint());
}

export async function getBillingClockContract(contractId: string) {
	return call(contractEndpoint({ param: { id: contractId } }));
}

/** Runs the contract's billing as of `until` (an ISO instant). */
export async function runBillingClock(contractId: string, until: string) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id: contractId }, json: { until } } as unknown as Parameters<
		typeof runEndpoint
	>[0];
	return call(runEndpoint(args));
}
