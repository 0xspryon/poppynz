# Poppynz site profile

## Sites
| Site | URL | Novamira MCP server | Status |
|---|---|---|---|
| Staging | https://staging.poppynz.com | `novamira-staging-poppynz` | bootstrapped 2026-09-21 (Elementor 4.2.4, Hello 3.5.1, HFE 2.9.4, Polylang 3.8.9, languages en/fr) |
| Production | https://poppynz.com | (to be added) | not deployed |

## Versions (pinned in server/bootstrap.php)
Elementor 4.2.4 · Hello Elementor 3.5.1 · Header & Footer Builder 2.9.4 · Polylang 3.8.9 · child theme `poppynz`.

## Page map
See `apps/landing-page/builder/src/pages.ts`. Built so far: header, footer, home (en, fr).

## Deploy
1. `cd apps/landing-page/builder && bun test && bun run build`; commit `json-artefacts/current`.
2. `bash .claude/skills/elementor-v4-port/scripts/pack.sh current`
3. `novamira/create-upload-link` {"path":"wp-content/novamira-sandbox/poppynz-artefact.zip","overwrite":true} on the target server, then `push.sh <zip> <token> <site url>`.
4. `execute-php`: `server/unpack.php`; first time only `server/bootstrap.php` (twice on a bare site); production only `server/snapshot.php`; then `server/import.php`; then `server/verify.php`.
5. `render.sh <url> wp-<key>` and compare with `dump_design.sh` slices.

## Editor check
`novamira/create-admin-access-link` with `admin_path=post.php?post=<id>&action=elementor`, exchange the token with the returned curl example, open `login_url` in the built-in browser within 60 s. Select an element, Style tab: the class chips must show the expected labels and the Spacing/Typography sections the converted values. Do not press Publish.

## Decisions log
- 2026-09-21: Connect Polylang for Elementor dropped; `hfe_render_template_id` filter in the child theme instead.
- 2026-09-21: FAQ = flexbox items + theme `faq.js` (no accordion in Free 4.2.4).
