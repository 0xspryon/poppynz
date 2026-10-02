/** A family's card on file and payment history, backed by /billing. */
import { apiClient, call, type ErrorsOf } from './client';

const getEndpoint = apiClient.billing.$get;
const setupEndpoint = apiClient.billing.card.setup.$post;
const confirmEndpoint = apiClient.billing.card.confirm.$post;

export type BillingData = Extract<Awaited<ReturnType<typeof getBilling>>, { ok: true }>['data'];
export type BillingCard = NonNullable<BillingData['card']>;
export type BillingPayment = BillingData['payments'][number];
export type BillingError = ErrorsOf<typeof getEndpoint>;
export type CardSetupError = ErrorsOf<typeof setupEndpoint> | ErrorsOf<typeof confirmEndpoint>;

export async function getBilling() {
	return call(getEndpoint());
}

/** Starts adding or replacing the card: a setup the Payment Element confirms. */
export async function startCardSetup() {
	return call(setupEndpoint());
}

/** After the browser confirmed the setup: the server re-fetches it and keeps
 * the card. */
export async function confirmCardSetup(setupId: string) {
	return call(confirmEndpoint({ json: { setupId } }));
}
