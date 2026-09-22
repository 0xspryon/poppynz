<?php
// Import the unpacked artefact into this site. Idempotent. Run through novamira/execute-php without the first line.
set_time_limit( 600 );
require_once WP_CONTENT_DIR . '/novamira-sandbox/artefact/server/lib.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';
wp_set_current_user( 1 );
$manifest = pz_json( 'manifest.json' );
if ( ( $manifest['elementorVersion'] ?? '' ) !== ELEMENTOR_VERSION ) { throw new Exception( "artefact built for Elementor {$manifest['elementorVersion']}, site runs " . ELEMENTOR_VERSION ); }

// ---- 1. media by content hash
add_filter( 'upload_mimes', fn( $m ) => $m + [ 'svg' => 'image/svg+xml' ] );
add_filter( 'wp_check_filetype_and_ext', function ( $d, $file, $filename ) { if ( str_ends_with( strtolower( $filename ), '.svg' ) ) { $d['ext'] = 'svg'; $d['type'] = 'image/svg+xml'; } return $d; }, 10, 3 );
$media_ids = [];
foreach ( $manifest['media'] as $hash => $m ) {
	$id = pz_find_media( $hash );
	if ( ! $id ) {
		$src = pz_artefact_dir() . "media/$hash.{$m['ext']}";
		$name = preg_replace( '/[^a-z0-9-]+/', '-', strtolower( str_replace( [ 'icon:', 'svc:', 'media:' ], '', $m['key'] ) ) ) . "-$hash.{$m['ext']}";
		$up = wp_upload_bits( $name, null, file_get_contents( $src ) );
		if ( ! empty( $up['error'] ) ) { throw new Exception( "upload $name: {$up['error']}" ); }
		$type = wp_check_filetype( $up['file'] )['type'] ?: ( $m['ext'] === 'svg' ? 'image/svg+xml' : 'image/webp' );
		$id = wp_insert_attachment( [ 'post_mime_type' => $type, 'post_title' => $m['key'], 'post_status' => 'inherit' ], $up['file'] );
		if ( $m['ext'] !== 'svg' ) { wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $up['file'] ) ); }
		update_post_meta( $id, '_poppynz_hash', $hash );
		if ( $m['alt'] ) { update_post_meta( $id, '_wp_attachment_image_alt', $m['alt'] ); }
		pz_note( 'media', $m['key'], 'created' );
	} else { pz_note( 'media', $m['key'], 'unchanged' ); }
	$media_ids[ $hash ] = (int) $id;
}

// ---- 2. variables by label
$repo = new \Elementor\Modules\Variables\Storage\Variables_Repository( pz_kit() );
$coll = $repo->load();
$by_label = [];
foreach ( $coll->all() as $id => $var ) { $by_label[ $var->label() ] = $var; }
$order = count( $by_label ); $now = current_time( 'mysql' ); $changed = false;
foreach ( pz_json( 'variables.json' ) as $v ) {
	if ( isset( $by_label[ $v['label'] ] ) ) {
		$existing = $by_label[ $v['label'] ];
		$cur = $existing->value(); $cur = is_array( $cur ) ? ( $cur['value'] ?? null ) : $cur;
		if ( $cur !== $v['value'] ) { $existing->set_value( $v['value'] ); $changed = true; pz_note( 'variables', $v['label'], 'updated' ); } else { pz_note( 'variables', $v['label'], 'unchanged' ); }
	} else {
		$coll->add_variable( \Elementor\Modules\Variables\Storage\Entities\Variable::from_array( [ 'id' => \Elementor\Modules\AtomicWidgets\Utils\Utils::generate_id( 'e-gv-' ), 'type' => $v['type'], 'label' => $v['label'], 'value' => $v['value'], 'order' => ++$order, 'created_at' => $now, 'updated_at' => $now ] ) );
		$changed = true; pz_note( 'variables', $v['label'], 'created' );
	}
}
if ( $changed ) { $repo->save( $coll ); }

