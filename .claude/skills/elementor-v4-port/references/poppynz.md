# Poppynz site profile

## Sites
| Site | URL | Novamira MCP server | Status |
|---|---|---|---|
| Staging | https://staging.poppynz.com | `novamira-staging-poppynz` | header, footer and Home (en, fr) live 2026-09-21 (Elementor 4.2.4, Hello 3.5.1, HFE 2.9.4, Polylang 3.8.9, languages en/fr) — see "Live on staging" below |
| Production | https://poppynz.com | (to be added) | not deployed |

## Versions (pinned in server/bootstrap.php)
Elementor 4.2.4 · Hello Elementor 3.5.1 · Header & Footer Builder 2.9.4 · Polylang 3.8.9 · child theme `poppynz`.

## Page map
See `apps/landing-page/builder/src/pages.ts`. Built so far: header, footer, home (en, fr).

## Live on staging (2026-09-21)
| What | EN | FR |
|---|---|---|
| Header template (`elementor-hf`) | 181 — "Site header (en)" | 208 — "Site header (fr)" |
| Footer template (`elementor-hf`) | 177 — "Site footer (en)" | 205 — "Site footer (fr)" |
| Home page | 185 — `/` (slug `home`) | 188 — `/fr/accueil/`, reachable at `/fr/` (slug `accueil`, Polylang front-page translation) |

Attachments imported: 28 (content-hash-deduped via `_poppynz_hash`; 19 icons, 8 service illustrations, 1 logo mark). Untouched pre-existing content: WordPress's default Sample Page (id 2) and draft Privacy Policy (id 3).

Four orphan `elementor-hf` duplicates (ids 179, 183, 192, 195) created by the pre-fix importer were deleted on 2026-09-21.

Second `import.php` run after the fixes below is all `unchanged` (media, variables, 127 classes, 4 templates, 2 pages). `verify.php`: `/` and `/fr/` both 200, `has_header: true`, `lang` `en-CA` / `fr-CA`.

### 2026-09-21 — second fix wave (native base-style defaults)
Elementor's V4 base styles (`.elementor .e-flexbox-base{padding:10px;...}`, `.e-div-block-base{min-width:30px;...}`, `.e-grid-base{...grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);...}`) apply to every container regardless of our own class/local css, unless we explicitly zero them ourselves. Fixed once, structurally, in `dsl.ts`'s `withDefaults()`: every `flex()`/`block()`/`grid()` now prepends `padding:0` (unless a class or the element's own css already sets padding), `block()` also prepends `min-width:0`, and `grid()` also prepends `grid-template-rows:auto` — all through the element's own local css, so no theme CSS dependency and no id changes. Also fixed the services-section heading/icon row (`home/services/h2row`): the `e-heading` widget was claiming the full row width per Elementor's multi-line flex wrap algorithm (which evaluates wrap using each item's *unshrunk* hypothetical size, so `width:auto` alone — and `flex:0 1 auto` — still gave the heading the whole line and push the icon below it); what works is `flex:1 1 0%;min-width:0` on the heading plus `align-self:flex-start` on the icon.

Render comparison re-done by the controller after this wave (browser measurements + `render.sh` slices of `/` and `/fr/`, desktop and mobile): `.dash` box model 22×2 (bounding-rect height reads slightly larger only while the `anim-wiggle` rotation is mid-cycle — cosmetic, not a regression), `.deco-d1` 14×14, `.media-box`/`.hero-copy` `padding-top:0px`, every `.e-grid-base` renders either a single explicit row or content-driven rows sized to their own content (no blank duplicate row), "How it works" intro and steps share the same row (`getBoundingClientRect().top` within 1px), the services wink icon top is within ~1px of the H2's top. No blank bands remain under the safety panels, testimonials, neighbourhood card or "Become a helper" card, and the hero video fills `.media-box` with no padding tint frame, on both `/` and `/fr/`.

