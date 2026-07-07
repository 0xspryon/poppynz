import type { Pathname } from '$app/types';

/**
 * Copy for the navy brand panel of the split-screen /auth layout.
 * Each auth page provides one of these from its `load` function; the
 * /auth layout renders it.
 */
export interface HeadlineSegment {
	text: string;
	/** Render in Sky Action instead of white. */
	accent?: boolean;
}

export interface AuthPanel {
	/** Small uppercase kicker above the headline, e.g. "Welcome to Poppynz". */
	eyebrow?: string;
	/** Headline as lines of segments — avoids HTML in data. */
	headline: HeadlineSegment[][];
	body?: string;
	testimonial?: {
		quote: string;
		attribution: string;
		initial: string;
	};
	/** Trust line pinned to the bottom of the panel. */
	trustLine?: string;
	/** Secondary action in the form-panel header, e.g. "Already with us? Sign in". */
	aux?: {
		text: string;
		cta: string;
		href: Pathname;
	};
	/** Show the navy hero card on mobile (entry screens only). */
	mobileHero?: boolean;
}
