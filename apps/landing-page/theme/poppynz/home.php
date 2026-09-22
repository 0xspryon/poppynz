<?php
/**
 * The blog index (the page set as page_for_posts), reproducing design/blog.html:
 * Blog header, Featured post, Post grid, Newsletter.
 *
 * The header and footer are the Header & Footer Builder templates, exactly as on every Elementor
 * page; only the four sections between them live here. Styling is assets/blog.css.
 */
defined( 'ABSPATH' ) || exit;

get_header();

$pz_posts    = $GLOBALS['wp_query']->posts;
$pz_featured = array_shift( $pz_posts );
$pz_filters  = poppynz_blog_strings()['index']['filters'] ?? [];
?>
<div class="pz-blog">

	<section class="blog-head">
		<div class="blog-head-row">
			<div class="blog-head-copy">
				<p class="eyebrow"><span class="dash"></span><?php echo esc_html( poppynz_s( 'index.eyebrow' ) ); ?></p>
				<h1 class="blog-h1"><?php echo esc_html( poppynz_s( 'index.h1' ) ); ?></h1>
				<p class="blog-lead"><?php echo esc_html( poppynz_s( 'index.lead' ) ); ?></p>
			</div>
			<?php echo poppynz_blog_search_form(); // phpcs:ignore WordPress.Security.EscapeOutput ?>
		</div>
		<div class="tag-row">
			<?php foreach ( $pz_filters as $pz_filter ) : ?>
				<a href="#" class="tag"><?php echo esc_html( $pz_filter ); ?></a>
			<?php endforeach; ?>
		</div>
	</section>

	<?php if ( $pz_featured ) : ?>
		<?php $pz_hero = poppynz_blog_hero( $pz_featured->ID ); ?>
		<section class="featured-sec">
			<a href="<?php echo esc_url( (string) get_permalink( $pz_featured->ID ) ); ?>" class="featured card-shadow">
				<div class="featured-pic"><?php echo poppynz_blog_figure( $pz_hero, 'src' ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
				<div class="featured-body">
					<?php echo poppynz_blog_meta_row( $pz_featured->ID ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<h2 class="featured-h2"><?php echo esc_html( get_the_title( $pz_featured->ID ) ); ?></h2>
					<p class="body-16"><?php echo esc_html( $pz_featured->post_excerpt ); ?></p>
					<div class="featured-by">
						<span class="avatar"><?php echo esc_html( poppynz_blog_initial( (string) get_post_meta( $pz_featured->ID, '_pz_author_name', true ) ) ); ?></span>
						<span><?php echo esc_html( get_post_meta( $pz_featured->ID, '_pz_author_name', true ) . ' · ' . poppynz_blog_date( $pz_featured->post_date ) ); ?></span>
					</div>
				</div>
			</a>
		</section>
	<?php endif; ?>

	<section class="grid-sec">
		<div class="post-grid">
			<?php foreach ( $pz_posts as $pz_post ) : ?>
				<?php echo poppynz_blog_card( $pz_post->ID, 'post card-shadow', true ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
			<?php endforeach; ?>
		</div>
		<?php
		// The design always draws this button; here it appears only when there is a next page to
		// load, so it is never a dead control. With eight articles and the default ten per page
		// there is no page two, so it does not render yet.
		$pz_paged = max( 1, (int) get_query_var( 'paged' ) );
		$pz_next  = $pz_paged < (int) $GLOBALS['wp_query']->max_num_pages ? (string) get_next_posts_page_link() : '';
		if ( $pz_next ) :
			?>
			<div class="load-more"><a href="<?php echo esc_url( $pz_next ); ?>" class="btn-outline-sm"><?php echo esc_html( poppynz_s( 'index.loadMore' ) ); ?></a></div>
		<?php endif; ?>
	</section>

	<section class="nl-sec"><?php echo poppynz_blog_newsletter(); // phpcs:ignore WordPress.Security.EscapeOutput ?></section>

</div>
<?php
get_footer();