Remaining named deviations after the second fix wave: none beyond the ones already listed below (hero poster, async web fonts, `deco`'s missing `pointer-events:none`, French header two-line wrap at 1280px).

### Named deviations (acceptable, not bugs)
- Hero video poster not set (video plays directly; the design's static poster frame is a cosmetic nicety, not present in the artefact's recipe).
- Google Fonts (Hanken Grotesk, Inter) load asynchronously like any real browser render, so the very first paint briefly shows fallback fonts — not visible in the final `render.sh` slices, which wait for network idle.
- `deco`'s decorative hero dots/ring/icons no longer carry `pointer-events:none` (Elementor 4.2.4's converter cannot express that property at all, and Free strips it as customCss anyway); they sit at `z-index:0` under the real content's `z-index:1`, so this has no visible or practical effect.
- Header wraps to two lines on the French homepage at 1280px (nav + lang/sign-in/CTA don't fit on one line because the French strings — "Sécurité et confiance", "Devenir aide familiale" — are longer than their English equivalents); this is ordinary `flex-wrap` responding to real content width, not a bug, and it still reads correctly.

No layout differences that make a section unrecognisable remain: header, hero, "How it works", "Two-way safety", service cards (with correct pink/blue alternation), testimonials, neighbourhood, "Become a helper", final CTA and footer all match the design section by section on desktop; mobile is single-column throughout with the header wrapping as expected.

### 2026-09-21 — third fix wave (design-fidelity pass, Plan 1)
The controller measured staging against the design at 1280×900 and found eight defects, all fixed natively (no hand CSS in the theme):
1. **Page-level styles missing** (root cause of "wrong background" everywhere, grey body text, pink card links): the kit had no `body_*`/`link_*` settings, so Elementor/Hello fell back to white body, `rgb(51,51,51)` text, a system font, `line-height:1.5` and Hello's own `rgb(204,51,102)` link color. Fixed in `server/bootstrap.php` section 4 by adding `body_background_background`/`body_background_color`/`body_color`/`body_typography_*`/`link_normal_color`/`link_hover_color` to the kit `_elementor_page_settings`. Verified live: `body` now `background:rgb(247,249,255)` `color:rgb(0,30,48)` `font-family:Inter,sans-serif` `line-height:19.2px` (1.2em of 16px), `a` `color:rgb(26,51,117)`.
2. **Outline/ghost buttons showed Elementor's blue button base background**: `btn-outline` and `btn-ghost-light-15` had no `background-color`, so the atomic `e-button` base style's blue showed through. Added `background-color:transparent` to both in `classes.ts` (kept their hover backgrounds). Verified live: both `rgba(0,0,0,0)`.
3. **Partial padding declarations left Elementor's 10px base on uncovered sides** (e.g. `.ftr-bottom` sets only `padding-top`, so left/right stayed at the base 10px). `dsl.ts` `withDefaults()` now computes which of the four physical sides (`top`/`right`/`bottom`/`left`) are covered by any padding-family property (`padding`, `padding-top/right/bottom/left`, `padding-block(-start|-end)`, `padding-inline(-start|-end)`) across the element's classes and own css, and prepends `padding-<side>:0` only for the sides nobody covers (falling back to the single `padding:0` shorthand when nothing at all is covered). Verified live: `.ftr-bottom` is `padding-top:24px;padding-right:0;padding-bottom:0;padding-left:0`.
4. **Final CTA was 1157px wide and shifted left**: `home/cta`'s single flex child `cta-inner` had no width, so it shrink-wrapped inside the row-direction `band-top` parent (the theme's `.e-flexbox-base.e-con{--width:auto}` fix from wave 2 only helps elements that don't set their own width). Added `width:100%` to the `cta-inner` class. Audited every other single-child `flex()` section in `recipes/home.ts`/`header.ts`/`footer.ts`: `home/how` and `home/hood` and `home/helpers` each have a single `grid()` child (fine, grids stretch by default); `home/services`'s single flex child already carries the `wrap` class (`width:100%`); no other instance of the bug existed. Verified live: `.cta-inner` width now equals its section's content width (1265px at 1280 viewport, was 1157px).
5. **Wink icon not inline after "Family Life"**: tested live by DOM-patching staging before touching code. Approach: `h2row` → `display:block`, the `h2` → `display:inline` (both local css), the icon wrapper → a new global class `icon-inline` (`display:inline-block;margin-left:12px`). Confirmed the e-svg widget's DOM root in this stack is a `<div>` wrapper around the real `<svg>`, not the `<svg>` itself, so ordinary block-level styling on that wrapper applies. `vertical-align:middle` (the first thing tried) is NOT in the 4.2.4 atomic converter's supported property list and aborted the import (`class icon-inline/desktop not convertible... vertical-align:middle`) — dropped it and relied on inline-block's default baseline alignment instead, confirmed acceptable live (icon sits right after the heading's last word, very slightly lower than exact cap-height centering). Removed the previous `flex:1 1 0%;min-width:0`/`align-self:flex-start` workaround from wave 2, now superseded.
6. **Footer links incomplete**: restored the missing placeholder links (`url:"#"`) in `content/footer.ts` in design order — Poppynz column gained "Pricing & fees" and "About" before "Blog"; Support column gained "Help & FAQ" and "Refer someone" and was reordered to "Help & FAQ, Contact, Sign in, Refer someone". French labels use the typographic apostrophe (`Recommander quelqu'un`). Verified live: both columns list all seven/four entries in order.
7. **Media credits missing**: added `media-credit` (hero video, bottom-right) and `photo-credit` (neighbourhood/helpers photos, bottom-left) global classes, plus a `text(..., tag:"span")` element inside `media-box` and inside the two now-`position:relative` photo blocks. Credit strings live in `content/home.ts` (`hero.video.credit`, `neighbourhood.credit`, `helpers.credit`), identical in both languages. Verified live: all three credit strings present with the exact design text.
8. Deploy verified end to end: `bun test` (73 pass, including 3 new padding-coverage cases), `bun run typecheck`, `bun run build`; pack → upload-link → push → `unpack.php` → `bootstrap.php` (`kit.defaults: set`) → `import.php` (first run: aborted once on `icon-inline`'s `vertical-align`, fixed and re-packed; second push's first run reported `btn-outline`/`btn-ghost-light-15`/`cta-inner` `updated`, `media-credit`/`photo-credit`/`icon-inline` `created`, `footer.en/fr` and `home.en/fr` `updated`; third run — the actual idempotency check — all `unchanged`) → `verify.php` (all 200, `has_header:true`, correct `lang`).