// ---- 3. global classes (convert first, abort on problems)
$gcr = \Elementor\Modules\GlobalClasses\Global_Classes_Repository::make( pz_kit() );
$current = $gcr->all(); $items = $current->get_items()->all(); $existing_order = $current->get_order()->all();
$artefact_order = [];
$classes = pz_json( 'classes.json' );
foreach ( $classes as $c ) {
	$variants = pz_convert_map( $c['css'], 'class ' . $c['label'] );
	$new = [ 'id' => $c['id'], 'label' => $c['label'], 'type' => 'class', 'variants' => $variants ];
	$was = $items[ $c['id'] ] ?? null;
	pz_note( 'classes', $c['label'], $was ? ( wp_json_encode( $was['variants'] ) === wp_json_encode( $variants ) ? 'unchanged' : 'updated' ) : 'created' );
	$items[ $c['id'] ] = $new;
	$artefact_order[] = $c['id'];
}
// classes.json is authoritative for ORDER, not just content: Elementor prints global classes in
// reversed declaration order (see pitfalls.md), so a modifier class that must win over its base
// class on a shared property only does so if it sorts correctly relative to the base — and
// merely appending missing ids (the previous behaviour) never re-sorts ids that already existed
// from an earlier import, silently freezing the order from the very first run forever. Put the
// artefact's order first; keep any pre-existing id the artefact no longer knows about at the end —
// a class created directly in wp-admin (not by this importer) is kept, just demoted below every
// artefact class, so it never wins a same-element property conflict against one we manage.
$gorder = array_values( array_unique( array_merge( $artefact_order, $existing_order ) ) );
$gcr->put( $items, $gorder );
// Also sync the PREVIEW context (Global_Classes_Repository::CONTEXT_PREVIEW), not just frontend.
// The Elementor editor's Style panel and canvas read the preview-context order/items, which our
// frontend-only put() above never touches; left unsynced, every class shows as a "some classes
// are missing" warning the first time an imported page is opened in the editor, and the canvas
// renders completely unstyled (no fonts, no flex/grid, no colors) even though the live frontend
// is correct. Confirmed live: editor showed the warning until this ran, then showed the class
// chips normally and the canvas matched the frontend. Note this preview put() overwrites the
// preview context wholesale, so any not-yet-published edit made to a class in the editor (a draft
// change sitting only in preview) is discarded by the next import — expected for this pipeline,
// since the artefact is the single source of truth, but worth knowing if someone is mid-edit.
\Elementor\Modules\GlobalClasses\Global_Classes_Repository::make( pz_kit() )->set_preview( true )->put( $items, $gorder );

// Elementor's global-classes CSS bundler (Global_Classes_Relations::extract_class_ids_from_post)
// resolves the *class id* (e.g. "g-ccfc59a") out of an element's `classes` prop, not its label.
// Global_Classes_Repository::get_by_ids() then does a hard id lookup with no fallback, so any
// element that references a class by its label (as the artefact does, for readability) never
// gets linked to that class and its CSS is silently never printed for that document. Build the
// label -> id map here and translate every `classes` prop value through it before saving.
$label_to_id = [];
foreach ( $classes as $c ) { $label_to_id[ $c['label'] ] = $c['id']; }

// ---- helpers for documents
function pz_fill_styles( array &$elements, array $css_map, array $media_ids, array $label_to_id ): void {
	foreach ( $elements as &$el ) {
		// `foreach ($el['styles'] ?? [] as &$style)` looks equivalent but is NOT: binding a
		// by-reference foreach to a `??` expression (rather than a bare lvalue) hands back a
		// reference into a throwaway copy, so every write below silently vanished and no local
		// per-element css was ever applied. Guard with isset() first and iterate the real array.
		if ( isset( $el['styles'] ) ) {
			foreach ( $el['styles'] as $sid => &$style ) {
				if ( isset( $css_map[ $sid ] ) ) { $style['variants'] = pz_convert_map( $css_map[ $sid ], ( $el['editor_settings']['title'] ?? $el['id'] ) . " ($sid)" ); }
			}
			unset( $style );
		}
		$el['settings'] = pz_swap_media( $el['settings'], $media_ids );
		$el['settings'] = pz_swap_classes( $el['settings'], $label_to_id );
		if ( ! empty( $el['elements'] ) ) { pz_fill_styles( $el['elements'], $css_map, $media_ids, $label_to_id ); }
	}
	unset( $el );
}
function pz_swap_media( $node, array $media_ids ) {
	if ( is_array( $node ) ) {
		if ( ( $node['$$type'] ?? null ) === 'media-hash' ) {
			if ( ! isset( $media_ids[ $node['value'] ] ) ) { throw new Exception( 'unknown media hash ' . $node['value'] ); }
			return [ '$$type' => 'image-attachment-id', 'value' => $media_ids[ $node['value'] ] ];
		}
		foreach ( $node as $k => $v ) { $node[ $k ] = pz_swap_media( $v, $media_ids ); }
	}
	return $node;
}
/** Translate global-class labels to their real class id inside every `classes` prop
 * ({'$$type':'classes','value':[...]}). Values not found in $label_to_id (a local per-element
 * style id like "e-dc222f5-702a727") are left untouched; anything that is neither a known label
 * nor a local style id is a typo or a stale/renamed class reference in the artefact and throws
 * rather than silently shipping a class name that will never resolve to any CSS. */
