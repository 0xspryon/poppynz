import { afterEach, describe, expect, it } from 'vitest';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { tcCheckboxLabel } from './tcs';

const terms = {
	slug: 'terms_of_service',
	title: 'Terms of Service and Payment Policy',
	checkboxLabel: 'I have read and agree to the Poppynz Terms of Service.',
	fallback: false
};

describe('tcCheckboxLabel (U2, U7)', () => {
	afterEach(() => overwriteGetLocale(() => 'en'));

	it("uses the version's own sentence when the text is in the reader's language", () => {
		overwriteGetLocale(() => 'fr');
		expect(tcCheckboxLabel({ ...terms, checkboxLabel: "J'accepte." })).toBe("J'accepte.");
	});

	it('words the consent in French when a French reader is shown the English text', () => {
		overwriteGetLocale(() => 'fr');
		expect(tcCheckboxLabel({ ...terms, fallback: true })).toBe(
			'J’ai lu et j’accepte les conditions d’utilisation de Poppynz, la politique de paiement et d’annulation ainsi que la politique de confidentialité.'
		);
		expect(
			tcCheckboxLabel({ ...terms, slug: 'family_fee_acceptance', title: 'Frais', fallback: true })
		).toBe('J’ai lu et j’accepte le document « Frais ».');
	});
});
