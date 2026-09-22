<?php
/**
 * One article, reproducing design/blog/<slug>.html:
 * Article header, Hero image, Article body (TOC, prose, side card), Keep reading, Newsletter.
 *
 * The post body is ordinary post_content written by server/import.php from the artefact; the
 * table of contents is derived from its `<h2 id>`s, and everything around it comes from post meta
 * and the `poppynz_blog_strings` option. Styling is assets/blog.css.
 */
defined( 'ABSPATH' ) || exit;

get_header();

while ( have_posts() ) :
	the_post();
	$pz_id       = get_the_ID();
	$pz_hero     = poppynz_blog_hero( $pz_id );
	$pz_category = (string) get_post_meta( $pz_id, '_pz_category', true );
	$pz_author   = (string) get_post_meta( $pz_id, '_pz_author_name', true );
	$pz_role     = (string) get_post_meta( $pz_id, '_pz_author_role', true );
	$pz_toc      = poppynz_blog_toc( (string) get_post_field( 'post_content', $pz_id ) );
	$pz_tags     = (array) get_post_meta( $pz_id, '_pz_tags', true );
	$pz_related  = array_filter( array_map( 'intval', (array) get_post_meta( $pz_id, '_pz_related', true ) ) );
	$pz_blog_url = poppynz_blog_url();
	?>
<div class="pz-blog">

	<section class="art-head">
		<div class="art-head-top">
			<nav aria-label="Breadcrumb" class="crumb">
				<a href="<?php echo esc_url( $pz_blog_url ); ?>"><i class="las la-arrow-left"></i><?php echo esc_html( poppynz_s( 'article.breadcrumb' ) ); ?></a><span class="sep">/</span><span><?php echo esc_html( $pz_category ); ?></span>
			</nav>
			<?php echo poppynz_blog_meta_row( $pz_id ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
		</div>
		<div class="art-title">
			<h1 class="art-h1"><?php the_title(); ?></h1>
			<p class="art-lead"><?php echo esc_html( get_the_excerpt() ); ?></p>
		</div>
		<div class="art-head-foot">
			<div class="byline">
				<span class="avatar"><?php echo esc_html( poppynz_blog_initial( $pz_author ) ); ?></span>
				<span class="byline-text">
					<span class="byline-name"><?php echo esc_html( $pz_author ); ?><?php echo $pz_role ? ' <span class="byline-role">· ' . esc_html( $pz_role ) . '</span>' : ''; // phpcs:ignore WordPress.Security.EscapeOutput ?></span>
					<span class="byline-dates"><?php echo esc_html( poppynz_blog_dateline( $pz_id ) ); ?></span>
				</span>
			</div>
			<div class="share-row">
				<span class="share-label"><?php echo esc_html( poppynz_s( 'article.share' ) ); ?></span>
				<?php foreach ( poppynz_blog_share_links( (string) get_permalink( $pz_id ), (string) get_the_title( $pz_id ) ) as $pz_share ) : ?>
					<a href="<?php echo esc_url( $pz_share['url'] ); ?>" target="_blank" rel="noopener noreferrer" aria-label="<?php echo esc_attr( $pz_share['label'] ); ?>" class="share"><i class="<?php echo esc_attr( $pz_share['icon'] ); ?>"></i></a>
				<?php endforeach; ?>
			</div>
		</div>
	</section>

	<?php if ( $pz_hero['src'] ) : ?>
		<section class="hero-sec">
			<figure class="hero-figure">
				<div class="hero-frame shadow-deep"><?php echo poppynz_blog_figure( $pz_hero, 'src', true ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
				<?php if ( $pz_hero['caption'] ) : ?>
					<figcaption class="hero-cap"><?php echo esc_html( $pz_hero['caption'] ); ?></figcaption>
				<?php endif; ?>
			</figure>
		</section>
	<?php endif; ?>

	<section class="body-sec">
		<div class="article-grid">

			<aside>
				<?php if ( $pz_toc ) : ?>
					<p class="eyebrow"><?php echo esc_html( poppynz_s( 'article.toc' ) ); ?></p>
					<ol class="toc">
						<?php foreach ( $pz_toc as $pz_item ) : ?>
							<li><a href="#<?php echo esc_attr( $pz_item['id'] ); ?>"><?php echo esc_html( $pz_item['text'] ); ?></a></li>
						<?php endforeach; ?>
					</ol>
				<?php endif; ?>
			</aside>

			<article class="prose">
				<?php the_content(); ?>
				<?php if ( $pz_tags ) : ?>
					<div class="pill-row">
						<?php foreach ( $pz_tags as $pz_tag ) : ?>
							<a href="<?php echo esc_url( $pz_blog_url ); ?>" class="pill"><?php echo esc_html( $pz_tag ); ?></a>
						<?php endforeach; ?>
					</div>
				<?php endif; ?>
			</article>

			<aside><?php echo poppynz_blog_side_card( $pz_id ); // phpcs:ignore WordPress.Security.EscapeOutput ?></aside>
		</div>
	</section>

	<?php if ( $pz_related ) : ?>
		<section class="band">
			<div class="sec wrap kr-inner">
				<div class="kr-head">
					<div class="kr-head-copy">
						<p class="eyebrow"><?php echo esc_html( poppynz_s( 'article.keepReadingEyebrow' ) ); ?></p>
						<h2 class="h2-sm"><?php echo esc_html( get_post_meta( $pz_id, '_pz_keep_reading', true ) ); ?></h2>
					</div>
					<a href="<?php echo esc_url( $pz_blog_url ); ?>" class="link-arrow"><?php echo esc_html( poppynz_s( 'article.allArticles' ) ); ?> <i class="las la-arrow-right"></i></a>
				</div>
				<div class="kr-grid">
					<?php foreach ( $pz_related as $pz_rel ) : ?>
						<?php echo poppynz_blog_card( $pz_rel, 'related', false ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<?php endforeach; ?>
				</div>
			</div>
		</section>
	<?php endif; ?>

	<section class="art-nl-sec"><?php echo poppynz_blog_newsletter(); // phpcs:ignore WordPress.Security.EscapeOutput ?></section>

</div>
	<?php
endwhile;

get_footer();
