# Elementor V4 landing-site harness — design

Date: 2026-09-21
Status: approved in discussion, spike done on staging (2026-09-21), ready for planning

## 0. Spike results (staging.poppynz.com, Elementor 4.2.4)

All four spike steps passed. Facts that changed the design are folded into the sections below;
the raw findings:

- Fresh install at 4.2.4 has `e_atomic_elements` active by default. Registered V4 types:
  elements `e-div-block`, `e-flexbox`, `e-grid`, the `e-tabs` family; widgets `e-heading`,
  `e-paragraph`, `e-button`, `e-image`, `e-svg`, `e-youtube`, `e-divider`,
  `e-self-hosted-video`, `e-component`. No accordion, list, background video or loop in Free.
- `Css_Converter::convert()` accepts one flat declaration string. `Css_Media_Splitter` and the
  MCP style applier seen on `main` do not exist in 4.2.4; the importer splits breakpoints and
  states itself. Converted correctly: `clamp()` (as a `custom` size), `var(--label)` to a
  global-variable reference, `grid-template-columns`, `box-shadow`, `filter`, `transform`,
  `transition`, `border` shorthand, `letter-spacing` in `em`. Rejected: `animation`. Passed
  through as custom CSS (so lost in Free): `font` shorthand, `text-wrap`,
  `text-underline-offset`, `inset` shorthand. `transition` keeps the duration but drops the
  easing function.
- Text props are `html-v3`: `{"$$type":"html-v3","value":{"content":{"$$type":"string",
  "value":"..."},"children":[]}}`. Inline `strong`, `em`, `b`, `i`, `u`, `s`, `span`, `a`, `br`
  survive; attributes do not.
- Tag enums: containers `div, header, section, article, aside, footer, a, button` (no `nav`);
  `e-heading` `h1..h6` only; `e-paragraph` `p, span`.
- A global class renders by its **label** as the HTML class (`class="btn-primary
  e-button-base"`), and its CSS is `.elementor .btn-primary{...}` with `:hover,:focus-visible`
  for the hover variant and `@media(max-width:767px)` for mobile. Variables are emitted on the
  kit selector (`--sky:#37B5FF`) and referenced as `var(--sky)`.
- `Variables_Repository`, `Variables_Collection::add_variable`, `Variable::from_array` and
  `Global_Classes_Repository::put` work from a plain script. `Document::save()` works with
  `wp_set_current_user(1)`; the saved page opened in the V4 editor, showed the class chips and
  converted values, and an editor Publish round-trip preserved every prop, variant, interaction
  and SVG reference.
- Interactions (`scrollIn` + `fade`) are stored as an array on the element, emitted in
  `elementor-interactions-data` and motion.js is enqueued on the Free front end.
- SVG upload needs the `upload_mimes` and `wp_check_filetype_and_ext` filters; `e-svg` then
  inlines the file.
- Header & Footer Builder 2.9.4 renders V4 templates. Its `hfe_render_template_id` filter plus
  `pll_get_post()` served the French header on `/fr/`. Connect Polylang for Elementor hooks only
  Elementor Pro's theme builder and is not needed.
- The unpinned wordpress.org `polylang.zip` delivered a 3.9 beta; every install must use a
  versioned zip. Polylang 3.8 API: `PLL()->model->languages->add([...])`,
  `PLL()->options['post_types']` then `->save()`.

## 1. Purpose

Rebuild the poppynz.com marketing site as editable Elementor V4 pages on WordPress, generated from
code so that the same build deploys identically to staging (`staging.poppynz.com`) and later to
production (`poppynz.com`). The Poppynz team edits copy, images, colours and spacing in the
Elementor editor afterwards; the harness stays the source of truth for structure and can rebuild
any page.

The design input is the static site in `apps/landing-page/design/` (HTML, `css/site.css`,
`js/site.js`, assets), itself generated from the Claude Design artboards of the
`poppynz-landing-page` repository. The static site is the reference render; its CSS is the
vocabulary the WordPress build reuses.

## 2. Decisions already taken