function pz_swap_classes( $node, array $label_to_id ) {
	if ( is_array( $node ) ) {
		if ( ( $node['$$type'] ?? null ) === 'classes' && is_array( $node['value'] ?? null ) ) {
			$node['value'] = array_map( function ( $v ) use ( $label_to_id ) {
				if ( isset( $label_to_id[ $v ] ) ) { return $label_to_id[ $v ]; }
				if ( preg_match( '/^e-[0-9a-f]{7}-[0-9a-f]{7}$/', $v ) ) { return $v; }
				throw new Exception( "unknown class \"$v\"" );
			}, $node['value'] );
			return $node;
		}
		foreach ( $node as $k => $v ) { $node[ $k ] = pz_swap_classes( $v, $label_to_id ); }
	}
	return $node;
}
/** Elementor regenerates a fresh random `interaction_id` for every hover/scroll interaction on
 * every save() call, even when nothing else changed; strip it before comparing so unrelated
 * re-saves report as unchanged instead of a spurious update. */
function pz_strip_volatile( &$node ): void {
	if ( ! is_array( $node ) ) { return; }
	if ( isset( $node['interaction_id'] ) && is_array( $node['interaction_id'] ) && array_key_exists( 'value', $node['interaction_id'] ) ) {
		$node['interaction_id']['value'] = '~';
	}
	foreach ( $node as &$child ) { pz_strip_volatile( $child ); }
	unset( $child );
}
function pz_normalized_elementor_data( int $post_id ): string {
	$data = json_decode( (string) get_post_meta( $post_id, '_elementor_data', true ), true );
	if ( ! is_array( $data ) ) { return (string) get_post_meta( $post_id, '_elementor_data', true ); }
	pz_strip_volatile( $data );
	return wp_json_encode( $data );
}
function pz_save_document( int $post_id, array $elements, array $page_settings ): bool {
	$doc = \Elementor\Plugin::$instance->documents->get( $post_id, false );
	if ( ! $doc ) { throw new Exception( "no Elementor document for post $post_id" ); }
	$doc->set_is_built_with_elementor( true );
	$before = pz_normalized_elementor_data( $post_id );
	$ok = $doc->save( [ 'elements' => $elements, 'settings' => $page_settings ] );
	if ( ! $ok ) { throw new Exception( "document save returned false for post $post_id" ); }
	return pz_normalized_elementor_data( $post_id ) !== $before;
}

