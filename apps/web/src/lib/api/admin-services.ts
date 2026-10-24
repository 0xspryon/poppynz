/** Admin review of helpers' custom services (UAT #34), backed by
 * /admin/services-offered. */
import { apiClient, call, type ErrorsOf } from './client';

const listEndpoint = apiClient.admin['services-offered'].review.$get;
const reviewEndpoint = apiClient.admin['services-offered'][':id'].review.$post;

export type ServicesForReview = Extract<
	Awaited<ReturnType<typeof listServicesForReview>>,
	{ ok: true }
>['data'];
export type ServiceForReview = ServicesForReview['services'][number];
export type ServiceReviewError = ErrorsOf<typeof reviewEndpoint>;

export async function listServicesForReview() {
	return call(listEndpoint());
}

export async function reviewService(
	id: string,
	input: { decision: 'approve' | 'reject'; reason?: string | null }
) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: input } as unknown as Parameters<typeof reviewEndpoint>[0];
	return call(reviewEndpoint(args));
}