Remaining named deviations after this wave: the wink icon sits at inline-block's default baseline rather than exact `vertical-align:middle` (unsupported by the 4.2.4 Free converter) — a few px lower than perfect cap-height centering, not visually wrong. Everything else listed above under "Named deviations" still applies unchanged. The Browser pane was hidden for part of this wave's verification (screenshots came back blank while hidden); DOM measurements (`getBoundingClientRect`/`getComputedStyle`) were used instead and are recorded above — a few section-by-section screenshots were captured before/after the pane was hidden and matched the design.

## Deploy
1. `cd apps/landing-page/builder && bun test && bun run build`; commit `json-artefacts/current`.
2. `bash .claude/skills/elementor-v4-port/scripts/pack.sh current`
3. `novamira/create-upload-link` {"path":"wp-content/novamira-sandbox/poppynz-artefact.zip","overwrite":true} on the target server, then `push.sh <zip> <token> <site url>`.
4. `execute-php`: `server/unpack.php`; first time only `server/bootstrap.php` (twice on a bare site); production only `server/snapshot.php`; then `server/import.php`; then `server/verify.php`. **If this deploy changed anything under `theme/poppynz/` (e.g. `anim.css`), re-run bootstrap's theme-copy step (its step 2) even on a non-first deploy** — `import.php` never touches theme files, only `unpack.php`'s zip extraction plus that copy step do, and skipping it silently leaves the live theme file stale while everything else (classes, pages) updates correctly. Then bypass the CSS file's own browser cache when verifying — see pitfalls.md ("`anim.css`...enqueued with a STATIC version string"). If production needs to be rolled back, `server/restore.php` restores snapshotted posts, kit meta and options. Posts created after the snapshot are reported under `'unexpected'` and must be removed by hand.
5. `render.sh <url> wp-<key>` and compare with `dump_design.sh` slices.

