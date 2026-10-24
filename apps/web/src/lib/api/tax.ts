/** The accountant tax portal, backed by /tax. Access follows the `tax` and
 * `taxReport` permissions (accountants and admins), never the role. */
import { API_BASE_PATH } from 'api/hc';
import { formatNumber } from '$lib/locale';
import { m } from '$lib/paraglide/messages';
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

/** 13000 → "13", 9975 → "9.975" — for prefilling the rate input only. */
export const formatRatePercent = (millipercent: number) => String(millipercent / 1000);

/** Display form, in the active locale: 13000 → "13%" / "13 %", 9975 → "9.975%" / "9,975 %". */
export const formatTaxRate = (millipercent: number) =>
	formatNumber(millipercent / 100_000, { style: 'percent', maximumFractionDigits: 3 });

/** "13.5" (or the French "13,5") → 13500; null when it is not a non-negative percentage. */
export const parseRatePercent = (value: string): number | null => {
	const trimmed = value.trim().replace(',', '.');
	if (!/^\d+(\.\d{1,3})?$/.test(trimmed)) return null;
	const millipercent = Math.round(Number(trimmed) * 1000);
	return millipercent <= 100_000 ? millipercent : null;
};

/** GST/HST/… in English, TPS/TVH/… in French. Unknown codes are shown upper-cased. */
export const taxComponentLabel = (component: string): string => {
	switch (component) {
		case 'gst':
			return m.tax_component_gst();
		case 'hst':
			return m.tax_component_hst();
		case 'pst':
			return m.tax_component_pst();
		case 'qst':
			return m.tax_component_qst();
		case 'rst':
			return m.tax_component_rst();
		default:
			return component.toUpperCase();
	}
};

/** "GST, HST" / "TPS, TVH". */
export const taxComponentList = (components: ReadonlyArray<string>) =>
	components.map(taxComponentLabel).join(', ');

export const taxTreatmentLabel = (treatment: string): string => {
	switch (treatment) {
		case 'taxable':
			return m.tax_treatment_taxable();
		case 'exempt':
			return m.tax_treatment_exempt();
		case 'zero_rated':
			return m.tax_treatment_zero_rated();
		case 'out_of_scope':
			return m.tax_treatment_out_of_scope();
		default:
			return treatment;
	}
};

export const taxPlaceLabel = (place: string): string => {
	switch (place) {
		case 'payer_province':
			return m.tax_place_payer_province();
		case 'helper_province':
			return m.tax_place_helper_province();
		case 'contract_location':
			return m.tax_place_contract_location();
		default:
			return place;
	}
};

/** The user-facing sentence for a refused change or a failed load. */
export const taxWriteErrorText = (error: { code: string; message: string }): string => {
	switch (error.code) {
		case 'FORBIDDEN':
			return m.tax_error_forbidden();
		case 'UNAUTHORIZED':
			return m.tax_error_unauthorized();
		case 'TAX_CONFIG_OVERLAP':
			return m.tax_error_overlap();
		case 'TAX_EFFECTIVE_RANGE_INVALID':
			return m.tax_error_range_invalid();
		case 'TAX_PAST_EFFECTIVE_DATE_UNCONFIRMED':
			return m.tax_error_past_unconfirmed();
		case 'TAX_UNKNOWN_JURISDICTION':
			return m.tax_error_unknown_jurisdiction();
		case 'TAX_REPORT_RANGE_INVALID':
			return m.tax_error_report_range();
		case 'INVALID_TAX_CONFIG_INPUT':
			return m.tax_error_invalid_input();
		case 'INVALID_TAX_REPORT_QUERY':
			return m.tax_error_invalid_report_query();
		default:
			return m.tax_error_unexpected();
	}
};