| Topic | Decision |
|---|---|
| Elementor | 4.2.4 Free, atomic editor (`e_atomic_elements`) on. No Pro features anywhere. |
| Theme | Hello Elementor plus a thin child theme. Hello's own header and footer are switched off. |
| Header and footer | Header & Footer Builder 2.9.4 (`header-footer-elementor`), templates built from V4 elements, one per language, chosen by a child-theme filter on `hfe_render_template_id`. |
| Languages | English (`en`, `en_CA`) and French (`fr`, `fr_CA`) through Polylang 3.8.9. Every page exists in both languages. No connector plugin. |
| Pinned versions | Elementor 4.2.4, Hello Elementor 3.5.1, Header & Footer Builder 2.9.4, Polylang 3.8.9, always installed from versioned wordpress.org zips. |
| Blog | Native WordPress posts. Index and article layouts are child-theme templates, not Elementor pages. |
| WordPress target | Existing sites reached through Novamira MCP servers. No provisioning, no Dokploy MCP in this repository. |
| Editability | Every visible value is a V4 control, global variable or global class. Hand CSS only for looping keyframes. |
| Builder language | TypeScript on Bun, inside the monorepo. |
| Hero video | Element choice deferred to the Home build (`e-self-hosted-video` or `e-background-video`). |
| Dropped from the old harness | Marysien profile, trame ingestion, provisioner, Dokploy MCP, Header & Footer Builder 1.6 pin, Contact Form 7, Caddy deploy. |

## 3. Layout

```
apps/landing-page/
  design/            static reference site (tracked from now on)
  builder/           TypeScript on Bun
    tokens.ts        global variables
    classes.ts       global classes as CSS strings
    content/         copy and data per page, keyed en / fr
    recipes/         page and template compositions
    emit/            element JSON writer, artefact folder writer
    dsl.ts           flex(), heading(), text(), button(), svg(), image(), ...
  json-artefacts/    committed build output, the deploy unit
  server/            PHP run through Novamira execute-php
    bootstrap.php    install and configure the stack (once per site)
    import.php       import one artefact folder
    snapshot.php     save site state before an import
    restore.php      put a snapshot back
    verify.php       fetch every page, report status and content hash
  theme/             Hello Elementor child theme
.claude/skills/elementor-v4-port/
  SKILL.md           playbook
  references/        v4-format.md, css-cheatsheet.md, pitfalls.md, worker-brief.md, poppynz.md
  scripts/           dump_design.sh, render.sh, push.sh
.claude/agents/page-builder.md
```

## 4. Artefact contract

An artefact folder is the complete description of the site's Elementor content and is
site-agnostic. It never contains a post ID, an attachment ID, a hostname or a site URL.

```
json-artefacts/<build>/
  manifest.json          builder version, Elementor version, list of entries, content hashes
  variables.json         global variables by label
  classes.json           global classes by label, styles as CSS strings
  media/<hash>.<ext>     images and SVG icons, filename = content hash
  templates/header.en.json, header.fr.json, footer.en.json, footer.fr.json
  pages/<key>.en.json, <key>.fr.json
  posts/<slug>.en.json, <slug>.fr.json   blog articles as Gutenberg HTML
```

Legal pages are ordinary entries under `pages/`. Navigation is built into the header and footer templates, so no WordPress menus are created.

Each page or template file holds `slug`, `title`, `seo`, `elements` (V4 element tree) and a
`_css` map from style id to CSS string. Elements reference media by hash, links by page key, and
styles by class label or local style id.

The importer resolves every reference by a stable key:

| Reference | Resolved by |
|---|---|
| Page | slug plus Polylang language |
| Template | title plus language |
| Media | content hash stored in attachment meta `_poppynz_hash` |
| Global class, variable | label |

Running the same artefact against two sites yields the same content. Re-running is idempotent:
each step reports `created`, `updated` or `unchanged`.

## 5. Site model

**Global variables** carry the design tokens with the names used in `site.css`: colours (navy
`#1A3375`, sky `#37B5FF`, ink `#001E30`, muted `#444650`, page `#F7F9FF`, border `#D6E2F2`, the
blue and pink tints), fonts (Hanken Grotesk, Inter) and a small size scale. Stored on the kit in
`_elementor_global_variables` version 2 through `Variables_Repository`.

**Global classes** are the utility classes of `site.css` under the same names (`eyebrow`, `h2`,
`lead`, `body-15`, `btn-primary`, `btn-outline`, `card`, `chip`, `bubble`, `band`, `navy`, and
so on). Hover effects are `hover` state variants. Responsive overrides use the `tablet` (≤1024)
and `mobile` (≤767) breakpoints; the base variant is `desktop`. Stored as `e_global_class` posts
through `Global_Classes_Repository::put`.

**Local styles** hold one-off layout on a single element, such as the hero grid ratio.

**Animation** uses two mechanisms only. Entrance effects (`rise`, `pop`) are V4 interactions,
Free triggers `load` and `scrollIn` with effects `fade`, `slide`, `scale`. Looping keyframes
(`float`, `wave`, `bob`, `wiggle`, `beat`, `twinkle`, `ring`, `drift`) live in one stylesheet in
the child theme, exposed as `anim-<name>` classes that the editor can add or remove. The
stylesheet honours `prefers-reduced-motion`. V4 per-class `custom_css` is stripped in Free and
is not used.

