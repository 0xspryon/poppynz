# Poppynz site profile

## Sites
| Site | URL | Novamira MCP server | Status |
|---|---|---|---|
| Staging | https://staging.poppynz.com | `novamira-staging-poppynz` | header, footer, Home, For families, For helpers, Safety & trust, Daycare matching, Privacy Policy, Terms of Service, Service Agreement and the Blog (en, fr) live 2026-09-22 (Elementor 4.2.4, Hello 3.5.1, HFE 2.9.4, Polylang 3.8.9, languages en/fr) — see "Live on staging" below |
| Production | https://poppynz.com | (to be added) | not deployed |

## Versions (pinned in server/bootstrap.php)
Elementor 4.2.4 · Hello Elementor 3.5.1 · Header & Footer Builder 2.9.4 · Polylang 3.8.9 · child theme `poppynz` (style.css `Version` 1.0.9).

## Page map
See `apps/landing-page/builder/src/pages.ts`. Built so far: header, footer, home, families, helpers, safety, daycare, privacy, terms, agreement (en, fr).
The `blog` key is the one page with no recipe: it is a child-theme template, not an Elementor document (see the Blog section below).

## Live on staging (2026-09-21)
| What | EN | FR |
|---|---|---|
| Header template (`elementor-hf`) | 181 — "Site header (en)" | 208 — "Site header (fr)" |
| Footer template (`elementor-hf`) | 177 — "Site footer (en)" | 205 — "Site footer (fr)" |
| Home page | 185 — `/` (slug `home`) | 188 — `/fr/accueil/`, reachable at `/fr/` (slug `accueil`, Polylang front-page translation) |
| For families | 440 — `/for-families/` | 443 — `/fr/pour-les-familles/` |
| For helpers | 564 — `/for-helpers/` | 567 — `/fr/pour-les-aides/` |
| Safety & trust | 691 — `/safety-and-trust/` | 694 — `/fr/securite-et-confiance/` |
| Daycare matching | 727 — `/daycare-matching/` | 730 — `/fr/jumelage-garderie/` |
| Privacy Policy | 821 — `/privacy-policy/` | 824 — `/fr/politique-de-confidentialite/` |
| Terms of Service | 831 — `/terms-of-service/` | 834 — `/fr/conditions-d-utilisation/` |
| Service Agreement | 799 — `/service-agreement/` | 802 — `/fr/entente-de-service/` |
| Blog index (`page_for_posts`) | 1020 — `/blog/` | 1021 — `/fr/blogue/` |
| Articles (native posts, not Elementor) | 1022–1036 even — `/blog/<slug>/` | 1023–1037 odd — drafts |

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

## 2026-09-22 — For families (Plan 2, first page after Home)

Live: EN 440 `/for-families/`, FR 443 `/fr/pour-les-familles/`, both 200, `has_header:true`, `lang`
`en-CA` / `fr-CA`. `import.php` re-run after the final deploy: every media, variable, class, template
and page entry `unchanged`. Home's `pages/home.en.json` and `pages/home.fr.json` are byte-identical to
before this page existed (`git diff --stat` lists no page or template file); the only artefact churn is
18 new labels appended to `classes.json` and one new `chip-bg` variable — no existing class was edited,
so Home's rendering is untouched.

New global classes: `h3-light-20`, `em-navy`, `btn-primary-15`, `chip-info`, `tint-blue`, `tint-pink`,
`art-card`, `art`, `card-dark`, `num-light`, `svc-row`, `svc-rate`, `price-row`, `price-amount`,
`faq-item`, `is-open`, `faq-question`, `faq-answer`. New variable: `chip-bg` `#D6EBFF`.

### Local styles beat global classes (settled by inspection, not assumption)
Elementor writes global classes to `global-<post>-frontend-<bp>.css` as `.elementor .<label>{...}` and
per-element local styles to `local-<post>-frontend-<bp>.css` as `.elementor .e-<id>-<hex>{...}` — the
SAME specificity (0,2,0), with the local sheet enqueued AFTER the global one. So an element's own `css:`
map always wins over a class it also carries, and a page can reuse a shared class and override one
property locally (`h1` + `font-size:clamp(38px,4.6vw,60px)` on this hero) without touching the class.
The child theme's `anim.css` is enqueued after BOTH, which is why `.faq-answer{display:none}` there
owns `display` outright and the `faq-answer` class must not declare it.

### Converter findings (checked with `pz_converter()->convert()` before writing any of it)
Not convertible, would abort the import: `text-align:left` (but `start`/`end`/`center`/`justify` are
fine), `align-items:baseline` (`flex-start`/`center`/`flex-end`/`start`/`end`/`stretch` are fine),
`justify-self` (any value — centre a grid item with `margin-left:auto;margin-right:auto` instead),
`place-self`, `object-position` in keyword form (`right bottom`, `center`) although the percentage form
(`100% 100%`) converts, and `background-size`/`background-position` **on their own** although both
convert when they accompany a `background-image` in the same declaration block. Convertible despite not
being listed in css-cheatsheet.md: `cursor`, `min-height`, `align-items:start`, `max-width:<%>`,
three-value `padding` shorthands, `width:min(100%,420px)`, `grid-column:span 2`, `font-style`.

### FAQ (no accordion in Free 4.2.4)
One `faq-item` flexbox per question holding a `faq-question` (an `e-flexbox` with `tag:"button"`, so it
stays keyboard-operable) and a `faq-answer` paragraph; the child theme's `assets/faq.js` toggles
`is-open` on the item. `is-open` is declared as an empty global class only so the first question can
start open, matching the design.

The `+`/`−` glyph swap is CSS, not script: BOTH icons are rendered into every question (classes
`faq-icon-plus` / `faq-icon-minus`), and anim.css shows one and hides the other off the item's
`is-open` state. That keeps `faq.js` a pure class toggle - it never has to know about icon markup, so
the same three rules work for every page that reuses the pattern - and it keeps `display` owned in one
place, exactly as `faq-answer` is. Neither icon class declares `display`. Measured live: both glyphs
are 20x20 at the same 21px inset, so swapping them shifts nothing.

Verified live with real clicks at 1280 and on both languages: the first item starts open showing `−`
and the rest show `+`; clicking another opens it (`−`) and closes the first (back to `+`); clicking the
open one closes it; and clicking the inner text span still resolves through `closest('.faq-question')`.
The FAQ lead's "Ask support" / "Écrivez au soutien" link points at `mailto:support@poppynz.com`.

### Named deviations (this page)
- The hero's "See how it works" button is inert (`#`). The design anchors it to `#how`; a V4 atomic
  element renders no `id` attribute (only `data-id` and its class list), so there is nothing to anchor to.
- The helper-profile photo's Unsplash credit is in the element's editor title rather than the DOM. The
  design hides it with `.sr-only`, which needs `clip` — not convertible.
