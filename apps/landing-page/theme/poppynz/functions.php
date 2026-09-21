<?php
/**
 * Poppynz child theme: fonts, keyframes, FAQ toggle, SVG uploads, per-language header/footer.
 */
defined( 'ABSPATH' ) || exit;

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style( 'poppynz-fonts', 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400..800&family=Inter:wght@400..700&display=swap', [], null );
	wp_enqueue_style( 'poppynz-anim', get_stylesheet_directory_uri() . '/assets/anim.css', [], wp_get_theme()->get( 'Version' ) );
	wp_enqueue_script( 'poppynz-faq', get_stylesheet_directory_uri() . '/assets/faq.js', [], wp_get_theme()->get( 'Version' ), true );
}, 20 );

// Hello's own header/footer stay off: the Header & Footer Builder templates render instead.
add_filter( 'hello_elementor_header_footer', '__return_false' );

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

// SVG uploads for icons and the logo (used by the importer and by the media library).
add_filter( 'upload_mimes', function ( $mimes ) {
	$mimes['svg'] = 'image/svg+xml';
	return $mimes;
} );
add_filter( 'wp_check_filetype_and_ext', function ( $data, $file, $filename ) {
	if ( str_ends_with( strtolower( $filename ), '.svg' ) ) {
		$data['ext']  = 'svg';
		$data['type'] = 'image/svg+xml';
	}
	return $data;
}, 10, 3 );