**Icons** are the Line Awesome glyphs the design uses (about 40 distinct), exported once as SVG
files into `media/`. Each use is an `e-svg` element whose source is the attachment, so the
editor can swap it.

**Elements**: `e-flexbox`, `e-div-block`, `e-grid`, `e-heading`, `e-paragraph`, `e-button`,
`e-image`, `e-svg`, and `e-self-hosted-video` for the hero video. Container tags are limited to
`div, header, section, article, aside, footer, a, button`; headings to `h1..h6`; paragraphs to
`p, span`. Free 4.2.4 has no atomic accordion, so the FAQ sections are built as an `e-flexbox`
per item with a heading and a paragraph, expanded by a small script in the child theme's
`anim.js` companion (`faq.js`) that toggles a class; the content stays fully editable. The
`e-tabs` family is available if a tabbed layout is ever needed. Legacy V3 widgets are not used.

**Text** goes through `html-v3` props: inline `strong`, `em`, `b`, `i`, `u`, `s`, `span`,
`a[href]` and `br` survive, attributes do not. Emphasis inside a heading uses `strong` or
`em`, styled through the parent's local style or a class, never an inline style. The wavy
underline on the hero headline is therefore an `em` styled by a global class `hl-wavy`
applied to the heading, whose CSS uses `text-decoration` longhands.

**Languages**: content files export `{ en: {...}, fr: {...} }`. The builder emits both pages
from one recipe and fails the build on a key present in one language and missing in the other.
French copy starts as a translation file; untranslated entries fall back to English and are
listed in the build report.

## 6. Builder

- `tokens.ts` and `classes.ts` declare variables and classes. A class is a label plus CSS
  strings per breakpoint and state:

  ```ts
  cls('btn-primary', {
    base: 'display:inline-block;padding:16px 30px;border-radius:999px;background:var(--sky);color:#fff;font-weight:600;font-size:16px;font-family:var(--font-body);box-shadow:0 10px 24px -10px rgba(55,181,255,.65)',
    hover: 'background:#1FA6F3;transform:translateY(-2px) scale(1.02)',
    mobile: 'padding:14px 24px',
  })
  ```

- `content/<page>.ts` holds copy and data per language, ported from the old
  `build/pages/*.mjs` arrays.
- `recipes/<page>.ts` composes the page with the DSL. Every container gets an editor title so the
  structure panel reads like the design. Links use page keys, resolved per language at emit time.
- `emit/` assigns 7-hex ids, writes element JSON with typed settings (`classes`, `tag`, `title`,
  `link`, `image`, `svg`), writes the `_css` sidecar, copies media by hash, and writes the
  manifest. Output is deterministic: same input, byte-identical artefact.
- `bun run build` in `builder/` writes `json-artefacts/<build>/`. `bun run check` runs the
  language and link validation without writing.

The builder never encodes style props. The server converts CSS to props, so Elementor's schema
remains the single authority. Because the 4.2.4 converter takes one flat declaration string,
the `_css` sidecar is keyed `styleId -> { "desktop": "...", "desktop:hover": "...",
"mobile": "..." }` and the importer calls the converter once per entry. The builder lints CSS
strings before writing: `font`, `inset`, `text-wrap`, `text-underline-offset` and `animation`
are build errors with the longhand or the `anim-*` class suggested; `transition` easing is
dropped by the converter, so the builder only writes `transition: <prop> <duration>`.

## 7. Server scripts

All scripts run through `novamira/execute-php` (body without `<?php`) and take the unzipped
artefact path. Upload is zip → `novamira/create-upload-link` → `push.sh` → unzip in
`wp-content/novamira-sandbox/`.

**bootstrap.php**, once per site, idempotent: installs Hello Elementor 3.5.1, Elementor 4.2.4,
Header & Footer Builder 2.9.4 and Polylang 3.8.9 from versioned wordpress.org zips, and the
child theme from the artefact; activates them; confirms `e_atomic_elements` is active; sets
kit defaults (container width, zero container padding, body and heading fonts from variables);
creates languages `en` and `fr` through `PLL()->model->languages->add()`; sets `en` as default
and marks `elementor-hf` translatable through `PLL()->options`; sets `/%postname%/`
permalinks and `elementor_unfiltered_files_upload`. Versions are constants at the top of the
file so both sites match.

**import.php**, in this order, aborting on the first failure:

1. Media: upload each file whose hash is not yet present, with the SVG mime filters active;
   store `_poppynz_hash`.
2. Variables: `Variables_Repository::load()`, add or update by label with
   `Variable::from_array`, `save()`.
3. Global classes: convert every `_css` entry with `Css_Converter::convert` (one call per
   breakpoint and state key); abort listing every rejected or passed-through declaration with
   its class label; then `Global_Classes_Repository::put($items, $order)` with ids
   `g-<7hex of label>`.
