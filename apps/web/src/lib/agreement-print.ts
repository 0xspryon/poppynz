/** Printing and downloading a written service agreement (UAT round 2, item
 * 4). Printing opens the text alone in a new window — no app chrome — and
 * hands it to the browser's print dialog (which also saves as PDF). */
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { getLocale } from '$lib/locale';

const escapeHtml = (value: string) =>
	value.replace(/[&<>"']/g, (char) =>
		char === '&'
			? '&amp;'
			: char === '<'
				? '&lt;'
				: char === '>'
					? '&gt;'
					: char === '"'
						? '&quot;'
						: '&#39;'
	);

const PRINT_STYLES = `
	body { font: 11pt/1.5 Georgia, 'Times New Roman', serif; color: #111; max-width: 46rem; margin: 2rem auto; padding: 0 1.5rem; }
	h1 { font-size: 1.6rem; margin: 1.5rem 0 0.5rem; }
	h2 { font-size: 1.15rem; margin: 1.25rem 0 0.4rem; }
	blockquote { border-left: 3px solid #999; margin: 1rem 0; padding-left: 0.75rem; color: #333; }
	ul { padding-left: 1.25rem; }
	hr { border: 0; border-top: 1px solid #999; margin: 1.5rem 0; }
	.meta { font: 9pt/1.4 ui-monospace, Menlo, monospace; color: #444; word-break: break-all; margin: 0.25rem 0; }
`;

/** Opens the agreement in a print window; false when popups are blocked. */
export function printAgreement(title: string, markdown: string, footer: ReadonlyArray<string>) {
	const html = DOMPurify.sanitize(marked.parse(markdown, { async: false }));
	const target = window.open('', '_blank');
	if (!target) return false;
	target.document.write(
		`<!doctype html><html lang="${getLocale()}"><head><meta charset="utf-8">` +
			`<title>${escapeHtml(title)}</title><style>${PRINT_STYLES}</style></head><body>` +
			`${html}<hr>${footer.map((line) => `<p class="meta">${escapeHtml(line)}</p>`).join('')}` +
			`</body></html>`
	);
	target.document.close();
	target.focus();
	target.print();
	return true;
}

/** Saves the agreement text (markdown, with the signing lines) as a file. */
export function downloadAgreement(
	filename: string,
	markdown: string,
	footer: ReadonlyArray<string>
) {
	const text = `${markdown.trimEnd()}\n\n---\n\n${footer.join('\n\n')}\n`;
	const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
