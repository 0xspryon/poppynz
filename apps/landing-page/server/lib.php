<?php
// Shared helpers for the Poppynz Elementor V4 importer. Included from the sandbox by the other scripts.

function pz_sandbox(): string { return WP_CONTENT_DIR . '/novamira-sandbox/'; }
function pz_artefact_dir(): string { return pz_sandbox() . 'artefact/'; }

function pz_json( string $file ): array {
	$path = pz_artefact_dir() . $file;
	$data = json_decode( (string) @file_get_contents( $path ), true );
	if ( ! is_array( $data ) ) { throw new Exception( "bad or missing json: $file (" . json_last_error_msg() . ')' ); }
	return $data;
}

$GLOBALS['pz_report'] = [];
function pz_note( string $section, string $key, string $status ): void { $GLOBALS['pz_report'][ $section ][ $key ] = $status; }
function pz_report(): array { return $GLOBALS['pz_report']; }

function pz_kit() { return \Elementor\Plugin::$instance->kits_manager->get_active_kit(); }

function pz_variables_service() {
	return new \Elementor\Modules\Variables\Services\Variables_Service(
		new \Elementor\Modules\Variables\Storage\Variables_Repository( pz_kit() ),
		new \Elementor\Modules\Variables\Services\Batch_Operations\Batch_Processor()
	);
}

function pz_converter() {
	static $conv = null;
	if ( $conv ) { return $conv; }
	$svc  = pz_variables_service();
	$conv = new \Elementor\Modules\AtomicWidgets\CssConverter\Css_Converter(
		\Elementor\Modules\AtomicWidgets\CssConverter\Converter_Registry_Factory::create( $svc ),
		new \Elementor\Modules\AtomicWidgets\CssConverter\Metrics\Null_Failure_Reporter(),
		\Elementor\Modules\AtomicWidgets\CssConverter\Expander_Registry_Factory::create( $svc ),
		new \Elementor\Modules\AtomicWidgets\CssConverter\Variable_Prop_Value_Transformer( $svc )
	);
	return $conv;
}

/** CssMap {"desktop":"...","desktop:hover":"...","mobile":"..."} -> V4 variants. Throws on anything Elementor would drop. */
function pz_convert_map( array $map, string $where ): array {
	$variants = [];
	$problems = [];
	foreach ( $map as $key => $css ) {
		[ $bp, $state ] = array_pad( explode( ':', $key, 2 ), 2, null );
		$props = [];
		if ( trim( (string) $css ) !== '' ) {
			$r = pz_converter()->convert( $css );
			if ( $r['rejected'] ) { $problems[] = "$where/$key rejected: " . implode( ' ', $r['rejected'] ); }
			if ( trim( $r['customCss'] ) !== '' ) { $problems[] = "$where/$key not convertible (would be dropped in Free): " . $r['customCss']; }
			$props = $r['props'];
		}
		$variants[] = [ 'meta' => [ 'breakpoint' => $bp, 'state' => $state ], 'props' => $props ];
	}
	if ( $problems ) { throw new Exception( implode( "\n", $problems ) ); }
	return $variants;
}

function pz_find_media( string $hash ): ?int {
	$ids = get_posts( [ 'post_type' => 'attachment', 'post_status' => 'inherit', 'meta_key' => '_poppynz_hash', 'meta_value' => $hash, 'fields' => 'ids', 'numberposts' => 1 ] );
	return $ids ? (int) $ids[0] : null;
}

function pz_front( string $url ): int {
	$r = wp_remote_get( add_query_arg( 'v', time(), $url ), [ 'timeout' => 40, 'sslverify' => false ] );
	return is_wp_error( $r ) ? 0 : (int) wp_remote_retrieve_response_code( $r );
}
