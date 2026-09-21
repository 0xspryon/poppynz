<?php
// One-time site bootstrap (idempotent). Run through novamira/execute-php without the first line,
// after uploading and unzipping the artefact (which carries theme/poppynz) into the sandbox.
set_time_limit( 600 );
require_once WP_CONTENT_DIR . '/novamira-sandbox/artefact/server/lib.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/theme.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/misc.php';

$pz_elementor_ready = fn() => class_exists( '\Elementor\Plugin' ) && ! empty( \Elementor\Plugin::$instance ) && isset( \Elementor\Plugin::$instance->kits_manager );

const PZ_VERSIONS = [
	'theme:hello-elementor'  => 'https://downloads.wordpress.org/theme/hello-elementor.3.5.1.zip',
	'plugin:elementor'       => 'https://downloads.wordpress.org/plugin/elementor.4.2.4.zip',
	'plugin:header-footer-elementor' => 'https://downloads.wordpress.org/plugin/header-footer-elementor.2.9.4.zip',
	'plugin:polylang'        => 'https://downloads.wordpress.org/plugin/polylang.3.8.9.zip',
];
const PZ_PLUGIN_MAIN = [
	'elementor' => 'elementor/elementor.php',
	'header-footer-elementor' => 'header-footer-elementor/header-footer-elementor.php',
	'polylang' => 'polylang/polylang.php',
];

wp_set_current_user( 1 );
$skin = new Automatic_Upgrader_Skin();

// 1. Theme and plugins at pinned versions.
if ( ! wp_get_theme( 'hello-elementor' )->exists() ) {
	$r = ( new Theme_Upgrader( $skin ) )->install( PZ_VERSIONS['theme:hello-elementor'] );
	pz_note( 'install', 'hello-elementor', is_wp_error( $r ) ? 'ERR ' . $r->get_error_message() : 'installed' );
} else { pz_note( 'install', 'hello-elementor', 'present ' . wp_get_theme( 'hello-elementor' )->get( 'Version' ) ); }

foreach ( PZ_PLUGIN_MAIN as $slug => $main ) {
	$want = preg_replace( '/.*\.(\d+\.\d+\.\d+)\.zip$/', '$1', PZ_VERSIONS[ "plugin:$slug" ] );
	$have = file_exists( WP_PLUGIN_DIR . '/' . $main ) ? get_plugin_data( WP_PLUGIN_DIR . '/' . $main )['Version'] : null;
	if ( $have !== $want ) {
		if ( $have ) { deactivate_plugins( $main ); delete_plugins( [ $main ] ); }
		$r = ( new Plugin_Upgrader( $skin ) )->install( PZ_VERSIONS[ "plugin:$slug" ] );
		pz_note( 'install', $slug, is_wp_error( $r ) ? 'ERR ' . $r->get_error_message() : "installed $want" . ( $have ? " (replaced $have)" : '' ) );
	} else { pz_note( 'install', $slug, "present $have" ); }
	if ( ! is_plugin_active( $main ) ) { $r = activate_plugin( $main ); pz_note( 'activate', $slug, is_wp_error( $r ) ? 'ERR ' . $r->get_error_message() : 'activated' ); }
}

// 2. Child theme from the artefact.
$src = pz_artefact_dir() . 'theme/poppynz';
$dst = get_theme_root() . '/poppynz';
if ( is_dir( $src ) ) {
	if ( ! is_dir( $dst ) ) { mkdir( $dst, 0755, true ); }
	foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $src, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::SELF_FIRST ) as $f ) {
		$rel = substr( $f->getPathname(), strlen( $src ) + 1 );
		if ( $f->isDir() ) { @mkdir( "$dst/$rel", 0755, true ); } else { copy( $f->getPathname(), "$dst/$rel" ); }
	}
	pz_note( 'theme', 'poppynz', 'copied' );
}
if ( wp_get_theme()->get_stylesheet() !== 'poppynz' ) { switch_theme( 'poppynz' ); pz_note( 'theme', 'active', 'switched to poppynz' ); }

