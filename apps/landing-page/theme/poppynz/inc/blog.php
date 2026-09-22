<?php
/**
 * Blog helpers shared by home.php (the index) and single.php (an article).
 *
 * The blog is not an Elementor document (spec § 8). Its copy still comes from the artefact:
 * server/import.php writes the per-language chrome into the `poppynz_blog_strings` option and
 * everything else onto the posts themselves as meta, so these templates never hard-code content.
 */
defined( 'ABSPATH' ) || exit;

/** The current Polylang language slug, or 'en' when Polylang is not active. */
function poppynz_lang(): string {
	$lang = function_exists( 'pll_current_language' ) ? pll_current_language( 'slug' ) : '';
	return $lang ? (string) $lang : 'en';
}

/** The blog chrome for the current language (index headings, article labels, newsletter, cards). */
function poppynz_blog_strings(): array {
	$all  = get_option( 'poppynz_blog_strings', [] );
	$lang = poppynz_lang();
	return is_array( $all ) ? (array) ( $all[ $lang ] ?? $all['en'] ?? [] ) : [];
}

/** A nested string from poppynz_blog_strings(), addressed as 'index.h1'. Never throws on a miss. */
function poppynz_s( string $path, string $default = '' ): string {
	$node = poppynz_blog_strings();
	foreach ( explode( '.', $path ) as $key ) {
		if ( ! is_array( $node ) || ! isset( $node[ $key ] ) ) {
			return $default;
		}
		$node = $node[ $key ];
	}
	return is_string( $node ) ? $node : $default;
}

/**
 * The design's date format: "12 Sept 2026" in English, "12 sept. 2026" in French. The month
 * abbreviations come from the artefact (the design writes "Sept", which no PHP format produces),
 * so they stay with the rest of the translated copy.
 */
function poppynz_blog_date( string $date ): string {
	$ts = strtotime( $date );
	if ( ! $ts ) {
		return '';
	}
	$months = poppynz_blog_strings()['months'] ?? [];
	$month  = $months[ (int) gmdate( 'n', $ts ) - 1 ] ?? gmdate( 'M', $ts );
	return gmdate( 'j', $ts ) . ' ' . $month . ' ' . gmdate( 'Y', $ts );
}

/** The publication line under an article's byline, with the design's "· Updated ..." tail. */
function poppynz_blog_dateline( int $post_id ): string {
	$line    = poppynz_s( 'article.published', 'Published' ) . ' ' . poppynz_blog_date( get_post_field( 'post_date', $post_id ) );
	$updated = (string) get_post_meta( $post_id, '_pz_updated', true );
	if ( $updated ) {
		$line .= ' · ' . poppynz_s( 'article.updated', 'Updated' ) . ' ' . poppynz_blog_date( $updated );
	}
	return $line;
}

/** The table of contents: every `<h2 id="...">` in the article, in document order. */
function poppynz_blog_toc( string $content ): array {
	if ( ! preg_match_all( '#<h2\s[^>]*id="([^"]+)"[^>]*>(.*?)</h2>#is', $content, $m, PREG_SET_ORDER ) ) {
		return [];
	}
	return array_map( fn( $x ) => [ 'id' => $x[1], 'text' => wp_strip_all_tags( $x[2] ) ], $m );
}

/** The design's avatar is the author's initial: "P" for the Poppynz team, "M" for Mombie. */
function poppynz_blog_initial( string $name ): string {
	return mb_strtoupper( mb_substr( trim( $name ), 0, 1 ) );
}

/** The hero/thumbnail image stored on a post by the importer. */
function poppynz_blog_hero( int $post_id ): array {
	$empty = [ 'src' => '', 'thumb' => '', 'alt' => '', 'credit' => '', 'creditText' => '', 'caption' => '' ];
	$hero  = get_post_meta( $post_id, '_pz_hero', true );
	return is_array( $hero ) ? $hero + $empty : $empty;
}

/**
 * One `.img-slot` figure: the image plus the photographer credit the design overlays on it.
 *
 * `$linked` must stay false inside a card, because every card in these templates IS a link and an
 * <a> nested in an <a> is not parseable: the browser ends the card link at the credit and lifts
 * the picture and the body out of it, which flattens the whole grid. Only the article hero, which
 * is not inside a link, gets the linked attribution — and there the credit is HTML from the
 * artefact, so it goes through wp_kses with exactly the tags an Unsplash attribution needs.
 */
