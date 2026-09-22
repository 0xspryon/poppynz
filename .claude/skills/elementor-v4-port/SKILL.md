---
name: elementor-v4-port
description: Build, import and verify Poppynz marketing pages as editable Elementor V4 (atomic) pages from the TypeScript builder in apps/landing-page, deploying the same artefact to staging and production through Novamira. Use whenever a landing/marketing page, header, footer or global class of poppynz.com must be built, changed, re-imported, compared with the design, or deployed.
---

# Elementor V4 port (Poppynz)

Read `references/poppynz.md` (site profile: MCP servers, versions, page map, what is live) and
`references/pitfalls.md` first. The spec is `docs/superpowers/specs/2026-09-21-elementor-v4-landing-harness-design.md`.

## Loop for a page

1. Render the design: `bash .claude/skills/elementor-v4-port/scripts/dump_design.sh "<page>.html" <key>`; Read the slices. To measure the design live (not just look at it), serve it first: `preview_start {name:"design"}` (launch.json, port 5198). It MUST be served over HTTP — opening `apps/landing-page/design/index.html` as a `file://` URL renders unstyled, because the page links `/css/site.css` by absolute path.
2. Content in `apps/landing-page/builder/src/content/<key>.ts` (en + fr), recipe in `recipes/<key>.ts`, register it in `cli.ts` `RECIPES`. Reuse classes from `classes.ts`; add a class only when two elements share it. `bun test && bun run typecheck && bun run build`.
3. Pack and push: `pack.sh current`, ability `novamira/create-upload-link` (`wp-content/novamira-sandbox/poppynz-artefact.zip`, overwrite), `push.sh` (export `NOVAMIRA_UPLOAD_TOKEN` and omit the token argument so it doesn't land in shell history), then `server/unpack.php` and `server/import.php` through `novamira/execute-php`. Invoke them as `$r = require WP_CONTENT_DIR . '/novamira-sandbox/artefact/server/import.php'; return $r;` rather than pasting the file body (see pitfalls.md § Environment; one script per request). The import aborts with the exact CSS declaration when something would be dropped: fix the CSS, rebuild, push again. Before guessing whether a declaration converts, ask the site: `require .../lib.php; return pz_converter()->convert('<css>');` — one call, versus a whole pack/push/import cycle per guess.
4. Verify. Screenshots alone are not a comparison — a whole-page render at the wrong body colour, with pink links and blue outline buttons, passed an eyeball "section by section" check here and the owner caught all of it. Do both:
   - **Measure.** Open the design (port 5198) and the WordPress page in two tabs at the same width and diff `getComputedStyle` for the same selectors: `body` (background, color, font-family, line-height), then per section the background, color, font-size/weight, border widths, padding, `justify-content`/`align-items`, and each element's `getBoundingClientRect`. Colour, alignment, wrap points and borders are exactly what the eye skips. Repeat at 1280, 1440, 1920 and 390, and check `document.documentElement.scrollWidth > clientWidth` for overflow at each.
   - **Look.** `render.sh <url> wp-<key>` and Read the slices beside the design's. Use the headless renders for anything visual: the Browser pane does not reliably scroll the staging page (screenshots keep showing the hero), and it returns blank images while hidden.
   Then `server/verify.php` and the editor check (`references/poppynz.md` § Editor check). Never press Update or Publish.
5. Commit builder changes and `json-artefacts/current` together. Record new IDs or decisions in `references/poppynz.md`.

## Rules

- No Pro features. Only V4 elements: `e-flexbox`, `e-div-block`, `e-grid`, `e-heading`, `e-paragraph`, `e-button`, `e-image`, `e-svg`, `e-self-hosted-video`.
- Styling only through `classes.ts` (global) or the `css:` map of an element (local). Keyframes only in the theme, via `anim-*` classes.
- CSS is flat declarations per breakpoint/state key. The builder lint and the importer enforce `references/css-cheatsheet.md`.
- Text through `html-v3`: inline tags only, no attributes except `a[href]`. Emphasis is `<em>` styled by the parent's class (`hl-wavy`, `em-accent`).
- Every element has an editor title. Links use `page:<key>` or an absolute URL.
- Deploy sequence and both sites: `references/poppynz.md` § Deploy.