4. Templates: header and footer per language as `elementor-hf` posts, local `_css` converted the
   same way, saved through the Document API with an administrator set as current user.
5. Pages: per key and language, find by slug and language or create; convert local styles; save
   through the Document API; set `hide_title`, page template `elementor_header_footer`.
6. Polylang: set each post's language, link translations.
7. Front page (Home EN as `page_on_front`; Polylang serves the FR translation on `/fr/`), posts page.
8. Posts: blog articles, FR as drafts when untranslated.
9. Clear Elementor CSS cache. Return a per-entry report of created / updated / unchanged.

**snapshot.php / restore.php** cover pages, templates, kit meta, `e_global_class` posts,
variables and menus. A snapshot is taken before every production import.

**verify.php** fetches every page URL and returns status codes and a content hash, so a staging
and a production import of the same artefact can be compared.

## 8. Header, footer, blog, legal, theme

- Header: logo, nav (For families, For helpers, Safety & trust, Daycare with "New" badge, Blog),
  EN/FR switch bound to Polylang, Sign in and Get started linking to the app. Footer mirrors the
  static footer. One `elementor-hf` template per language, linked as Polylang translations; the
  child theme filters `hfe_render_template_id` through `pll_get_post()` so each language gets
  its own header and footer (verified in the spike). The nav container uses tag `div` because
  `nav` is not an allowed V4 tag.
- Blog: child theme `home.php` and `single.php` reproduce the blog index and article layouts
  with theme CSS built from the same token values. The eight existing articles are imported as
  posts.
- Legal pages: one recipe fed by the legal content file, producing Terms, Privacy and Service
  Agreement.
- Child theme: `style.css`, `functions.php` (enqueues `anim.css` and `faq.js` site-wide, Line
  Awesome on blog templates only, the `hfe_render_template_id` language filter, the SVG mime
  filters), `home.php`, `single.php`, `404.php`.

## 9. Verification and agents

- `dump_design.sh` renders a design page from `apps/landing-page/design/` (DOM dump, full
  screenshot, 2250px slices). `render.sh` renders a WordPress URL at 1280 and 390 and slices it.
  Both write to the session scratchpad. Comparison is section by section, with the slices read
  as images.
- Editor check with the built-in browser: `novamira/create-admin-access-link` gives a one-time
  login, the page opens in the V4 editor, the H1 is selected and the class panel must show the
  expected class and values. Update is never pressed in the editor.
- `verify.php` after every import; render comparison after every page build.
- Skill `elementor-v4-port`: playbook, `v4-format.md` (element and style JSON, prop types,
  variables, classes, interactions, breakpoints, import paths), `css-cheatsheet.md` (what the
  converter accepts, rejects and passes through), `pitfalls.md` (seeded with the transferable
  Marysien lessons: data and import, environment, worker rules), `worker-brief.md`,
  `poppynz.md` (site profile: MCP server names, plugin versions, page map, media map).
- Agent `page-builder` builds one page key in both languages from a brief and reports. Pages are
  delegated one at a time because they share `classes.ts`; the JSON of earlier pages must stay
  byte-identical unless the brief says otherwise.

## 10. Deploy sequence

1. `bun run build`; commit `json-artefacts/<build>/`.
2. Upload and `import.php` on staging; `verify.php`; render and compare; editor check.
3. `snapshot.php` on production; upload the same artefact; `import.php`; `verify.php`; compare
   hashes with staging.

Production is a second Novamira MCP server added to the project when the site exists.

## 11. Spike (done)

Run on staging on 2026-09-21; results in section 0. Throwaway content (page, two header
templates, global class, variables, SVG attachment, sandbox filter) was removed afterwards.
Installed plugins, the theme and the two languages were kept because the bootstrap would
recreate them identically.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Converter passes a needed declaration through as custom CSS, which Free drops | Builder lint rejects the known shorthands; importer aborts on any `customCss` or `rejected` output. |
| Elementor minor update changes the prop schema (`main` already differs from 4.2.4) | Version pinned in bootstrap; upgrade is a deliberate task that re-runs the spike page. |
| FAQ without an accordion element | Flexbox items plus `faq.js`; content stays editable, behaviour is theme code. |
| Polylang duplicates or unlinks on re-import | Importer looks up by slug and language and re-links every run. |
| Editor writes a page in a format the builder does not produce | Builder output is the source of truth; a re-import overwrites editor changes to structure, and the profile records that copy edits made in the editor must be ported back into `content/`. |

## 13. Out of scope

Provisioning WordPress sites, Dokploy configuration, Elementor Pro, a search feature, a contact
form, translation of blog posts, analytics.