function poppynz_blog_figure( array $hero, string $which = 'thumb', bool $linked = false ): string {
	$src = $hero[ $which ] ?: $hero['src'];
	if ( ! $src ) {
		return '';
	}
	$credit = $linked
		? wp_kses( $hero['credit'], [ 'a' => [ 'href' => [], 'target' => [], 'rel' => [] ] ] )
		: esc_html( $hero['creditText'] );
	return '<figure class="img-slot"><img src="' . esc_url( $src ) . '" alt="' . esc_attr( $hero['alt'] ) . '" loading="lazy">'
		. ( $credit ? '<span class="credit">' . $credit . '</span>' : '' ) . '</figure>';
}

/**
 * The blog search box: a real GET form, not the design's decorative placeholder.
 *
 * It submits to the language's own home URL (Polylang returns /fr/ for French, so a French search
 * stays French) with `post_type=post`, which functions.php enforces for every front-end search
 * anyway. The markup keeps the design's shape exactly — the icon and the text sit in the same flex
 * row at the same sizes — so only the elements change, not the layout: the `<span>` becomes the
 * `<input>` and the icon becomes the submit button.
 */
function poppynz_blog_search_form( string $value = '' ): string {
	$label = poppynz_s( 'index.search', 'Search articles' );
	ob_start(); ?>
	<form class="search" role="search" method="get" action="<?php echo esc_url( home_url( '/' ) ); ?>">
		<button type="submit" class="search-go" aria-label="<?php echo esc_attr( $label ); ?>"><i class="las la-search"></i></button>
		<label class="sr-only" for="pz-search"><?php echo esc_html( $label ); ?></label>
		<input type="search" id="pz-search" name="s" value="<?php echo esc_attr( $value ); ?>" placeholder="<?php echo esc_attr( $label ); ?>">
		<input type="hidden" name="post_type" value="post">
	</form>
	<?php
	return (string) ob_get_clean();
}

/** The chip + read-time pair the design prints on every card and at the top of every article. */
function poppynz_blog_meta_row( int $post_id, string $extra_class = '' ): string {
	$category = (string) get_post_meta( $post_id, '_pz_category', true );
	$read     = (string) get_post_meta( $post_id, '_pz_read_time', true );
	return '<div class="meta' . ( $extra_class ? ' ' . esc_attr( $extra_class ) : '' ) . '">'
		. '<span class="chip chip-info">' . esc_html( $category ) . '</span>'
		. '<span class="rd">' . esc_html( $read ) . '</span></div>';
}

/**
 * The newsletter card, which the design repeats on the index, on search results and on every
 * article. The design draws the field as a grey `<span>`; here it is a real email input posting to
 * admin-post.php, which hands the address to the app (see poppynz_handle_newsletter()).
 *
 * The result comes back as ?newsletter=ok|invalid|error on the same page, so a refresh cannot
 * resubmit, and is announced in a live region under the form.
 */
function poppynz_blog_newsletter(): string {
	$bell   = get_stylesheet_directory_uri() . '/assets/bell.svg';
	$state  = isset( $_GET['newsletter'] ) ? sanitize_key( wp_unslash( $_GET['newsletter'] ) ) : '';
	$notes  = [
		'ok'      => [ 'newsletter.success', 'Thanks — check your inbox once a month.' ],
		'invalid' => [ 'newsletter.invalid', 'That does not look like an email address.' ],
		'error'   => [ 'newsletter.error', 'Something went wrong. Please try again.' ],
	];
	ob_start(); ?>
	<div class="newsletter navy shadow-deep" id="newsletter">
		<img class="bell" src="<?php echo esc_url( $bell ); ?>" width="200" height="220" alt="" aria-hidden="true">
		<div class="stack-16">
			<p class="eyebrow-light"><span class="dash"></span><?php echo esc_html( poppynz_s( 'newsletter.eyebrow' ) ); ?></p>
			<h2 class="nl-h2"><?php echo esc_html( poppynz_s( 'newsletter.h2' ) ); ?><span class="accent"><?php echo esc_html( poppynz_s( 'newsletter.h2Accent' ) ); ?></span></h2>
			<p class="nl-lead"><?php echo esc_html( poppynz_s( 'newsletter.lead' ) ); ?></p>
		</div>
		<div class="nl-col">
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="poppynz_newsletter">
				<?php wp_nonce_field( 'poppynz_newsletter', '_pz_nonce' ); ?>
				<label class="sr-only" for="pz-newsletter"><?php echo esc_html( poppynz_s( 'newsletter.label', 'Email address' ) ); ?></label>
				<input class="email" type="email" id="pz-newsletter" name="email" required autocomplete="email" placeholder="<?php echo esc_attr( poppynz_s( 'newsletter.email' ) ); ?>">
				<?php // Honeypot: hidden from people, irresistible to bots. ?>
				<input type="text" name="pz_hp" class="sr-only" tabindex="-1" autocomplete="off" aria-hidden="true">
				<button type="submit" class="btn-primary-14 nl-btn"><?php echo esc_html( poppynz_s( 'newsletter.button' ) ); ?></button>
			</form>
			<?php // Only rendered when there is something to say: an empty <p> would still take a line
				// box and make the card taller than the design. The page reloads on submit, so the live
				// region arrives with its message rather than being updated in place. ?>
			<?php if ( isset( $notes[ $state ] ) ) : ?>
				<p class="nl-note is-<?php echo esc_attr( $state ); ?>" role="status" aria-live="polite"><?php echo esc_html( poppynz_s( $notes[ $state ][0], $notes[ $state ][1] ) ); ?></p>
			<?php endif; ?>
		</div>
	</div>
	<?php
	return (string) ob_get_clean();
}

