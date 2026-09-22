<?php
/**
 * Poppynz child theme: fonts, keyframes, FAQ toggle, SVG uploads, per-language header/footer.
 */
defined( 'ABSPATH' ) || exit;

require_once get_stylesheet_directory() . '/inc/blog.php';

/** The blog index (home.php), an article (single.php) and search results (search.php) are the
 *  only non-Elementor templates. */
function poppynz_is_blog_template(): bool {
	return is_home() || is_singular( 'post' ) || is_search();
}

// The site's only search box says "Search articles" and lives on the blog, and search.php renders
// results as article cards built from post meta. Restrict front-end searches to posts so a hand-typed
// /?s= can never return a page (or an attachment) that has none of that meta and would draw an empty card.
add_action( 'pre_get_posts', function ( $query ) {
	if ( ! is_admin() && $query->is_main_query() && $query->is_search() ) {
		$query->set( 'post_type', 'post' );
	}
} );

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style( 'poppynz-fonts', 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400..800&family=Inter:wght@400..700&display=swap', [], null );
	wp_enqueue_style( 'poppynz-anim', get_stylesheet_directory_uri() . '/assets/anim.css', [], wp_get_theme()->get( 'Version' ) );
	wp_enqueue_script( 'poppynz-faq', get_stylesheet_directory_uri() . '/assets/faq.js', [], wp_get_theme()->get( 'Version' ), true );

	// Blog templates only (spec § 8). Elementor pages draw their icons as e-svg widgets from the
	// line-awesome package at build time; the blog's icons are the design's own `<i class="las">`
	// elements inside post content, so those two templates need the icon font itself.
	if ( poppynz_is_blog_template() ) {
		wp_enqueue_style( 'line-awesome', 'https://cdn.jsdelivr.net/npm/line-awesome@1.3.0/dist/line-awesome/css/line-awesome.min.css', [], null );
		wp_enqueue_style( 'poppynz-blog', get_stylesheet_directory_uri() . '/assets/blog.css', [ 'poppynz-anim' ], wp_get_theme()->get( 'Version' ) );
	}
}, 20 );

// Article bodies are complete HTML from the artefact (lists, comparison grids, callouts, pull
// quotes), not typed paragraphs, so wpautop has nothing useful to add and does add stray <br>s
// and <p>s inside them. Scoped to the posts this importer owns; any other post is untouched.
add_action( 'wp', function () {
	if ( is_singular( 'post' ) && get_post_meta( (int) get_queried_object_id(), '_poppynz_post', true ) ) {
		remove_filter( 'the_content', 'wpautop' );
	}
} );

/** Where a newsletter sign-up goes: the app's own endpoint, on the matching environment. */
function poppynz_newsletter_endpoint(): string {
	$host = poppynz_app_host();
	return $host ? 'https://' . $host . '/api/v1/newsletter' : '';
}

/**
 * Newsletter sign-up. The form posts here (same origin), we hand the address to the app and send
 * the visitor straight back to the page they were on.
 *
 * The POST to the app is made server side on purpose. From the browser it would be a cross-origin
 * request with a JSON content type, so it would need a CORS preflight and matching headers on the
 * app; from here there is no origin to check and the endpoint needs no CORS configuration at all.
 *
 * Fire and forget, as asked: `blocking => false` sends the request and returns without waiting for
 * or reading a response. The consequence is worth knowing — if the endpoint is down or rejects the
 * body, nothing here can tell, and the visitor is still thanked. Nothing is stored on this site.
 */
