/** Avatar initials: the first letter of the first and last words of a name,
 * uppercased ("Cleo Third" → "CT"); a one-word name gives one letter. */
export function initialsOf(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return '';
	const first = words[0].charAt(0);
	const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
	return (first + last).toUpperCase();
}
