<?php
/**
 * Search results. The design has no screen for this, so it reuses the blog index's own layout —
 * the same header block (with the query echoed and the search box carrying it), the same card
 * grid, the same newsletter card — and differs only in the heading, the lead and the empty state.
 *
 * functions.php restricts every front-end search to posts, so every result here is an article and
 * carries the meta the cards are built from.
 */
defined( 'ABSPATH' ) || exit;

get_header();

$pz_query = get_search_query();
?>
<div class="pz-blog">

	<section class="blog-head">
		<div class="blog-head-row">
			<div class="blog-head-copy">
				<p class="eyebrow"><span class="dash"></span><?php echo esc_html( poppynz_s( 'index.eyebrow' ) ); ?></p>
				<h1 class="blog-h1"><?php echo esc_html( poppynz_s( 'search.title', 'Search results' ) ); ?></h1>
				<p class="blog-lead">
					<?php
					echo esc_html( have_posts()
						? sprintf( poppynz_s( 'search.lead', 'Articles matching “%s”' ), $pz_query )
						: sprintf( poppynz_s( 'search.empty', 'No articles matched “%s”.' ), $pz_query ) );
					?>
				</p>
			</div>
			<?php echo poppynz_blog_search_form( $pz_query ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
		</div>
		<div class="tag-row">
			<a href="<?php echo esc_url( poppynz_blog_url() ); ?>" class="tag"><?php echo esc_html( poppynz_s( 'search.back', 'Back to all articles' ) ); ?></a>
		</div>
	</section>

	<?php if ( have_posts() ) : ?>
		<section class="grid-sec">
			<div class="post-grid">
				<?php while ( have_posts() ) : the_post(); ?>
					<?php echo poppynz_blog_card( get_the_ID(), 'post card-shadow', true ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
				<?php endwhile; ?>
			</div>
			<?php
			$pz_paged = max( 1, (int) get_query_var( 'paged' ) );
			$pz_next  = $pz_paged < (int) $GLOBALS['wp_query']->max_num_pages ? (string) get_next_posts_page_link() : '';
			if ( $pz_next ) :
				?>
				<div class="load-more"><a href="<?php echo esc_url( $pz_next ); ?>" class="btn-outline-sm"><?php echo esc_html( poppynz_s( 'index.loadMore' ) ); ?></a></div>
			<?php endif; ?>
		</section>
	<?php endif; ?>

	<section class="nl-sec"><?php echo poppynz_blog_newsletter(); // phpcs:ignore WordPress.Security.EscapeOutput ?></section>

</div>
<?php
get_footer();