add_action( 'admin_post_nopriv_poppynz_newsletter', 'poppynz_handle_newsletter' );
add_action( 'admin_post_poppynz_newsletter', 'poppynz_handle_newsletter' );
function poppynz_handle_newsletter(): void {
	$back = wp_get_referer() ?: home_url( '/' );

	// A bot that fills every field it finds trips the honeypot. Real submissions leave it empty.
	if ( ! empty( $_POST['pz_hp'] ) || ! isset( $_POST['_pz_nonce'] ) || ! wp_verify_nonce( sanitize_key( wp_unslash( $_POST['_pz_nonce'] ) ), 'poppynz_newsletter' ) ) {
		wp_safe_redirect( add_query_arg( 'newsletter', 'error', $back ) . '#newsletter' );
		exit;
	}

	$email = sanitize_email( wp_unslash( $_POST['email'] ?? '' ) );
	if ( ! is_email( $email ) ) {
		wp_safe_redirect( add_query_arg( 'newsletter', 'invalid', $back ) . '#newsletter' );
		exit;
	}

	$endpoint = poppynz_newsletter_endpoint();
	if ( $endpoint ) {
		wp_remote_post( $endpoint, [
			'blocking' => false,
			'timeout'  => 1,
			'headers'  => [ 'Content-Type' => 'application/json' ],
			'body'     => wp_json_encode( [ 'email' => $email ] ),
		] );
	}

	wp_safe_redirect( add_query_arg( 'newsletter', 'ok', $back ) . '#newsletter' );
	exit;
}

// Hello's own header/footer stay off: the Header & Footer Builder templates render instead.
add_filter( 'hello_elementor_header_footer', '__return_false' );

/**
 * The app subdomain for whatever site this is, derived from home_url() and never hard-coded:
 * staging.poppynz.com -> app.staging.poppynz.com, poppynz.com -> app.poppynz.com. Returns '' when
 * we are already on the app host, so nothing ever points at itself.
 */
function poppynz_app_host(): string {
	$host = wp_parse_url( home_url(), PHP_URL_HOST );
	if ( ! $host || 0 === stripos( (string) $host, 'app.' ) ) {
		return '';
	}
	return 'app.' . $host;
}

// /app -> the app subdomain. Runs before WordPress's own redirect_canonical (priority 10) and
// before Polylang's language redirect, so it wins first. The target host is always derived from
// the current site's own home_url() (never hard-coded), so the same artefact redirects
// staging.poppynz.com -> app.staging.poppynz.com and poppynz.com -> app.poppynz.com without
// any per-environment configuration.
add_action( 'template_redirect', function () {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
		return;
	}

	$path = wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH );
	if ( ! is_string( $path ) || '' === $path ) {
		return;
	}

	// /app, /app/<rest>, and the same with a two-letter Polylang language prefix
	// (/fr/app, /fr/app/<rest>). Case-insensitive; a trailing slash is tolerated.
	if ( ! preg_match( '#^/(?:[a-z]{2}/)?app(?:/(?P<rest>.*))?/?$#i', $path, $m ) ) {
		return;
	}

	$host = poppynz_app_host();
	if ( ! $host ) {
		return; // Already on the app host: never redirect to ourselves.
	}

	$rest  = isset( $m['rest'] ) ? trim( $m['rest'], '/' ) : '';
	$query = $_SERVER['QUERY_STRING'] ?? '';
	$url   = 'https://' . $host . '/' . $rest . ( '' !== $query ? '?' . $query : '' );

	// 302, not 301: the app-subdomain setup is still being finalised, so a browser must not
	// permanently cache this redirect while it can still change.
	wp_redirect( $url, 302 );
	exit;
}, 0 );

// Header & Footer Builder: serve the template translated into the current Polylang language.
add_filter( 'hfe_render_template_id', function ( $id ) {
	if ( $id && function_exists( 'pll_get_post' ) ) {
		$translated = pll_get_post( (int) $id );
		if ( $translated ) {
			return $translated;
		}
	}
	return $id;
} );

// Only administrators may upload SVG (the importer runs as an administrator).
// SVG uploads for icons and the logo (used by the importer and by the media library).
add_filter( 'upload_mimes', function ( $mimes ) {
	if ( ! current_user_can( 'manage_options' ) ) {
		return $mimes;
	}
	$mimes['svg'] = 'image/svg+xml';
	return $mimes;
} );
add_filter( 'wp_check_filetype_and_ext', function ( $data, $file, $filename ) {
	if ( ! current_user_can( 'manage_options' ) ) {
		return $data;
	}
	if ( str_ends_with( strtolower( $filename ), '.svg' ) ) {
		$data['ext']  = 'svg';
		$data['type'] = 'image/svg+xml';
	}
	return $data;
}, 10, 3 );