## Editor check
`novamira/create-admin-access-link` with `admin_path=post.php?post=<id>&action=elementor`, exchange the token with the returned curl example, open `login_url` in the built-in browser within 60 s. Select an element, Style tab: the class chips must show the expected labels and the Spacing/Typography sections the converted values. Do not press Publish (except for the single deliberate round-trip test in Task 14, immediately reverted by re-running `import.php`). If every element shows only the `local` chip plus a "Some classes are missing" warning and the canvas looks unstyled, `import.php` hasn't synced the PREVIEW context yet — see pitfalls.md.

## Decisions log
- 2026-09-21: Connect Polylang for Elementor dropped; `hfe_render_template_id` filter in the child theme instead.
- 2026-09-21: FAQ = flexbox items + theme `faq.js` (no accordion in Free 4.2.4).
- 2026-09-21 (Task 14): `import.php` fixed in six places found only by deploying for real — see pitfalls.md for each: (1) `pll_set_post_language()` missing for `elementor-hf` templates, duplicating the fr header/footer on every run; (2) `foreach ($el['styles'] ?? [] as &$style)` silently never applied local per-element CSS anywhere on the site; (3) elements referenced global classes by label, not id, so no class's CSS was ever bundled for any document (the whole site rendered unstyled); (4) global-class print order is reversed by Elementor, so a same-element modifier class (`svc-pink`, `lang-on`, `bubble-40`/`bubble-48`) needs to sort *before* its base class in `classes.ts`; (5) the order-merge logic only ever appended new ids, so re-ordering an existing class in `classes.ts` had no effect until fixed to treat `classes.json` as authoritative; (6) `Global_Classes_Repository::put()` only wrote the frontend context, leaving the editor's own preview context empty forever, so opening the editor on any imported page showed every class as "missing" and rendered the canvas unstyled — fixed by also calling `put()` with `set_preview(true)`. Also fixed six CSS-conversion rejections in `classes.ts` (two-value `gap`, `pointer-events`, decimal `opacity`, `flex-grow`/`flex-shrink` longhands, unitless `rotate(0)`, per-side `border-*-style`) and one systemic layout bug (Elementor's `.e-con{width:100%}` breaks any flex-row with unsized children) fixed once in the theme's `anim.css`.

## Production blockers
1. Run `bootstrap.php` twice on the bare site.
2. `snapshot.php` before `import.php`.
3. `verify.php` on both sites and compare hashes.

Accepted as-is (owner's decision, 2026-09-22): the hotlinked Pexels hero video (`content/home.ts` `hero.video`) and the two Unsplash `background-image` URLs in `recipes/home.ts` (neighbourhood and helpers photos) stay as they are for now, on production too. This was previously listed as a blocker; it is not one any more, so do not re-raise it. What it costs, for whoever revisits it: the three assets depend on someone else's CDN staying up and permitting hotlinking, they never enter the media library so the team cannot swap them from the Elementor editor, and the two photos are CSS backgrounds and therefore carry no alt text. Replacing them means registering the files through `MediaRegistry` and turning the two photos into `e-image` elements (or an attachment-backed `background-image`), which needs the owner's imagery and licence choice first.

### 2026-09-22 — owner review of the live Home page
The owner compared staging against the design and rejected the previous "matches section by section" report: the defects were colour, alignment and wrapping, which the screenshot-only check had skipped. Fixed, deployed and re-verified by measurement (see SKILL.md § Loop step 4 for the method now expected):
- Safety intro lost its 800px cap; the heading spans the content width (3 lines at 1440, 2 at 1920).
- Services title block flexes to fill the row, so the heading runs on one line from 1280 up; the wink icon is 40px (cap height is 32px) and nudged onto the baseline with `position:relative;inset-block-start:6px`.
- Services lead paragraph then moved BELOW the title and full width (owner's follow-up); the heading row is now a column with `gap:16px`, and the lead carries no width cap.
- Headings use `text-wrap:balance` (theme `anim.css`, heading classes only) because the converter has no `text-wrap` and the design relies on balanced breaks.
- Polylang `redirect_lang` turned on (and added to `bootstrap.php`): the French home page is `/fr/`, with `/fr/accueil/` redirecting to it.

Expected, not a bug: every nav and footer link except Home 404s — For families, For helpers, Safety & trust, Daycare, Blog and the three legal pages are Plan 2. A 404 with the Poppynz header on it means the link works and the page does not exist yet.

### 2026-09-22 — `/app` -> app-subdomain redirect
The web app (`app.<host>`, a separate SvelteKit deployment) is reached from the marketing site through a
front-end redirect in the child theme (`theme/poppynz/functions.php`), not a Dokploy/Traefik rule — this
repo has no Dokploy access by design, so a Traefik rule (which would avoid booting WordPress at all for
these requests) was not an option here.
- Hooked on `template_redirect` at priority 0 (before `redirect_canonical`'s 10 and before Polylang's
  language redirect), skipped for admin/AJAX/cron/REST requests.
- Matches `/app`, `/app/<rest>`, and the same with a two-letter language prefix (`/fr/app`,
  `/fr/app/<rest>`), case-insensitively, trailing slash tolerated — regex-bounded so `/appointments` or
  `/fr/apply` are never caught.
- Target host is **derived, never hard-coded**: `wp_parse_url( home_url(), PHP_URL_HOST )` prefixed with
  `app.`, unless the host already starts with `app.` (bail out, never redirect to self). Same artefact
  therefore redirects `staging.poppynz.com` -> `app.staging.poppynz.com` and (once deployed) `poppynz.com`
  -> `app.poppynz.com` with no per-site configuration.
- Preserves the path after `/app` and the query string, e.g. `/app/auth/sign-up?x=1` ->
  `https://app.<host>/auth/sign-up?x=1`.
- **302**, not 301 — the setup is still being finalised and a browser must not cache the redirect while it
  can change; the code comment in `functions.php` says so.
- `builder/src/pages.ts`'s `APP` export changed from absolute `https://app.poppynz.com/...` URLs (which on
  staging wrongly pointed at the *production* app) to relative `/app/auth/sign-up` / `/app/auth/sign-in`
  paths through this redirect — correct on both sites at once. `content/footer.ts`'s "Sign in" link (the
  only other place that hard-coded the app URL, bypassing `APP`) now goes through `APP.signIn` too.
  `resolveLinks()` only rewrites `page:<key>` values, so these relative paths pass through untouched;
  confirmed in the built artefact (`json-artefacts/current`) — no `app.poppynz.com` string remains anywhere
  in it.
- Verified live on staging (`curl -sI`, all 302 with the expected `location`): `/app` ->
  `https://app.staging.poppynz.com/`, `/app/` -> same, `/app/auth/sign-up` ->
  `https://app.staging.poppynz.com/auth/sign-up`, `/app/auth/sign-in?foo=1` ->
  `https://app.staging.poppynz.com/auth/sign-in?foo=1`, `/fr/app` -> `https://app.staging.poppynz.com/`,
  `/fr/app/auth/sign-up` -> `https://app.staging.poppynz.com/auth/sign-up`. Following one redirect
  (`curl -sIL`) reaches a 200 on the app subdomain. No regression: `/`, `/fr/`, an existing page all still
  200 and un-redirected; `/appointments` still 404s from WordPress rather than redirecting. Rendered `/`
  and `/fr/` both show `/app/auth/sign-up` (14 occurrences: header, hero cards, service cards, helpers CTA,
  final CTA x2) and `/app/auth/sign-in` (2 occurrences: header, footer) — all relative, none absolute.
  `import.php` re-run a second time: every entry `unchanged`.
- Theme `style.css` `Version` bumped to `1.0.2` (cache-buster for the theme's enqueued assets).
- **Deploy note**: because this changed `theme/poppynz/functions.php`, the theme-copy step
  (`bootstrap.php`'s step 2, or bootstrap.php in full — it's idempotent) must be re-run after `unpack.php`
  on every deploy that touches theme files — `import.php` never copies theme files, only `unpack.php`'s zip
  extraction and that copy step do.
