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

Second `import.php` run after the fixes below is all `unchanged` (media, variables, 127 classes, 4 templates, 2 pages). `verify.php`: `/` and `/fr/` both 200, `has_header: true`, `lang` `en-CA` / `fr-CA`.

### Named deviations (acceptable, not bugs)
- Hero video poster not set (video plays directly; the design's static poster frame is a cosmetic nicety, not present in the artefact's recipe).
- Google Fonts (Hanken Grotesk, Inter) load asynchronously like any real browser render, so the very first paint briefly shows fallback fonts — not visible in the final `render.sh` slices, which wait for network idle.
- `deco`'s decorative hero dots/ring/icons no longer carry `pointer-events:none` (Elementor 4.2.4's converter cannot express that property at all, and Free strips it as customCss anyway); they sit at `z-index:0` under the real content's `z-index:1`, so this has no visible or practical effect.
- Header wraps to two lines on the French homepage at 1280px (nav + lang/sign-in/CTA don't fit on one line because the French strings — "Sécurité et confiance", "Devenir aide familiale" — are longer than their English equivalents); this is ordinary `flex-wrap` responding to real content width, not a bug, and it still reads correctly.

No layout differences that make a section unrecognisable remain: header, hero, "How it works", "Two-way safety", service cards (with correct pink/blue alternation), testimonials, neighbourhood, "Become a helper", final CTA and footer all match the design section by section on desktop; mobile is single-column throughout with the header wrapping as expected.

## Deploy
1. `cd apps/landing-page/builder && bun test && bun run build`; commit `json-artefacts/current`.
2. `bash .claude/skills/elementor-v4-port/scripts/pack.sh current`
3. `novamira/create-upload-link` {"path":"wp-content/novamira-sandbox/poppynz-artefact.zip","overwrite":true} on the target server, then `push.sh <zip> <token> <site url>`.
4. `execute-php`: `server/unpack.php`; first time only `server/bootstrap.php` (twice on a bare site); production only `server/snapshot.php`; then `server/import.php`; then `server/verify.php`. **If this deploy changed anything under `theme/poppynz/` (e.g. `anim.css`), re-run bootstrap's theme-copy step (its step 2) even on a non-first deploy** — `import.php` never touches theme files, only `unpack.php`'s zip extraction plus that copy step do, and skipping it silently leaves the live theme file stale while everything else (classes, pages) updates correctly. Then bypass the CSS file's own browser cache when verifying — see pitfalls.md ("`anim.css`...enqueued with a STATIC version string").
5. `render.sh <url> wp-<key>` and compare with `dump_design.sh` slices.

## Editor check
`novamira/create-admin-access-link` with `admin_path=post.php?post=<id>&action=elementor`, exchange the token with the returned curl example, open `login_url` in the built-in browser within 60 s. Select an element, Style tab: the class chips must show the expected labels and the Spacing/Typography sections the converted values. Do not press Publish (except for the single deliberate round-trip test in Task 14, immediately reverted by re-running `import.php`). If every element shows only the `local` chip plus a "Some classes are missing" warning and the canvas looks unstyled, `import.php` hasn't synced the PREVIEW context yet — see pitfalls.md.

## Decisions log
- 2026-09-21: Connect Polylang for Elementor dropped; `hfe_render_template_id` filter in the child theme instead.
- 2026-09-21: FAQ = flexbox items + theme `faq.js` (no accordion in Free 4.2.4).
- 2026-09-21 (Task 14): `import.php` fixed in six places found only by deploying for real — see pitfalls.md for each: (1) `pll_set_post_language()` missing for `elementor-hf` templates, duplicating the fr header/footer on every run; (2) `foreach ($el['styles'] ?? [] as &$style)` silently never applied local per-element CSS anywhere on the site; (3) elements referenced global classes by label, not id, so no class's CSS was ever bundled for any document (the whole site rendered unstyled); (4) global-class print order is reversed by Elementor, so a same-element modifier class (`svc-pink`, `lang-on`, `bubble-40`/`bubble-48`) needs to sort *before* its base class in `classes.ts`; (5) the order-merge logic only ever appended new ids, so re-ordering an existing class in `classes.ts` had no effect until fixed to treat `classes.json` as authoritative; (6) `Global_Classes_Repository::put()` only wrote the frontend context, leaving the editor's own preview context empty forever, so opening the editor on any imported page showed every class as "missing" and rendered the canvas unstyled — fixed by also calling `put()` with `set_preview(true)`. Also fixed six CSS-conversion rejections in `classes.ts` (two-value `gap`, `pointer-events`, decimal `opacity`, `flex-grow`/`flex-shrink` longhands, unitless `rotate(0)`, per-side `border-*-style`) and one systemic layout bug (Elementor's `.e-con{width:100%}` breaks any flex-row with unsized children) fixed once in the theme's `anim.css`.