// 3. WordPress and Elementor options.
update_option( 'permalink_structure', '/%postname%/' );
update_option( 'elementor_onboarded', true );
update_option( 'elementor_unfiltered_files_upload', '1' );
update_option( 'hello_elementor_settings_header_footer', 'true' );
update_option( 'hello_elementor_settings_skip_link', 'true' );
update_option( 'elementor_disable_color_schemes', 'yes' );
update_option( 'elementor_disable_typography_schemes', 'yes' );
flush_rewrite_rules();

// 4. Elementor kit defaults (V3 container width and padding so any legacy element behaves).
if ( $pz_elementor_ready() ) {
	$kit = pz_kit();
	$settings = $kit->get_meta( '_elementor_page_settings' ) ?: [];
	$settings['container_width']   = [ 'unit' => 'px', 'size' => 1920, 'sizes' => [] ];
	$settings['container_padding'] = [ 'unit' => 'px', 'top' => '0', 'right' => '0', 'bottom' => '0', 'left' => '0', 'isLinked' => true ];
	$settings['space_between_widgets'] = [ 'unit' => 'px', 'column' => '0', 'row' => '0', 'isLinked' => true, 'size' => 0 ];
	// Page-level (body/link) design defaults: without these Elementor/Hello fall back to their
	// own base styles (white body, rgb(51,51,51) text, system font, line-height 1.5, Hello's
	// pink rgb(204,51,102) link color) instead of the design's body{background:#F7F9FF;color:#001E30;
	// font-family:Inter} / a{color:#1A3375} hover #005782. See references/poppynz.md fix wave 3.
	$settings['body_background_background'] = 'classic';
	$settings['body_background_color']      = '#F7F9FF';
	$settings['body_color']                 = '#001E30';
	$settings['body_typography_typography']  = 'custom';
	$settings['body_typography_font_family'] = 'Inter';
	$settings['body_typography_font_weight'] = '400';
	$settings['body_typography_line_height'] = [ 'unit' => 'em', 'size' => 1.2, 'sizes' => [] ];
	$settings['link_normal_color'] = '#1A3375';
	$settings['link_hover_color']  = '#005782';
	$kit->update_meta( '_elementor_page_settings', $settings );
	pz_note( 'kit', 'defaults', 'set' );
	pz_note( 'kit', 'atomic_active', \Elementor\Plugin::$instance->experiments->is_feature_active( 'e_atomic_elements' ) ? 'yes' : 'NO (turn on e_atomic_elements)' );
} else { pz_note( 'kit', 'elementor', 'not loaded in this request; re-run bootstrap once' ); }

// 5. Polylang languages and translatable post types.
if ( function_exists( 'PLL' ) ) {
	$L = PLL()->model->languages;
	foreach ( [ [ 'locale' => 'en_CA', 'slug' => 'en', 'name' => 'English', 'flag' => 'ca', 'term_group' => 0 ], [ 'locale' => 'fr_CA', 'slug' => 'fr', 'name' => 'Français', 'flag' => 'ca', 'term_group' => 1 ] ] as $a ) {
		if ( ! $L->get( $a['slug'] ) ) { $r = $L->add( $a ); pz_note( 'polylang', $a['slug'], is_wp_error( $r ) ? 'ERR ' . $r->get_error_message() : 'added' ); } else { pz_note( 'polylang', $a['slug'], 'present' ); }
	}
	$L->clean_cache(); PLL()->model->clean_languages_cache();
	$o = PLL()->options;
	$o['default_lang'] = 'en';
	$o['hide_default'] = true;
	$o['post_types']   = array_values( array_unique( array_merge( (array) ( $o['post_types'] ?? [] ), [ 'elementor-hf', 'elementor_library' ] ) ) );
	if ( method_exists( $o, 'save' ) ) { $o->save(); }
	pz_note( 'polylang', 'options', 'default en, elementor-hf translatable' );
} else { pz_note( 'polylang', 'PLL', 'not loaded in this request; re-run bootstrap once' ); }

if ( $pz_elementor_ready() ) { \Elementor\Plugin::$instance->files_manager->clear_cache(); }
pz_note( 'front', home_url( '/' ), (string) pz_front( home_url( '/' ) ) );
return pz_report();
