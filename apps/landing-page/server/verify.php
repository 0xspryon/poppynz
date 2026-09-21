<?php
set_time_limit( 300 );
$out = [];
$urls = [ home_url( '/' ), home_url( '/fr/' ) ];
foreach ( get_posts( [ 'post_type' => 'page', 'post_status' => 'publish', 'numberposts' => -1, 'lang' => '' ] ) as $p ) { $urls[] = get_permalink( $p->ID ); }
foreach ( array_unique( $urls ) as $u ) {
	$r = wp_remote_get( add_query_arg( 'v', time(), $u ), [ 'timeout' => 40, 'sslverify' => false ] );
	$body = is_wp_error( $r ) ? '' : wp_remote_retrieve_body( $r );
	$norm = preg_replace( [ '/\?v=\d+/', '/nonce":"[a-f0-9]+"/', '/ver=[a-f0-9.]+/', '/_wpnonce=[a-f0-9]+/' ], '', $body );
	$out[ $u ] = [ 'status' => is_wp_error( $r ) ? $r->get_error_message() : wp_remote_retrieve_response_code( $r ), 'hash' => sha1( $norm ), 'bytes' => strlen( $body ), 'has_header' => str_contains( $body, 'ehf-header' ), 'lang' => preg_match( '/<html[^>]*lang="([^"]+)"/', $body, $m ) ? $m[1] : null ];
}
return $out;
