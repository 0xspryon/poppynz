<?php
// Unzip wp-content/novamira-sandbox/poppynz-artefact.zip into wp-content/novamira-sandbox/artefact/ (replacing it).
$dir = WP_CONTENT_DIR . '/novamira-sandbox/';
$zip = new ZipArchive();
if ( $zip->open( $dir . 'poppynz-artefact.zip' ) !== true ) { return [ 'error' => 'zip open failed' ]; }
$target = $dir . 'artefact/';
if ( is_dir( $target ) ) {
	foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $target, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::CHILD_FIRST ) as $f ) { $f->isDir() ? rmdir( $f->getPathname() ) : unlink( $f->getPathname() ); }
}
mkdir( $target, 0755, true );
$zip->extractTo( $target ); $zip->close();
@unlink( $dir . 'poppynz-artefact.zip' );
return [ 'files' => count( iterator_to_array( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $target, FilesystemIterator::SKIP_DOTS ) ) ) ), 'manifest' => json_decode( @file_get_contents( $target . 'manifest.json' ), true )['entries'] ?? 'missing' ];