- The safety CTA's arrow is an 18px SVG against the design's 15px webfont glyph, making that button 3px
  wider (321 -> 324).
- The design's own FAQ grid overflows at 390px (`grid-column:span 2` in a grid that has collapsed to one
  column); ours carries `mobile:"grid-column:span 1"` and does not. Deliberate, and the reason the page
  has no horizontal overflow at 390.
- `$88.20` and `CAD` are sibling spans rather than the design's nested `<span class="cur">`, so `CAD`
  does not inherit the big number's `-.02em` letter-spacing, and they align on `flex-end` rather than
  `baseline` (not convertible).

### Open, NOT introduced by this page: the kit's body line-height
`_elementor_page_settings` on the kit sets the body line-height in **em** (`1.2em`), which computes to a
fixed `19.2px` on `body` and is then inherited as that fixed pixel value by every descendant instead of
re-resolving against the descendant's own font-size. The design's `body` sets no line-height at all, so
each element resolves `normal` against its own size. Measured consequences, which cut both ways:
12px text (eyebrows, `label`, `vetted`) gets a 19.2px line box instead of ~15px (+4px each), while a
22px name gets 19.2px instead of 29px and a 24px total gets 19.2px instead of 31px (-10 and -12px).
This affects Home identically and is the single largest remaining source of measured difference
(61 diff lines per width). It is NOT fixed here: the fix is one kit setting (a unitless line-height
around 1.25, or removing it), and it changes every page, so it needs the owner's call plus a re-verify
of Home. Worked around on this page only, for the elements this page owns: `chip-info`, `num-light`,
`svc-rate` and `faq-question` declare explicit line-heights, and the profile name, location, total and
currency carry local ones — all set to the design's own measured line-box heights. The shared `eyebrow`,
`label` and `vetted` classes were left alone on purpose, so Home does not move.

### Also found, shared-class, left alone
The `checks` class sets `color:var(--muted)`, but the design's `.checks` sets no colour and inherits the
body ink (`#001E30`). Overridden locally here (`color:var(--ink)` on the checks list); Home still renders
its own check lists in muted grey, which does not match its design either. One-line fix in `classes.ts`
whenever someone is ready to re-verify Home.

### Verification (skill step 4)
Computed styles and bounding rects for 84 matched selector pairs, diffed design-vs-live at 1280, 1440,
1920 and 390. **Zero unexplained differences at 1280, 1440 and 1920**; four residual section-height
deltas of 7-9px at 390, all traceable to the kit line-height above. `document.documentElement.scrollWidth
> clientWidth` is false at every width on both sides. Every other difference is bucketed with a reason in
the harness (structural V4 facts, by-construction markup differences, or the interaction artefact below).
Two measurement traps worth knowing: Chrome headless clamps `--window-size` to a ~500px floor, so a
"390px" run actually lays out at 500 — measure narrow widths inside a fixed-width same-origin iframe
instead; and the load-triggered `scale` interaction on `.vetted` is caught mid-flight under
`--virtual-time-budget`, reporting anything from 0x0 to 71x23 (live, in real time, it is 77x27 with
`transform:none`).


## 2026-09-22 — For helpers (Plan 2, second page)

Live: EN 564 `/for-helpers/`, FR 567 `/fr/pour-les-aides/`, both 200, `has_header:true`, `lang`
`en-CA` / `fr-CA`. Second `import.php` run after the final deploy: all 244 entries `unchanged`.
Home's and For families' `pages/*.json` and every `templates/*.json` are byte-identical to before this
page existed (`git diff --stat` lists none of them); the only artefact churn is 13 new labels in
`classes.json`, 6 new media files and the two new page files. No existing class was edited and no new
variable was needed, so Home and For families render exactly as before.

