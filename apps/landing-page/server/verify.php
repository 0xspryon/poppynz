<?php
set_time_limit( 300 );
$out = [];
$urls = [ home_url( '/' ), home_url( '/fr/' ) ];
foreach ( get_posts( [ 'post_type' => 'page', 'post_status' => 'publish', 'numberposts' => -1, 'lang' => '' ] ) as $p ) { $urls[] = get_permalink( $p->ID ); }
// The blog: every published article (the French ones are drafts by design and are not public),
// plus the index in each language — /blog is the page_for_posts page and /fr/blogue its
// Polylang translation, and both are already in the page list above.
foreach ( get_posts( [ 'post_type' => 'post', 'post_status' => 'publish', 'numberposts' => -1, 'lang' => '' ] ) as $p ) {
	if ( get_post_meta( $p->ID, '_poppynz_post', true ) ) { $urls[] = get_permalink( $p->ID ); }
}
// Strip the site's own absolute URLs before hashing so staging and production, which differ only
// in domain, produce comparable hashes.
$home = rtrim( home_url(), '/' );
$site = rtrim( site_url(), '/' );
$upload_base = wp_get_upload_dir()['baseurl'];
$own_urls = array_unique( array_filter( [ $home, $site !== $home ? $site : null, $upload_base ] ) );
foreach ( array_unique( $urls ) as $u ) {
	$r = wp_remote_get( add_query_arg( 'v', time(), $u ), [ 'timeout' => 40, 'sslverify' => false ] );
	$body = is_wp_error( $r ) ? '' : wp_remote_retrieve_body( $r );
	$norm = preg_replace( [ '/\?v=\d+/', '/nonce":"[a-f0-9]+"/', '/ver=[a-f0-9.]+/', '/_wpnonce=[a-f0-9]+/' ], '', $body );
	$norm = str_replace( $own_urls, '', $norm );
	$out[ $u ] = [ 'status' => is_wp_error( $r ) ? $r->get_error_message() : wp_remote_retrieve_response_code( $r ), 'hash' => sha1( $norm ), 'bytes' => strlen( $body ), 'has_header' => str_contains( $body, 'ehf-header' ), 'lang' => preg_match( '/<html[^>]*lang="([^"]+)"/', $body, $m ) ? $m[1] : null, 'has_footer' => str_contains( $body, 'ehf-footer' ) ];
}
return $out;