// ---- 4. header/footer templates per language
$hf_ids = [ 'header' => [], 'footer' => [] ];
foreach ( $manifest['entries'] as $entry ) {
	if ( ! str_starts_with( $entry, 'templates/' ) ) { continue; }
	$t = pz_json( $entry ); $kind = str_contains( $entry, 'header' ) ? 'header' : 'footer';
	$found = null;
	foreach ( get_posts( [ 'post_type' => 'elementor-hf', 'title' => $t['title'], 'post_status' => 'any', 'numberposts' => -1, 'lang' => '' ] ) as $cand ) {
		if ( ! function_exists( 'pll_get_post_language' ) || pll_get_post_language( $cand->ID ) === $t['lang'] ) { $found = $cand->ID; break; }
	}
	$pid = $found ?: wp_insert_post( [ 'post_title' => $t['title'], 'post_type' => 'elementor-hf', 'post_status' => 'publish' ] );
	if ( function_exists( 'pll_set_post_language' ) ) { pll_set_post_language( $pid, $t['lang'] ); }
	update_post_meta( $pid, 'ehf_template_type', $t['type'] );
	update_post_meta( $pid, 'ehf_target_include_locations', [ 'rule' => [ 'basic-global' ], 'specific' => [] ] );
	update_post_meta( $pid, 'ehf_target_exclude_locations', [ 'rule' => [], 'specific' => [] ] );
	update_post_meta( $pid, 'ehf_target_user_roles', [] );
	$elements = $t['elements']; pz_fill_styles( $elements, $t['_css'], $media_ids, $label_to_id );
	$changed = pz_save_document( $pid, $elements, [] );
	pz_note( 'templates', $entry, $found ? ( $changed ? 'updated' : 'unchanged' ) : 'created' );
	$hf_ids[ $kind ][ $t['lang'] ] = $pid;
}
// ---- 5. pages per key and language
$page_ids = [];
foreach ( $manifest['entries'] as $entry ) {
	if ( ! str_starts_with( $entry, 'pages/' ) ) { continue; }
	$p = pz_json( $entry );
	$slug = $p['slug'] !== '' ? $p['slug'] : ( $p['lang'] === 'en' ? 'home' : 'accueil' );
	// Find our own page by the marker meta first: it survives a slug WordPress had to uniquify,
	// which a by-slug lookup cannot. Fall back to the slug for pages imported before the marker.
	$found = null;
	foreach ( get_posts( [ 'post_type' => 'page', 'post_status' => 'any', 'numberposts' => -1, 'lang' => '', 'meta_key' => '_poppynz_page', 'meta_value' => $p['key'] ] ) as $cand ) {
		if ( ! function_exists( 'pll_get_post_language' ) || pll_get_post_language( $cand->ID ) === $p['lang'] ) { $found = $cand->ID; break; }
	}
	if ( ! $found ) {
		foreach ( get_posts( [ 'post_type' => 'page', 'name' => $slug, 'post_status' => 'any', 'numberposts' => -1, 'lang' => '' ] ) as $cand ) {
			if ( ! function_exists( 'pll_get_post_language' ) || pll_get_post_language( $cand->ID ) === $p['lang'] ) { $found = $cand->ID; break; }
		}
	}
	// Free the slug from a page that is not ours. WordPress auto-creates a DRAFT "Privacy Policy"
	// page on every install, which squats `privacy-policy`; wp_insert_post then silently falls
	// back to `privacy-policy-2` and every link built from PAGES[].slug points at a 404. Only an
	// unpublished page with no Elementor data is touched, and it is renamed, never deleted — so a
	// real page of the site's own is always left alone (it keeps the slug and the report shows the
	// uniquified URL, which is the visible, safe failure).
	foreach ( get_posts( [ 'post_type' => 'page', 'name' => $slug, 'post_status' => 'any', 'numberposts' => -1, 'lang' => '' ] ) as $cand ) {
		if ( $found && (int) $cand->ID === (int) $found ) { continue; }
		if ( 'publish' === $cand->post_status || get_post_meta( $cand->ID, '_elementor_data', true ) ) { continue; }
		wp_update_post( [ 'ID' => $cand->ID, 'post_name' => $slug . '-wp-default' ] );
		pz_note( 'slugs', "$slug (freed)", "renamed #{$cand->ID} ({$cand->post_status}) to {$slug}-wp-default" );
	}
	$pid = $found ?: wp_insert_post( [ 'post_title' => $p['title'], 'post_name' => $slug, 'post_type' => 'page', 'post_status' => 'publish', 'post_content' => '' ] );
	if ( $found && get_post_field( 'post_name', $pid ) !== $slug ) {
		wp_update_post( [ 'ID' => $pid, 'post_name' => $slug ] );
		pz_note( 'slugs', "$slug (corrected)", "renamed #$pid to $slug" );
	}
	update_post_meta( $pid, '_poppynz_page', $p['key'] );
	if ( function_exists( 'pll_set_post_language' ) ) { pll_set_post_language( $pid, $p['lang'] ); }
	$elements = $p['elements']; pz_fill_styles( $elements, $p['_css'], $media_ids, $label_to_id );
	$changed = pz_save_document( $pid, $elements, [ 'hide_title' => 'yes', 'template' => 'elementor_header_footer' ] );
	update_post_meta( $pid, '_wp_page_template', 'elementor_header_footer' );
	pz_note( 'pages', $entry, $found ? ( $changed ? 'updated' : 'unchanged' ) : 'created' );
	$page_ids[ $p['key'] ][ $p['lang'] ] = $pid;
}
// ---- 6. Polylang links
if ( function_exists( 'pll_save_post_translations' ) ) {
	foreach ( array_merge( array_values( $page_ids ), array_values( $hf_ids ) ) as $group ) { if ( count( $group ) > 1 ) { pll_save_post_translations( $group ); } }
	pz_note( 'polylang', 'links', count( $page_ids ) . ' page groups, ' . count( array_filter( $hf_ids ) ) . ' template kinds' );
}
// ---- 7. front page
if ( isset( $page_ids['home']['en'] ) ) {
	update_option( 'show_on_front', 'page' ); update_option( 'page_on_front', $page_ids['home']['en'] );
	pz_note( 'options', 'front_page', 'home.en' );
}
// WordPress's own privacy-policy setting still points at the draft it auto-created (the same one
// whose slug is freed above). Point it at the real policy so wp-admin stops offering the draft.
if ( isset( $page_ids['privacy']['en'] ) && (int) get_option( 'wp_page_for_privacy_policy' ) !== (int) $page_ids['privacy']['en'] ) {
	update_option( 'wp_page_for_privacy_policy', $page_ids['privacy']['en'] );
	pz_note( 'options', 'privacy_policy_page', 'privacy.en' );
}
\Elementor\Plugin::$instance->files_manager->clear_cache();
$report = pz_report();
$report['urls'] = [];
foreach ( $page_ids as $key => $langs ) { foreach ( $langs as $lang => $pid ) { $u = get_permalink( $pid ); $report['urls'][ "$key.$lang" ] = [ 'url' => $u, 'status' => pz_front( $u ) ]; } }
return $report;
