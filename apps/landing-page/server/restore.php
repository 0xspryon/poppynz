<?php
// Restores snapshotted posts, kit meta and options. Posts created after the snapshot are reported
// under 'unexpected' and must be removed by hand.
// Edit the next line to the filename returned by snapshot.php (e.g. 2026-09-22_101500.json) before running.
$snapshot = '';
set_time_limit( 300 );
if ( ! $snapshot ) { return [ 'error' => 'set $snapshot to a snapshot filename first' ]; }
$snap = json_decode( file_get_contents( WP_CONTENT_DIR . '/novamira-sandbox/snapshots/' . $snapshot ), true );
if ( ! $snap ) { return [ 'error' => 'snapshot not found or invalid' ]; }
wp_set_current_user( 1 );
$out = [ 'restored' => 0, 'missing' => [] ];
foreach ( $snap['posts'] as $id => $rec ) {
	if ( ! get_post( $id ) ) { $out['missing'][] = $id; continue; }
	wp_update_post( array_merge( [ 'ID' => (int) $id ], $rec['post'] ) );
	foreach ( $rec['meta'] as $k => $vals ) { delete_post_meta( $id, $k ); foreach ( $vals as $v ) { add_post_meta( $id, $k, maybe_unserialize( $v ) ); } }
	if ( $rec['lang'] && function_exists( 'pll_set_post_language' ) ) { pll_set_post_language( $id, $rec['lang'] ); }
	$out['restored']++;
}
foreach ( $snap['kit']['meta'] as $k => $v ) { update_post_meta( $snap['kit']['id'], $k, $v ); }
foreach ( $snap['options'] as $o => $v ) { update_option( $o, $v ); }
\Elementor\Plugin::$instance->files_manager->clear_cache();
$out['unexpected'] = [];
foreach ( get_posts( [ 'post_type' => [ 'page', 'elementor-hf', 'e_global_class' ], 'post_status' => 'any', 'lang' => '', 'numberposts' => -1 ] ) as $p ) {
	if ( ! array_key_exists( $p->ID, $snap['posts'] ) ) { $out['unexpected'][] = [ 'id' => $p->ID, 'post_type' => $p->post_type, 'post_name' => $p->post_name ]; }
}
return $out;
