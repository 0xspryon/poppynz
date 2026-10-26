/**
 * Location summaries (UAT round 2 #2): the province always sits next to the
 * city — "Winnipeg, MB" — and nothing is ever shown twice (UAT #7).
 */

const PROVINCES: Record<string, string> = {
	alberta: 'AB',
	'british columbia': 'BC',
	'colombie britannique': 'BC',
	manitoba: 'MB',
	'new brunswick': 'NB',
	'nouveau brunswick': 'NB',
	'newfoundland and labrador': 'NL',
	'terre neuve et labrador': 'NL',
	'nova scotia': 'NS',
	'nouvelle ecosse': 'NS',
	'northwest territories': 'NT',
	'territoires du nord ouest': 'NT',
	nunavut: 'NU',
	ontario: 'ON',
	'prince edward island': 'PE',
	'ile du prince edouard': 'PE',
	quebec: 'QC',
	saskatchewan: 'SK',
	yukon: 'YT'
};
const CODES = new Set(Object.values(PROVINCES));

/** Lower case, accents and punctuation folded, for comparing place names. */
const fold = (value: string) =>
	value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

/** A Canadian province or territory as its two-letter code; anything else
 * as it was (trimmed); null when empty. */
export const provinceCode = (value: string | null | undefined): string | null => {
	const trimmed = value?.trim() ?? '';
	if (!trimmed) return null;
	if (CODES.has(trimmed.toUpperCase())) return trimmed.toUpperCase();
	return PROVINCES[fold(trimmed)] ?? trimmed;
};

/** Whether `text` already names the province (by code or by name) after
 * its first part — the first part is the place itself, and a city may share
 * its province's name (Québec, QC). */
const names = (text: string, province: string) => {
	const rest = text.split(',').slice(1).join(' ');
	if (!rest.trim()) return false;
	const words = ` ${fold(rest)} `;
	if (words.includes(` ${fold(province)} `)) return true;
	return Object.entries(PROVINCES).some(
		([name, code]) => code === province && words.includes(` ${name} `)
	);
};

/** "Winnipeg, MB": the city and its province, each once. */
export const formatPlace = (
	city: string | null | undefined,
	stateProvince: string | null | undefined
): string | null => {
	const town = city?.trim() ?? '';
	const province = provinceCode(stateProvince);
	if (!town) return province;
	if (!province || names(town, province)) return town;
	return `${town}, ${province}`;
};

/** A saved address, with the province added only if it doesn't name it. */
export const withProvince = (address: string, stateProvince: string | null | undefined): string => {
	const province = provinceCode(stateProvince);
	return !province || names(address, province) ? address : `${address}, ${province}`;
};
