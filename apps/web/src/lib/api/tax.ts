/** The accountant tax portal, backed by /tax. Access follows the `tax` and
 * `taxReport` permissions (accountants and admins), never the role. */
import { API_BASE_PATH } from 'api/hc';
import { apiClient, call, type ErrorsOf } from './client';

const accessEndpoint = apiClient.tax.access.$get;
const configEndpoint = apiClient.tax.config.$get;
const rateEndpoint = apiClient.tax.rates.$post;
const treatmentEndpoint = apiClient.tax.treatments.$post;
const registrationEndpoint = apiClient.tax.registrations.$post;
const auditEndpoint = apiClient.tax.audit.$get;
const reportEndpoint = apiClient.tax.reports.collected.$get;

export type TaxAccess = Extract<Awaited<ReturnType<typeof getTaxAccess>>, { ok: true }>['data'];
export type TaxConfig = Extract<Awaited<ReturnType<typeof getTaxConfig>>, { ok: true }>['data'];
export type TaxRateRow = TaxConfig['rates'][number];
export type TaxTreatmentRow = TaxConfig['treatments'][number];
export type TaxRegistrationRow = TaxConfig['registrations'][number];
export type TaxAuditEntry = Extract<
	Awaited<ReturnType<typeof listTaxAudit>>,
	{ ok: true }
>['data']['entries'][number];
export type TaxReport = Extract<Awaited<ReturnType<typeof getTaxReport>>, { ok: true }>['data'];
export type TaxWriteError =
	| ErrorsOf<typeof rateEndpoint>
	| ErrorsOf<typeof treatmentEndpoint>
	| ErrorsOf<typeof registrationEndpoint>;

/** When a change takes effect and why — on every write. */
export type EffectiveChange = {
	effectiveFrom: string;
	effectiveTo?: string | null;
	reason: string;
	confirmPastEffectiveDate?: boolean;
};

export type TaxComponent = TaxRateRow['component'];

export async function getTaxAccess() {
	return call(accessEndpoint());
}

export async function getTaxConfig() {
	return call(configEndpoint());
}

export async function supersedeTaxRate(
	input: EffectiveChange & {
		jurisdictionCode: string;
		component: TaxComponent;
		rateMillipercent: number;
	}
) {
	return call(rateEndpoint({ json: input }));
}

export async function supersedeTaxTreatment(
	input: EffectiveChange & {
		supplyTypeCode: TaxTreatmentRow['supplyTypeCode'];
		treatment: TaxTreatmentRow['treatment'];
		components: Array<TaxComponent>;
		placeOfSupply: TaxTreatmentRow['placeOfSupply'];
	}
) {
	return call(treatmentEndpoint({ json: input }));
}

export async function supersedeTaxRegistration(
	input: EffectiveChange & {
		jurisdictionCode: string;
		program: string;
		components: Array<TaxComponent>;
		registrationNumber: string | null;
		registered: boolean;
	}
) {
	return call(registrationEndpoint({ json: input }));
}

export async function listTaxAudit(entity?: string) {
	return call(auditEndpoint({ query: entity ? { entity } : {} }));
}

export async function getTaxReport(query: {
	from: string;
	to: string;
	period: 'month' | 'quarter';
}) {
	return call(reportEndpoint({ query }));
}

/** The CSV export, downloaded by the browser with the session cookie. */
export const taxReportCsvUrl = (query: { from: string; to: string; period: string }) =>
	`${API_BASE_PATH}/tax/reports/collected.csv?${new URLSearchParams(query).toString()}`;

/** 13000 → "13", 9975 → "9.975". */
export const formatRatePercent = (millipercent: number) => String(millipercent / 1000);

/** "13.5" → 13500; null when it is not a non-negative percentage. */
export const parseRatePercent = (value: string): number | null => {
	const trimmed = value.trim();
	if (!/^\d+(\.\d{1,3})?$/.test(trimmed)) return null;
	const millipercent = Math.round(Number(trimmed) * 1000);
	return millipercent <= 100_000 ? millipercent : null;
};

/** The user-facing sentence for a refused change. */
export const taxWriteErrorText = (error: { code: string; message: string }) =>
	error.code === 'FORBIDDEN'
		? 'Your account may view the tax configuration but not change it.'
		: error.code === 'UNAUTHORIZED'
			? 'Your session has expired — sign in again.'
			: error.code === 'UNEXPECTED' || error.code === 'INTERNAL_SERVER_ERROR'
				? 'Something went wrong on our side. Please try again.'
				: error.message;
