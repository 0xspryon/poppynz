/** Toasts for the service agreement's API errors (UAT round 2, item 4).
 * Returns false for any other error, so callers fall back to their own. */
import { m } from '$lib/paraglide/messages';
import { toast } from '$lib/toast.svelte';

export function agreementErrorToast(error: { code: string }): boolean {
	switch (error.code) {
		case 'AGREEMENT_CHANGED':
			toast.error(m.agreement_error_changed(), { title: m.agreement_error_changed_title() });
			return true;
		case 'AGREEMENT_UNAVAILABLE':
			toast.error(m.agreement_error_unavailable());
			return true;
		case 'AGREEMENT_SIGNING_IMPERSONATED':
			toast.error(m.agreement_error_impersonated());
			return true;
		default:
			return false;
	}
}

/** What a sign handler reports back to the signing dialog. */
export type AgreementSignOutcome = 'signed' | 'changed' | 'failed';

type TemplateIssue = { code: string; name: string; line: number };

/** "Line 4: unknown placeholder “family.nmae”" for the admin editor. */
export function agreementIssueText(issue: TemplateIssue): string {
	const name = issue.name;
	const problem =
		issue.code === 'unknown_placeholder'
			? m.agreement_issue_unknown_placeholder({ name })
			: issue.code === 'list_as_value'
				? m.agreement_issue_list_as_value({ name })
				: issue.code === 'unclosed_section'
					? m.agreement_issue_unclosed_section({ name })
					: issue.code === 'mismatched_section'
						? m.agreement_issue_mismatched_section({ name })
						: issue.code === 'unexpected_close'
							? m.agreement_issue_unexpected_close({ name })
							: m.agreement_issue_malformed_tag({ name });
	return m.agreement_admin_issue({ line: issue.line, problem });
}

/** The issues a TC_TEMPLATE_INVALID error carries, if any. */
export const templateIssuesOf = (error: unknown): Array<TemplateIssue> => {
	const issues = (error as { issues?: unknown }).issues;
	return Array.isArray(issues) ? (issues as Array<TemplateIssue>) : [];
};
