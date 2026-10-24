import { formatNumber } from '$lib/locale';
import { m } from '$lib/paraglide/messages';

/** The server labels tax lines "GST (ON) 5%" / "QST (QC) 9.975%" (billing's
 * `taxLineLabel`). Re-render them in the active locale — French uses its own
 * abbreviations ("TPS (ON) 5 %", "TVQ (QC) 9,975 %"). Anything that doesn't
 * match the pattern is shown as sent. */
const TAX_LABEL = /^(GST|HST|QST|PST|RST)\s+\(([A-Z]{2})\)\s+(\d+(?:\.\d+)?)%$/;

const taxName = (code: string): string => {
	switch (code) {
		case 'GST':
			return m.contracts_tax_gst();
		case 'HST':
			return m.contracts_tax_hst();
		case 'QST':
			return m.contracts_tax_qst();
		case 'PST':
			return m.contracts_tax_pst();
		case 'RST':
			return m.contracts_tax_rst();
		default:
			return code;
	}
};

export function localizeTaxLabel(label: string): string {
	const match = TAX_LABEL.exec(label.trim());
	if (!match) return label;
	return m.contracts_tax_line_label({
		tax: taxName(match[1]),
		province: match[2],
		rate: formatNumber(Number(match[3]), { maximumFractionDigits: 3 })
	});
}