New global classes: `stack-40`, `h3-22`, `chip-req`, `bubble-tint`, `card-white`, `doc-panel`,
`row-dark`, `row-dark-t`, `row-item`, `row-lbl`, `rate`, `thumb`, `thumb-img`. Reused from For
families: the whole FAQ pattern (`faq-item`/`is-open`/`faq-question`/`faq-icon-plus`/`faq-icon-minus`/
`faq-answer` plus the theme's `faq.js` and its three anim.css rules), `art-card`/`art`/`tint-blue`/
`tint-pink`, `chip-info`, `em-navy`, `price-row`/`price-amount`, `btn-primary-15`. No theme change was
needed at all, so `bootstrap.php`'s theme-copy step did not have to be re-run.

### Two flex traps this page hit (both invisible in a screenshot)
1. **`e-grid` ships `gap:20px`.** The hero is a full-bleed two-column grid with no gap in the design;
   without an explicit `gap:0` Elementor's `.e-grid-base` gap applied and both columns came out 630px
   instead of 640px. A grid whose design has no gap must say `gap:0`, exactly like the `padding:0` and
   `grid-template-rows:auto` that `dsl.ts` already prepends.
2. **An `e-svg` wrapper shrinks; a font glyph does not.** The design's icons are Line Awesome `<i>`
   elements whose `min-width:auto` resolves to the glyph itself, so they never shrink. Our e-svg
   wrapper's min-content size is 0, so as an ordinary flex item beside a text span whose max-content
   width overflows the row it shrinks: the 18px checklist ticks measured 14.5px at 1280 and the 20px
   pen icon 16.34px at 390. Every icon that shares a flex row with text needs `flex:0 0 auto` (the FAQ
   `+`/`−` classes already had it). Caught only by comparing `getBoundingClientRect().width` against
   the declared width.

### The kit line-height, worked around per element (not per class)
The kit's `1.2em` body line-height is still open (see the For families section above). This page keeps
the same policy — shared classes are left alone so Home and For families do not move — and gives every
element it owns the design's own measured line box locally: the 7 eyebrows and 2 `label` spans
(`line-height:15px`), the 8 `h3` card headings (27px; Elementor's atomic heading base sets 1.2, giving
25.2px instead of the design's 27px), the three `btn-primary*` buttons (20px), the price rows and the
earnings link (19px), and the avatar (17px). New classes declare their own line-height inline.
Fixing this properly is still one kit setting plus a re-verify of Home, For families and now this page.

### French copy
Written from the terminology already in `content/home.ts` / `content/footer.ts`: "aide familiale",
"Devenir aide familiale", "séance", "entente écrite", "tarif horaire", "frais de service",
"vérification du secteur vulnérable", "ÉPE" / "PSSP", "LPRPDE", badge "Vérifiée", "Major-domo" kept
untranslated. **French needs no-break spaces and the headless render is how you find out**: with an
ordinary space the rate pill broke between "30" and "$/h" onto two lines, and the closing `»` of the
hero pull-quote dropped onto a line of its own. `content/helpers.ts`'s French block therefore uses
U+00A0 before `$` and `%` and inside the guillemets (16 of them); the English block has none. The fix
is content-only — the next import reported `helpers.fr` `updated` and `helpers.en` `unchanged`.

### Named deviations (this page)
- The hero's "See what's required" button and the earnings "Full pricing for both sides" link are
  inert (`#`): the design anchors the first at `#documents`, and a V4 atomic element renders no `id`.
- The hero video has no poster (`video()` takes a media-library key; the design's poster is a
  hotlinked Pexels still). Same as Home.
- `$71.40` and `CAD` are sibling spans rather than the design's nested `<span class="cur">`, so `CAD`
  does not inherit the big number's `-.02em` letter-spacing and they align on `flex-end` rather than
  `baseline`. Same as For families.
- The shared `btn-primary` class carries `mobile:"padding:14px 24px"`, which the design has no
  equivalent for (it keeps 16px 30px at every width). This is the ONLY measured difference left at
  390 and it is identical on Home; left alone rather than overridden on one page.
- The hero `deco` dots are effectively invisible here, exactly as in the design: the navy copy panel
  covers the left half and the video covers the right. (`deco`'s `z-index:0` also reads back as `auto`
  live — pre-existing on every page, and with no effect since the real content is later in DOM order.)
- Icons are `<svg>` where the design uses Line Awesome `<i>` glyphs, so `font-family`/`font-size`/
  `font-weight`/`line-height` on those elements differ by construction; width, height and colour match.

### Verification (skill step 4)
119 matched selector pairs, computed styles plus bounding rects, design-vs-live at 1280, 1440, 1920 and
390. **Zero unexplained differences at 1280, 1440 and 1920**; at 390 only the `btn-primary` mobile
padding above. `documentElement.scrollWidth > clientWidth` is false at all four widths in BOTH
languages, and no element is wider than the viewport. `render.sh` slices (desktop and mobile, en and fr)
match the design's slices section by section. FAQ driven with real clicks in both languages: the first
item starts open showing `−`, clicking another question's inner text span opens it and closes the first,
clicking the open one closes it, and every question is a real `<button>`. Editor check: the canvas
renders fully styled, no "classes are missing" warning, the selected element's `classes` setting holds
the global class **id** (`g-8325b57` → `row-item`), and all 13 new classes are present in both the
frontend and the preview contexts (166 each). Update/Publish never pressed.

### Found while measuring, NOT fixed (shared, needs its own re-verify)
- The `hdr` class declares `gap:12px;column-gap:24px` but the live header computes `gap: 12px` — the
  `column-gap` override is not reaching the element. Pre-existing, affects every page's header.
- `h3` (and its siblings `h3-lg`, `h3-light`, `svc-title`, `hero-card-title`) declare no line-height,
  so Elementor's atomic heading base (1.2) applies instead of the design's `normal`. Worked around
  locally here; Home and For families still render their own h3s ~1.8px short.
- The shared `media-credit` and `checks` classes still need the per-page local overrides this page and
  For families both apply (line-height, and `color:var(--ink)` respectively).

## 2026-09-22 — Safety & trust (Plan 2, third page)

Live: EN 691 `/safety-and-trust/`, FR 694 `/fr/securite-et-confiance/`, both 200, `has_header:true`,
`lang` `en-CA` / `fr-CA`. Second `import.php` run after the deploy: all 269 entries `unchanged`
(51 media, 30 variables, 176 classes, 4 templates, 8 pages). Home's, For families' and For helpers'
`pages/*.json` and every `templates/*.json` are byte-identical to before this page existed
(`git diff --stat` lists none of them); the only artefact churn is 10 new labels in `classes.json`,
one new variable, 11 new media files and the two new page files. No existing class was edited.

New global classes: `stack-4`, `em-ink`, `pill-nav`, `icon-orange`, `icon-danger`, `chip-ok`,
`row-dark-title`, `row-dark-desc`, `credibled-row`, `never-row`. New variable: `danger` `#BA1A1A`.
Reused as-is: `hero`/`hero-copy`/`deco-*`, `row-item`/`row-lbl`, `checks`/`check-row`, `credibled`'s
`dot`, `art-card`/`art`/`tint-blue`/`tint-pink`, `chip-info`/`chip-req`, `vetted`, `label`, `step-top`,
`bubble`/`bubble-tint`, `card`, `row-dark`/`num-light`, `grid-2`/`grid-cards`/`stack-*`, `card-shadow`/
`shadow-deep`/`photo-credit`, `btn-primary`/`btn-outline`/`btn-row-center`, `h2-sm`/`h2-light`/`h2-cta`.

### The two check-lists do NOT reuse `checks`/`check-row` (asked, and answered by measuring)
The Credibled strip's four points and the "What we never do" six promises look like the existing
check lists, but the design draws each row as a bordered white card (`padding:16px 18px` / `18px 20px`,
`border-radius:8px`, its own border colour and font size) where `check-row` is a bare `display:flex;
gap:10px` row with no box at all. Reusing `checks` with a different icon colour would have dropped the
card entirely, so each list got its own class — `credibled-row` (4 uses, orange border, 15px) and
`never-row` (6 uses, line border, 16px). The shared `checks`/`check-row` pair IS reused, unchanged, for
the Two-way verification list, which really is the bare-row shape. `icon-orange` and `icon-danger` are
the only new pieces the icons needed.

### Converter finding: `font-family` only converts as `var(--label)`
Chasing a 3px-wide difference on the photo credit turned up the quietest failure in the 4.2.4
converter: a literal `font-family` value — one family, a generic, or a whole stack — produces neither a
prop nor any `customCss`, so the import happily reports success and the element inherits the kit font.
Full detail and the one class it affects (`photo-credit`, on Home and For families too) in pitfalls.md.
NOT fixed here: the fix is a new `system-ui` font variable in `tokens.ts`, which moves two live pages
and needs their own re-verify.

### French copy
Written from the terminology already in `content/home.ts` / `content/footer.ts`: "aide familiale",
badge "Vérifiée", "vérification du secteur vulnérable", "vérification approfondie du casier judiciaire",
"pièce d'identité gouvernementale avec photo", "entente écrite", "séance", "LPRPDE", "ÉPE" / "PSSP",
"lien magique", "Commencer". "Clear" on a record-check pill is "Aucun dossier". Unlike For helpers this
page needs no U+00A0: it has no `$`, no `%` and no guillemets, and the repo's existing French uses an
ordinary space before a colon and none before `?`/`!`. Checked in the headless render at 390 and 1280 —
nothing wraps badly and the longest pill ("Aucun dossier · Credibled", 166px) still sits on one line
beside its label with the row's own 12px gap.

### Named deviations (this page)
- The hero's five section pills are inert (`#`). The design anchors them at `#helpers`, `#families`,
  `#admin`, `#data` and `#never`; a V4 atomic element renders no `id`, so there is nothing to anchor to.
  Same as the For families and For helpers hero secondary CTAs.
- The verification-status chips carry `flex:0 0 auto` instead of the design's `white-space:nowrap`,
  which is not in the converter's property list. It is the better guard anyway: measured at 390 in
  French, the widest chip keeps its full 166px and the label shrinks beside it, `scrollWidth ==
  clientWidth` on every row.
- The "Verified Families" photo is a CSS background with an Unsplash URL, so it carries no alt text
  (the design's alt is in the editor title) and its placeholder tint is `--tint` rather than the
  design's neutral grey — invisible once the photo loads. Same as Home's two photos.
- `photo-credit` renders in Inter, not the design's system font, and lacks its `max-width`/ellipsis:
  152px wide against the design's 149px. Shared class, pre-existing — see the converter finding above.
- At 390 the "never" list carries `grid-column:span 1` where the design keeps `span 2`, so our list is
  342px against the design's 352px and its heading fits on one line instead of two (section 798px vs
  831px). Deliberate, and the reason this page has no horizontal overflow at 390 — the design's own
  list spills 10px into the page gutter. Same choice as the For families FAQ.
- The shared `btn-primary` carries `mobile:"padding:14px 24px"`, which the design has no equivalent for
  (it keeps 16px 30px at every width). Identical on Home and For helpers; left alone rather than
  overridden on one page. This is the ONLY measured difference left at 390 outside the two above.
- Icons are `<svg>` where the design uses Line Awesome `<i>` glyphs, so `font-*` on them differs by
  construction; width, height and colour match. The one visible consequence: the Two-way check ticks
  are 18x18 against the design's 18x20.5 inline line box (same drawn tick).

### Verification (skill step 4)
88 matched selector pairs, computed styles plus bounding rects, design-vs-live at 1280, 1440, 1920 and
390, measured inside a fixed-width same-origin iframe (Chrome headless clamps `--window-size` to ~500px;
the live page is measured from a `curl`ed copy served beside the design, which works because WordPress
emits absolute asset URLs). **Zero unexplained differences at 1280, 1440 and 1920**; at 390 only the
`grid-column:span 1` choice and the shared `btn-primary` mobile padding. Every other difference is
bucketed with a stated reason (structural V4 facts, by-construction markup, or the kit line-height).
`documentElement.scrollWidth > clientWidth` is false at all four widths in BOTH languages and no element
is wider than the viewport. French was additionally diffed live-EN against live-FR: the only
non-text-metric difference at any width is `art`'s `margin-top:auto` resolving to 0 because the French
card copy is longer — every colour, border, padding, gap and grid definition is identical.
`render.sh` slices (desktop and mobile, en and fr) match the design's slices section by section.

Editor check: canvas renders fully styled, no "classes are missing" warning, the selected H1's Style tab
shows the `local` + `h1` chips, and all 176 classes are present in BOTH the frontend and preview
contexts. Every new class is referenced in the saved `_elementor_data` by its global-class **id** with
exactly the expected count (`em-ink` 12, `never-row` 6, `pill-nav` 5, `stack-4`/`chip-ok`/`icon-orange`/
`row-dark-title`/`row-dark-desc`/`credibled-row` 4, `icon-danger` 6), identical in EN and FR, with zero
raw label references leaked. Update/Publish never pressed.

### Measurement trap worth knowing (cost two false alarms)
A load-triggered `slide` interaction leaves a real `transform: translateY(~92px)` on `.hero-copy` if the
page is scrolled or repainted WHILE it is playing — `scrollIntoView` during the animation is enough. In
that state the hero's two grid items genuinely overlap by 60px when measured, and a headless capture
under `--virtual-time-budget` paints them overlapping too, which looks exactly like a layout bug. It is
not: on a clean load the transform settles to `none` and the grid computes two rows
(490.344 + 32 gap + 470.5) that sum exactly to the hero's content height, in both languages at 390.
Same bucket as the `.vetted` badge, which reads anything from 0x0 to its true 71x23 under a headless
capture and is 71x23 with `transform:none` in a real browser. Confirm any suspected overlap by reading
`getComputedStyle(el).transform` before believing the rect.


## 2026-09-22 — Daycare matching (Plan 2, fourth page)

Live: EN 727 `/daycare-matching/`, FR 730 `/fr/jumelage-garderie/`, both 200, `has_header:true`,
`lang` `en-CA` / `fr-CA`. Second `import.php` run after the deploy: all 277 entries `unchanged`
(55 media, 30 variables, 178 classes, 4 templates, 10 pages). Every earlier page's `pages/*.json`
and every `templates/*.json` is byte-identical to before this page existed (`git diff --stat` lists
none of them); the only artefact churn is 2 new labels in `classes.json` (14 added lines, 0 removed),
4 new media files and the two new page files. No existing class was edited and no new variable was
needed, so Home, For families, For helpers and Safety & trust render exactly as before.

New global classes: `step-pill`, `link-light`. Everything else is reused: `hero`/`hero-copy`/`deco-*`,
`media-box`/`media-credit`, `band`/`band-top`/`sec`/`sec-x`/`wrap`, `stack-16`/`stack-20`/`stack-24`,
`card`/`card-lift`, `step-top`/`step-num`, `bubble`/`bubble-tint`, `h1`/`h3`/`h3-22`/`h2-light`,
`lead`/`lead-lg`/`lead-light`/`body-15`/`body-15-light`/`body-18`/`muted-13`/`trust`,
`btn-primary`/`btn-primary-14`/`btn-primary-15`/`btn-outline`/`btn-row`/`btn-row-center`,
`chip-req`, `navy`/`shadow-deep`, `row-dark`/`row-dark-t`/`num-light`, `em-accent`, `icon-*`.

### The design's `.dstep` is `card` + `card-lift`, declaration for declaration
The four "Getting matched is simple" cards look like a fifth card variant (the page declares its own
`.dstep` in a `<style>` block), but diffing that rule against site.css's `.card` and `.card-lift:hover`
shows every declaration identical — same gap, padding, radius, border, background, and the same
`translateY(-4px) rotate(-0.6deg)` hover. So they reuse both shared classes and add nothing. Its `.n`
badge IS new: `step-num` drawn as a tinted pill, so `step-pill` carries only the three additive
properties (`padding`, `border-radius`, `background-color`) plus its line box. The two classes share
no property, which is why their order in `classes.ts` does not matter.

### `line-height:normal` is a lookup table, not a ratio
Every element this page owns states the design's own line box locally (the kit's `1.2em` is still
open — see the For families section). Deriving those from a ratio does not work: Chrome's `normal` for
both webfonts is neither 1.2 nor 1.25 uniformly. Measured in the design at 1280 — Inter: 11px->14,
12px->15, 13px->16, 14px->17, 15px->19, 16px->20, 18px->24; Hanken Grotesk: 17px->22, 21px->27,
22px->29. These agree with every constant the earlier pages measured one at a time (`EYEBROW_LH` 15,
`H3_LH` 27, `BTN_LH` 20, `h3-22` 29, `row-dark-title` 22, `row-lbl` 19, `num-light` 16, `pill-nav` 17).

**Measurement trap, and it cost two wrong tables**: a probe that measures a page inside an iframe must
wait for `iframe.contentDocument.fonts.ready`, not just `load` plus a timeout. Without it the page lays
out in the fallback sans and every derived line box is wrong by 1-3px in an inconsistent direction — it
reported 21px Hanken as 25px (it is 27) and 16px Inter as 18px (it is 20), which reads exactly like a
real fidelity bug rather than an unloaded font. Confirm by having the probe report the loaded font list.

### Three headings opt out of balanced wrapping
The design sets `text-wrap:initial` on the "For families" h2 and the "Notification" h2-sm, and the
final-CTA h2 carries no class at all (so no balance either); the theme applies `text-wrap:balance` to
`.h1`/`.h2`/`.h2-light`/`.h2-sm`/`.h2-cta`. Those three headings therefore cannot carry the class and
state the same declarations in local css instead (`H2_UNBALANCED` / `H2_SM_UNBALANCED` /
`H2_CTA_UNBALANCED` in the recipe) — the same move as the safety page's "What we never do" heading.
Only the navy panel's h2 (`h2-light`) and the hero h1 stay balanced, which is what the design does.
The CTA h2 also needed its own size: `h2-cta` is `clamp(32px,4.2vw,52px)`, this design
`clamp(32px,4vw,48px)`.

### The section padding sits one level lower than the design
The design puts the section padding on `<section class="band">` / `<section class="cta band-top">` and
leaves the inner column unpadded; the recipe puts `sec` (or an explicit padding) on the inner element,
exactly as Home and the safety page do, because `wrap`'s max-width has to sit on the same box. The
section's own bounding rect matches the design to within a pixel at every width, and so does every
element inside it — only the two intermediate boxes report the padding on different rows of the diff.

### French copy
Written from the terminology already in `content/home.ts` / `content/footer.ts`: "garderie",
"jumelage garderie" (the footer's own label), "aide familiale", "code postal", "courriel", "séance",
"LPRPDE", "entente". "Register interest" is "Inscrire mon intérêt", "I run a daycare" is
"Je gère une garderie", "List an opening" is "Inscrire une place". The time on the notification card
uses the Canadian French form "9 h 12". Like the safety page and unlike For helpers, this page needs no
U+00A0: it has no `$`, no `%` and no guillemets, and the repo's existing French puts an ordinary space
before a colon and none before `?`/`!`. Checked at 390 and 1280 in the headless render — nothing wraps
badly, and live EN vs live FR differs in no non-text-metric property at any of the four widths.

### Named deviations (this page)
- The hero's "I run a daycare" button is inert (`#`). The design anchors it at `#daycares`; a V4
  atomic element renders no `id`, so there is nothing to anchor to. Same as the For families, For
  helpers and Safety & trust hero secondary CTAs.
- The notification card's "Contact the daycare" button is inert (`#`), exactly as in the design.
- The hero video has no poster (`video()` takes a media-library key; the design's poster is a
  hotlinked Pexels still). Same as Home and For helpers.
- The notification chip's bell uses the shared `anim-wiggle` (3s, `transform-origin:left center`)
  where the design animates it at 1.2s from `top center`. `animation-*` is rejected by the converter,
  so motion can only come from an `anim-*` class; adding a fourth wiggle variant to the theme for one
  decorative icon was not worth it.
- The design's `.btn-outline-14` (`.btn-outline` with 14px 24px padding) and the notification card's
  pill button are each used once, so both are local overrides rather than global classes — the same
  call the safety page made for `.eyebrow-dark`.
- The hero's tint backdrop sits on `media-box` (which also carries the radius, overflow and shadow)
  where the design splits it across an outer wrapper and an inner `.media`. Identical rendering; the
  video covers it either way.
- Icons are `<svg>` where the design uses Line Awesome `<i>` glyphs, so `font-*` on them differs by
  construction. The one measurable consequence: the notification card's three 18px icons are 18x18
  against the design's 18x19 inline line box (same drawn glyph). Same bucket as the safety page's ticks.
- The shared `btn-primary` carries `mobile:"padding:14px 24px"`, which the design has no equivalent
  for (it keeps 16px 30px at every width). Identical on Home, For helpers and Safety & trust; left
  alone rather than overridden on one page. This is the ONLY measured difference at 390.

### Verification (skill step 4)
74 matched selector pairs, computed styles plus bounding rects, design-vs-live at 1280, 1440, 1920 and
390, measured inside a fixed-width same-origin iframe (Chrome headless clamps `--window-size` to ~500px;
the live page is measured from a `curl`ed copy served beside the design, which works because WordPress
emits absolute asset URLs). **Zero unexplained differences at 1280, 1440 and 1920**; at 390 only the
shared `btn-primary` mobile padding. Every other difference is bucketed with a stated reason (kit font
stack and kit line-height, `.e-con` base `position`/`min-height`, `wrap`'s max-width, the e-button base
`text-align`, `anim-*`/interaction transforms sampled mid-flight, the eyebrow's flex-row-plus-gap markup
and the svg-vs-glyph icons). `documentElement.scrollWidth > clientWidth` is false at all four widths on
the design and on BOTH languages, and no element is wider than the viewport at 390 on any of the three.
Live EN was additionally diffed against live FR at 1280, 1440, 1920 and 390: zero differences in every
property outside the text-metric set (widths, heights, transforms). `render.sh` slices (desktop and
mobile, en and fr) match the design's slices section by section.

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
- 2026-09-22: two new theme CSS exceptions, both for properties the 4.2.4 converter cannot express at
  all: `.em-navy strong{color:var(--navy)}` (html-v3 strips attributes, so an inline `<strong>` is
  styled through a class on its parent, exactly like `hl-wavy em`/`em-accent em`) and
  `.faq-question{white-space:normal}` (see pitfalls.md). Theme `Version` bumped to 1.0.4.
- 2026-09-22: one more theme CSS exception, same mechanism as `em-navy`: `.em-ink strong{color:var(--ink)}`,
  for the safety page's "What it is." / "Why we ask." lead-ins, whose design rule is an inline
  `<strong style="color:#001E30">` (the body ink, not em-navy's #1A3375). Theme `Version` bumped to 1.0.6,
  so that deploy had to re-run bootstrap's theme-copy step.
- 2026-09-22: the FAQ `+`/`−` glyph swap is done with three more anim.css rules over both icons'
  `faq-icon-plus`/`faq-icon-minus` classes rather than by teaching `faq.js` to rewrite SVG markup, so
  the script stays a pure class toggle. Theme `Version` bumped to 1.0.5.
- 2026-09-22: one more theme CSS exception, same mechanism as `em-navy`/`em-ink`: `.link-light a{color:var(--white);font-weight:600}`, for the daycare page's `support@poppynz.com` sitting inline at the end of light-on-navy body copy. html-v3 keeps `a[href]` but strips every attribute, so the link cannot carry a class, and the kit's own link colour (navy) is unreadable there. Theme `Version` bumped to 1.0.7, so that deploy had to re-run bootstrap's theme-copy step.
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

Expected, not a bug (as of 2026-09-21): every nav and footer link except Home 404s — For families, For helpers, Safety & trust, Daycare, Blog and the three legal pages are Plan 2. All of them, Blog included, are live now. A 404 with the Poppynz header on it means the link works and the page does not exist yet.

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

## 2026-09-22 — Privacy Policy, Terms of Service, Service Agreement (Plan 2, fifth/sixth/seventh pages)

Live: EN 821 `/privacy-policy/`, 831 `/terms-of-service/`, 799 `/service-agreement/`; FR
`/fr/politique-de-confidentialite/`, `/fr/conditions-d-utilisation/`, `/fr/entente-de-service/`.
All six 200, `has_header:true`, `lang` `en-CA` / `fr-CA`. Second `import.php` run after the deploy:
56 media, 30 variables, 199 classes, 4 templates, 16 pages — every entry `unchanged`, no slug work.
Every earlier page's `pages/*.json` and every `templates/*.json` is byte-identical to before these
pages existed (`git diff --stat` lists none of them); the artefact churn is 21 new labels in
`classes.json` (151 added lines, 0 removed), 1 new media file (`check-solid.svg`) and the six new
page files. No existing class was edited and no new variable was needed.

### One recipe, three documents
`recipes/legal.ts` exports `legalRecipe(doc: LegalDocKey)`, and `cli.ts` registers
`legalRecipe("privacy")`, `legalRecipe("terms")`, `legalRecipe("agreement")`. All three designs are
the same page with different copy — navy hero with the three-way tab switcher, sticky `legal-toc`,
a column of numbered `legal-sec` blocks, closing contact card — so the recipe takes the document as
data and `content/legal.ts` holds it: `{ title, intro, note, sections[] }` per document per
language, where a section is `{ n, title, lead?, subs?, items?, tail? }`. The TOC, the tab labels
and the anchor ids are all derived from that, so nothing is stated twice. `n` is `null` for a
section the design leaves unnumbered.

### Anchors work: `_cssid`, not the class list
The four earlier pages each recorded "a V4 atomic element renders no `id`, so the hero's secondary
CTA is inert" as a named deviation. That is wrong. Elementor's atomic elements have a `_cssid`
setting (the editor's "ID" control) which every element type renders as a real `id` attribute —
confirmed on 4.2.4 for `e-flexbox`, `e-div-block`, `e-grid` and `e-heading`. `dsl.ts` now takes
`cssId` on any element. Each `legal-sec` carries `s1`..`sN` by position, `scroll-margin-top:100px`
converts, and the jump was measured on all six pages: every TOC link lands its section at exactly
`top: 100px`, clear of the 70px sticky header, in both languages — identical to the design (100,
100, 99.5, 100.1). **The four inert hero buttons on For families / For helpers / Safety & trust /
Daycare matching can be fixed the same way whenever someone re-verifies those pages.**

The design's own Privacy Policy gives its last two sections the SAME `id="s10"` and points both TOC
links at `#s10`, so "Key Considerations for Canadian Privacy" jumps to "Contact Us". Ours numbers
anchors by position, so that section is `s11` and its link reaches it. Deliberate fix of a design
bug; no visible numbering changed (the section stays unnumbered).

### The WordPress draft Privacy Policy squats `/privacy-policy/`
WordPress auto-creates a **draft** page titled "Privacy Policy" with slug `privacy-policy` on every
install (here post 3, also `wp_page_for_privacy_policy`). `import.php` looked pages up by slug AND
language; the draft has no Polylang language, so the lookup missed it, `wp_insert_post()` silently
fell back to `privacy-policy-2`, and every link built from `PAGES.privacy.slug` pointed at a page
that did not exist. This would have hit production identically. Fixed in `import.php` step 5:
- pages are found by a new `_poppynz_page` marker meta first (it survives a slug WordPress had to
  uniquify), falling back to the slug lookup for pages imported before the marker;
- the wanted slug is freed from a page that is not ours — but only an **unpublished** page with no
  `_elementor_data`, and only by renaming it to `<slug>-wp-default`, never deleting. A published
  page keeps its slug and the report shows the uniquified URL, which is the visible, safe failure;
- a found page whose `post_name` has drifted is corrected back to the artefact's slug;
- step 7 points `wp_page_for_privacy_policy` at the real policy.
On staging post 3 is now `privacy-policy-wp-default` (still a draft, still present) and 821 is
`/privacy-policy/`. Post 2 "Sample Page" was not touched.

### The sticky TOC's responsive reset
The design drops `.legal-toc` back to `position:static` at `<=860px`, which is not one of Elementor's
breakpoints (desktop / tablet `<=1024` / mobile `<=767`). `tablet` is used. The band 912–1024px is
therefore a named deviation (two-column, but static where the design is sticky); `tablet` is the
right choice rather than `mobile` because a stacked-and-sticky TOC travels down over the article —
a sticky flex item's containing block is the whole flex container — and the design itself does that
between 861px and ~912px, where ours does not. Also: the design's reset is `max-width:none;
max-height:none`, and no size property converts a keyword, so the class uses `max-width:100%` and
`max-height:100000px` (identical in effect; no measured rect difference at 390).

### New global classes (21)
`legal-tab-on`, `legal-tab`, `legal-tabs`, `legal-body`, `legal-toc`, `toc-link`, `toc-num`,
`legal-article`, `legal-sec`, `legal-head`, `legal-num`, `legal-h2`, `legal-h3`, `legal-p`,
`legal-tail`, `legal-sub`, `legal-list`, `legal-li`, `legal-tick`, `legal-contact`,
`legal-contact-btn`. `legal-tab-on` is declared before `legal-tab` (reversed print order). Reused
unchanged: `navy`, `wrap`, `eyebrow-light`, `dash`, `lead-light`, `note-light`, `label`, `body-15`.
The two one-off icon sizes (16px calendar, 14px envelope) are local css, not classes.

### Line boxes measured in the design at 1280 (the kit's `1.2em` is still open)
Hanken Grotesk: 16px->21, 17->22, 20->26, 21->27, 22->29, 24->31, 36->47, 56->73.
Inter: 11->14, 12->15, 13->16, 14->17, 15->19, 16->20, 17->20, 18->21.
These extend the table in the daycare section; 16px Hanken (`legal-num`) and 16px/700 Inter
(`legal-h3`) are new.

### French copy
Terminology from `content/home.ts` / `content/footer.ts`: "aide familiale", "garderie", "séance",
"code postal", "courriel", "LPRPDE" for PIPEDA, "renseignements personnels", "Plateforme". Defined
legal terms use guillemets with U+00A0 inside (`« la Plateforme »`), and `15 %` / `5 %` take a
U+00A0 before the sign — same rule as `content/helpers.ts`. Checked in the headless render at 390
and 1280: nothing wraps badly and no guillemet or percent sign is orphaned.

### Named deviations (these pages)
- The TOC is static rather than sticky between ~912px and 1024px (breakpoint, above).
- `max-width:100%` / `max-height:100000px` stand in for the design's `none` (no keyword converts).
- In-page jumps are animated, not instant: Elementor's `frontend.min.css` sets
  `html{scroll-behavior:smooth}` site-wide and the design sets none. Pre-existing, every page.
- Icons are `<svg>` where the design uses Line Awesome `<i>` glyphs, so `font-*` differs by
  construction; the 18px check tick is 18x18 against the design's 18x22.4 inline line box.
- The eyebrow is a flex row with `gap:10px` where the design is a block `<p>` with an inline-block
  dash carrying `margin-right:10px`. Same 15px line box, same 22x2 dash. Identical on every page.
- `e-button` base `text-align:center` on the three tab pills, where the design inherits `start`.
  Both shrink-wrap, so no measured difference.

### Verification (skill step 4)
26–34 matched selector pairs per document, computed styles plus bounding rects, design-vs-live at
1280, 1440, 1920 and 390 for the Privacy Policy and at 1280 and 390 for all six pages, measured
from a `curl`ed copy of each live page served beside the design. **Zero unexplained differences on
all six pages at every width**; every remaining difference is bucketed with a stated reason (the
kit font stack and em line-height, Elementor's `.e-con` base `position`/`min-width`, and the
by-construction items listed above). `documentElement.scrollWidth > clientWidth` is false at every
width on the design and on both languages, and no element is wider than the viewport. Measuring
caught one real miss: `legal-tail` had dropped the `max-width:78ch` that the design's `p.tail`
inherits from `.legal-sec p` (805.59px at 1280) — fixed and re-imported. `render.sh` slices were
captured for all six pages at desktop and mobile; the ones read against the design's own slices
were privacy-en d0 and m1, agreement-en d1, agreement-fr d0 and terms-fr m0 — a sample covering
all three documents, both languages and both widths, and each matched section by section. The
numeric pass above is what covers the rest.

Editor check: all 199 classes present in BOTH the frontend and preview contexts, with identical
stored props; the saved `_elementor_data` references classes by global-class **id** with zero raw
label leaks (173/205/123 id references) and carries exactly 11/17/8 `_cssid` values; the compiled
`global-821-frontend-desktop.css` contains real `.legal-sec{…}` / `.legal-toc{…}` rules including
`sticky` and `scroll-margin-top`, and the tablet bundle contains the `static` reset; the canvas
renders the sections with the right ids and no "classes are missing" warning. Update/Publish never
pressed. **Not fully checked visually**: the Browser pane was hidden for this pass (it reports
`clientWidth: 0`, which suppresses scrolling and returns blank screenshots), so the canvas was read
through the DOM rather than looked at. While doing so, container classes in the canvas showed no
`background-color` and no `border-width`/`border-color` — but this reproduces on the already-live
Daycare matching page with the shared `band` and `navy` classes, the stored props are correct and
identical in both contexts, and the frontend is correct by measurement, so it is pre-existing and
most likely an artefact of driving the editor at zero width. Worth a look by someone with the pane
open.

## 2026-09-22 — Blog (spec § 8: NOT an Elementor page)

Live: index EN `/blog/` (page 1020, `page_for_posts`), FR `/fr/blogue/` (page 1021); eight articles published in English
under `/blog/<slug>/`, eight French translations imported as **drafts** and linked to their English
originals through Polylang. Two consecutive `import.php` runs report all **327** entries `unchanged`;
`verify.php` returns 200 with `has_header`, `has_footer` and the right `lang` for all 27 public URLs.
No `pages/*.json` or `templates/*.json` changed (`git diff --stat` lists only `manifest.json` and
`variables.json`), so every Elementor page renders exactly as before.

### Why this one is different
The index and the article layout are child-theme templates — `theme/poppynz/home.php` and
`single.php`, sharing `theme/poppynz/inc/blog.php` — and the articles are native WordPress posts.
There is no recipe, no element tree and no global class involved, so none of the V4 converter rules
apply to it. What still comes from the artefact is the content: `blog/strings.<lang>.json` (index
headings, article labels, newsletter card, the two side cards) and `blog/posts/<key>.<lang>.json`
(one post each, body included). `import.php` writes the chrome to the `poppynz_blog_strings` option
and everything else to post meta, so the templates hard-code no copy. There is no editor check for
this page: nothing about it opens in the Elementor editor.

### Styling: `assets/blog.css`, scoped to `.pz-blog`
Elementor's global classes are printed per Elementor document, so they do not exist on these
templates; `assets/blog.css` carries the design's own CSS instead. It declares the `tokens.ts`
values itself on `.pz-blog` (so the blog does not depend on the kit having printed its `:root`
block) and `builder/src/theme.test.ts` fails if any token drifts, if the file introduces a colour
that is not a token, or if any selector is left unscoped. Two new tokens were needed for colours the
design uses and `tokens.ts` did not have: `ink-2` `#1D2A3A` (the long-form prose ink) and `danger-2`
`#B3261E` (the "not enough" / "not included" red).

`.pz-blog { line-height: normal }` is what keeps the kit's `1.2em` body line-height (still open, see
the For families section above) out of the blog: every element inside resolves `normal` against its
own font-size, exactly as the design does. Measured: identical line boxes on both sides everywhere.

### Article URLs need `/blog/%postname%/`
`bootstrap.php` used to set `permalink_structure` to `/%postname%/`. That cannot work here: with a
bare post permastruct WordPress uses verbose page rules and resolves a single-segment request
against pages first, so the `daycare-matching` **article** would be shadowed forever by the Daycare
matching **page** of the same slug. It is now `/blog/%postname%/`, which also matches the design's
own links. Pages are unaffected (they keep their hierarchical paths).

**Set it through `$wp_rewrite->set_permalink_structure()`, not `update_option()`.** `update_option`
leaves `$wp_rewrite` holding the previous structure for the rest of the request, so the
`flush_rewrite_rules()` that follows regenerates the OLD rules — seven of the eight article URLs
404'd after the first deploy, and the eighth (`/blog/daycare-matching/`) returned a misleading 200
because the page+attachment rule matched `pagename=blog`.

### A card is one big `<a>`, so nothing inside it may be a link
The index and "Keep reading" cards wrap the picture and the body in a single `<a>`. The photo credit
overlay contains Unsplash attribution links, and an `<a>` inside an `<a>` is not parseable: the
browser closes the card link at the credit and lifts the picture and body out of it, which flattened
every card into loose grid items (each card rendered as an empty box + image + text across three
columns). The design writes the card credits as plain text for exactly this reason, so `hero` now
carries both `credit` (linked, for the article hero, which is not inside a link) and `creditText`
(plain, for cards); `poppynz_blog_figure()` takes a `$linked` flag and defaults to the plain one.

### A draft keeps its date only with `edit_date`
The French articles are drafts. WordPress leaves a draft's `post_date_gmt` at `0000-00-00 00:00:00`
and then treats the date as "not chosen yet", resetting `post_date` to the current time on every
save — so all eight French posts reported `updated` on every import. Fixed by passing an explicit
`post_date_gmt` and `edit_date => true` on both insert and update.

### Other things worth knowing
- `.tag` means two different things in the two designs (the index's filter pill, and a bare
  icon + label inside an article's levels card). One stylesheet serves both pages, so the index's
  pill is scoped to `.tag-row .tag`; without that it leaked into `.level .tag` and drew a border
  around the "Required by Poppynz" labels.
- Article bodies are complete HTML from the artefact, so `functions.php` removes `wpautop` for posts
  carrying the `_poppynz_post` marker. No other post is affected.
- `{{page:<key>}}` and `{{app:<key>}}` in blog copy resolve at build time (`resolveBlogLinks()`);
  `{{post:<key>}}` resolves in `import.php`, after the posts exist, via `get_sample_permalink()` so
  that a draft gets its real future URL instead of `?p=<id>`.
- WordPress's own "Hello world!" sample post was published and dated later than every article, so it
  would have taken the featured slot. `import.php` demotes it to draft (never deletes it) and only
  when it is recognisably the untouched sample.
- Line Awesome is enqueued from the jsDelivr CDN on blog templates only — the design's own link.
  Elementor pages keep drawing their icons as `e-svg` widgets built from the `line-awesome` package.

### Named deviations (the blog)
- **"Load more articles" is not drawn.** The design always shows it; here it renders only when there
  is a next page of posts, and with eight articles and ten per page there is none. This is the only
  measured difference on the index: the body is 87px shorter at 1280 and 72px at 390.
- **The index filter row and the article tag pills are inert** (`href="#"` and a link back to the
  index), exactly as in the design. Making them live would need category archives, which are not in
  this scope. The search box and the newsletter field are no longer inert — see § Forms below.
- **The French index lists no articles**, because every French article is a draft by request. The
  chrome, filters and newsletter card are all French and correct; cards appear when the drafts are
  published.
- **The byline avatar stays a 44px circle at 390** where the design squashes it to 43.1×44 (the
  design's `.avatar` has no `flex:none` and shrinks as a flex item). Ours keeps the circle; 0.9px.
- The article's `<img>` elements carry `max-width:100%` from the blog stylesheet's reset, which the
  design does not set. Measured identical on both sides at every width, including the bell.

### Verification (skill step 4)
Computed styles and bounding rects, design-vs-live, at 1280 and 390, through two browser tabs at the
same viewport: **41 selectors on the index and 53 on the article.** Index at 1280: every selector
identical bar the load-more difference above; the kit's `Inter, sans-serif` and `19.2px` line-height
appear on `<body>` only and never reach anything inside `.pz-blog`. Index at 390: every selector
identical. Article at 1280: all 53 identical, and the 10px body-height difference is entirely the
pre-existing HFE footer (441px design vs 451px live; the header is 70px and the first section starts
at y=84 on both). Article at 390: 52 of 53 identical, the exception being the avatar noted above.
`document.documentElement.scrollWidth > clientWidth` is false on both sides at both widths.
`render.sh` slices of `/blog/`, `/fr/blogue/` and `/blog/vulnerable-sector-check/` were read beside
the `dump_design.sh` slices and match section by section.

## 2026-09-22 — the two real forms (search, newsletter)

The design draws both as decorative placeholders — a grey `<span>` inside `<form onsubmit="return
false">`. Both are now real. They are the only input-looking elements on the whole site: the
Elementor pages have none, and the two other bordered, field-like things are not fields (`.rate` is
a helper's hourly rate in the For-helpers profile mock, `.lang` is the working EN/FR switcher).

### Search (`search.php`)
A real GET form posting `s` and `post_type=post` to the current language's `home_url()`, so a French
search stays French. `search.php` reuses the index layout — same header block, card grid and
newsletter — with the query in the heading and kept in the field, a "Back to all articles" link and
an empty state. `functions.php` forces `post_type=post` on every front-end search through
`pre_get_posts`, so a hand-typed `/?s=` cannot return a page that lacks the meta the cards need.

Measured against the design at 1280 the box is unchanged: container 320x48 at the same x, icon 20x20
at the same x, placeholder starting at the same x in the same 15px Inter `#757681`. The only
difference is the text element's width (260px vs the design's 105.7px) because an input fills the
row so it can be typed into, where the design's span shrink-wraps its label.

### Newsletter (`poppynz_handle_newsletter()`)
Posts same-origin to `admin-post.php`, which hands the address to the app as
`{"email":"..."}` at `https://app.<host>/api/v1/newsletter`. The host comes from the new
`poppynz_app_host()`, shared with the `/app` redirect, so the same artefact reaches
`app.staging.poppynz.com` and `app.poppynz.com` with no configuration.

**Server side, not from the browser, on purpose.** A `fetch()` from the page would be cross-origin
with a JSON content type, so it would need a CORS preflight and matching headers on the app; from
PHP there is no origin to check and the endpoint needs no CORS configuration at all.

**Fire and forget** (`blocking => false`): nothing is stored on this site and nothing waits for a
response — so a failing endpoint cannot be detected here and the visitor is thanked regardless. A
nonce and a honeypot guard the handler. The result returns as `?newsletter=ok|invalid|error` on the
page the visitor was on (so a refresh cannot resubmit) and is announced in a live region that is
rendered **only when there is a message** — an empty `<p>` still takes a line box and made the card
taller than the design until that was fixed.

If a page cache is ever added in front of this site, the nonce is the thing that will break first:
a cached page serves a stale nonce and every submission lands on `error`. The honeypot alone would
survive caching.

**Open, on the app's side:** `POST https://app.staging.poppynz.com/api/v1/newsletter` returned 404
when this was built, so the route was not deployed on staging yet. Everything on the WordPress side
is verified; the hand-off itself is unproven until that route exists.
