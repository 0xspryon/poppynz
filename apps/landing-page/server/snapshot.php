<?php
set_time_limit( 300 );
$dir = WP_CONTENT_DIR . '/novamira-sandbox/snapshots/'; if ( ! is_dir( $dir ) ) { mkdir( $dir, 0755, true ); }
$kit_id = (int) get_option( 'elementor_active_kit' );
$snap = [ 'taken' => current_time( 'mysql' ), 'posts' => [], 'kit' => [ 'id' => $kit_id, 'meta' => [] ], 'options' => [] ];
foreach ( get_posts( [ 'post_type' => [ 'page', 'elementor-hf', 'e_global_class' ], 'post_status' => 'any', 'numberposts' => -1 ] ) as $p ) {
	$snap['posts'][ $p->ID ] = [ 'post' => [ 'post_title' => $p->post_title, 'post_name' => $p->post_name, 'post_type' => $p->post_type, 'post_status' => $p->post_status, 'post_content' => $p->post_content ], 'meta' => get_post_meta( $p->ID ), 'lang' => function_exists( 'pll_get_post_language' ) ? pll_get_post_language( $p->ID ) : null ];
}
foreach ( [ '_elementor_page_settings', '_elementor_global_variables', '_elementor_global_classes_order', '_elementor_global_classes_labels', '_elementor_global_classes_post_ids' ] as $k ) { $snap['kit']['meta'][ $k ] = get_post_meta( $kit_id, $k, true ); }
foreach ( [ 'show_on_front', 'page_on_front' ] as $o ) { $snap['options'][ $o ] = get_option( $o ); }
$file = $dir . date( 'Y-m-d_His' ) . '.json';
file_put_contents( $file, wp_json_encode( $snap ) );
return [ 'file' => $file, 'posts' => count( $snap['posts'] ), 'size' => filesize( $file ) ];