/** The side card beside an article: the families variant, or the helpers one on helper articles. */
function poppynz_blog_side_card( int $post_id ): string {
	$which = (string) get_post_meta( $post_id, '_pz_side', true ) ?: 'families';
	$cards = poppynz_blog_strings()['sideCards'] ?? [];
	$card  = $cards[ $which ] ?? reset( $cards );
	if ( ! is_array( $card ) ) {
		return '';
	}
	return '<div class="side-card card-shadow">'
		. '<span class="bubble"><i class="las la-' . esc_attr( $card['icon'] ?? 'shield-alt' ) . '"></i></span>'
		. '<h3>' . esc_html( $card['title'] ?? '' ) . '</h3>'
		. '<p>' . esc_html( $card['text'] ?? '' ) . '</p>'
		. '<a href="' . esc_url( $card['href'] ?? '#' ) . '" class="btn-primary-14">' . esc_html( $card['cta'] ?? '' ) . ' <i class="las la-arrow-right"></i></a>'
		. '</div>';
}

/** The blog index URL for the current language (the page set as page_for_posts). */
function poppynz_blog_url(): string {
	$id = (int) get_option( 'page_for_posts' );
	if ( $id && function_exists( 'pll_get_post' ) ) {
		$translated = pll_get_post( $id );
		if ( $translated ) {
			$id = (int) $translated;
		}
	}
	return $id ? (string) get_permalink( $id ) : home_url( '/' );
}

/** The three share links the design puts in the article header. */
function poppynz_blog_share_links( string $url, string $title ): array {
	$labels = poppynz_blog_strings()['article']['shareOn'] ?? [ 'Share on Facebook', 'Share on LinkedIn', 'Share on WhatsApp' ];
	return [
		[ 'icon' => 'lab la-facebook-f', 'label' => $labels[0] ?? '', 'url' => 'https://www.facebook.com/sharer/sharer.php?u=' . rawurlencode( $url ) ],
		[ 'icon' => 'lab la-linkedin-in', 'label' => $labels[1] ?? '', 'url' => 'https://www.linkedin.com/sharing/share-offsite/?url=' . rawurlencode( $url ) ],
		[ 'icon' => 'lab la-whatsapp', 'label' => $labels[2] ?? '', 'url' => 'https://wa.me/?text=' . rawurlencode( $title . ' ' . $url ) ],
	];
}

/** One card in the index grid or in an article's "Keep reading" row. */
function poppynz_blog_card( int $post_id, string $class, bool $with_excerpt ): string {
	$hero = poppynz_blog_hero( $post_id );
	ob_start(); ?>
	<a href="<?php echo esc_url( (string) get_permalink( $post_id ) ); ?>" class="<?php echo esc_attr( $class ); ?>">
		<div class="pic"><?php echo poppynz_blog_figure( $hero ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
		<div class="body">
			<?php echo poppynz_blog_meta_row( $post_id ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			<h3><?php echo esc_html( get_the_title( $post_id ) ); ?></h3>
			<?php if ( $with_excerpt ) : ?>
				<p class="body-15"><?php echo esc_html( get_post_field( 'post_excerpt', $post_id ) ); ?></p>
			<?php endif; ?>
			<span class="post-date"><?php echo esc_html( poppynz_blog_date( get_post_field( 'post_date', $post_id ) ) ); ?></span>
		</div>
	</a>
	<?php
	return (string) ob_get_clean();
}
