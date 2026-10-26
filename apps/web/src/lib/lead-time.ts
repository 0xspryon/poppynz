import { m } from '$lib/paraglide/messages';

/** A lead time in hours as words — whole days as days ("1 day"), otherwise
 * hours ("12 hours"). Used for CONTRACT_HOLD_LEAD_HOURS copy (UAT round 2
 * #10), which follows the setting instead of saying "2 days". */
export const formatLeadHours = (hours: number): string =>
	hours > 0 && hours % 24 === 0
		? m.contracts_lead_days({ count: hours / 24 })
		: m.contracts_lead_hours({ count: hours });

/** A lead time in minutes (CONTRACT_MIN_LEAD_MINUTES): whole hours as hours
 * ("2 hours"), whole days as days, otherwise minutes. */
export const formatLeadMinutes = (minutes: number): string =>
	minutes > 0 && minutes % 60 === 0
		? formatLeadHours(minutes / 60)
		: m.contracts_lead_minutes({ count: minutes });
