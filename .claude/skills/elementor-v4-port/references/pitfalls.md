# Pitfalls (Poppynz V4 harness)

## Data and import
- The importer aborts on any rejected or passed-through CSS. Fix the CSS string; never relax `pz_convert_map`.
- A page saved through the Document API needs `wp_set_current_user(1)`; otherwise `save()` returns false silently.
- Editor edits to copy are overwritten by the next import. Port copy changes back into `content/*.ts` first (diff the stored `_elementor_data` against the artefact).
- Polylang: find pages by slug AND language; the same slug may exist in both languages.
- Unpinned wordpress.org zips can serve betas (Polylang did). Only versioned zips.
- `elementor-hf` templates are found by title ("Site header (en)"); renaming a template in wp-admin creates a duplicate on the next import.

## Format
- `nav` is not a valid container tag; use `div` with a `hdr-nav` class. Headings only h1..h6; paragraphs p or span (a span paragraph is the way to make styled inline text or a text link).
- `html-v3` strips every attribute except `a[href]`; `<span class>` becomes `<span>`. Style emphasis via the parent class and the two descendant rules in theme `anim.css` (`.hl-wavy em`, `.em-accent em`).
- A global class renders by label. Labels must match `/^[a-z][a-z0-9_-]*$/i`.
- `transition` easing is dropped; write `transition: transform .25s`.
- `e-grid` base style sets `grid-template-columns:repeat(3,1fr)` and padding 10px, `e-flexbox` base sets padding 10px and row direction: always set `padding` and direction explicitly in a class or local css.

## Environment
- `execute-php` rejects a leading `<?php`. Max execution time is 30 s by default: scripts call `set_time_limit`.
- Elementor CSS is cached in uploads/elementor/css; `files_manager->clear_cache()` after imports, and render with a `?v=` query.
- The built-in browser pane is narrow (1024px); the editor panel scrolls horizontally. Use `read_page` refs for clicks, not coordinates.
- Editor Publish is disabled when nothing changed; a round-trip test needs a real edit.
