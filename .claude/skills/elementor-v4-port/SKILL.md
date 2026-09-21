---
name: elementor-v4-port
description: Build, import and verify Poppynz marketing pages as editable Elementor V4 (atomic) pages from the TypeScript builder in apps/landing-page, deploying the same artefact to staging and production through Novamira. Use whenever a landing/marketing page, header, footer or global class of poppynz.com must be built, changed, re-imported, compared with the design, or deployed.
---

# Elementor V4 port (Poppynz)

Read `references/poppynz.md` (site profile: MCP servers, versions, page map, what is live) and
`references/pitfalls.md` first. The spec is `docs/superpowers/specs/2026-09-21-elementor-v4-landing-harness-design.md`.

## Loop for a page

1. Render the design: `bash .claude/skills/elementor-v4-port/scripts/dump_design.sh "<page>.html" <key>`; Read the slices.
2. Content in `apps/landing-page/builder/src/content/<key>.ts` (en + fr), recipe in `recipes/<key>.ts`, register it in `cli.ts` `RECIPES`. Reuse classes from `classes.ts`; add a class only when two elements share it. `bun test && bun run typecheck && bun run build`.
3. Pack and push: `pack.sh current`, ability `novamira/create-upload-link` (`wp-content/novamira-sandbox/poppynz-artefact.zip`, overwrite), `push.sh` (export `NOVAMIRA_UPLOAD_TOKEN` and omit the token argument so it doesn't land in shell history), then `server/unpack.php` and `server/import.php` through `novamira/execute-php` (first `<?php` line removed). The import aborts with the exact CSS declaration when something would be dropped: fix the CSS, rebuild, push again.
4. Verify: `server/verify.php`; `render.sh <url> wp-<key>`; compare slices with the design section by section, reading both as images. Then the editor check (`references/poppynz.md` § Editor check). Never press Update or Publish.
5. Commit builder changes and `json-artefacts/current` together. Record new IDs or decisions in `references/poppynz.md`.

## Rules

- No Pro features. Only V4 elements: `e-flexbox`, `e-div-block`, `e-grid`, `e-heading`, `e-paragraph`, `e-button`, `e-image`, `e-svg`, `e-self-hosted-video`.
- Styling only through `classes.ts` (global) or the `css:` map of an element (local). Keyframes only in the theme, via `anim-*` classes.
- CSS is flat declarations per breakpoint/state key. The builder lint and the importer enforce `references/css-cheatsheet.md`.
- Text through `html-v3`: inline tags only, no attributes except `a[href]`. Emphasis is `<em>` styled by the parent's class (`hl-wavy`, `em-accent`).
- Every element has an editor title. Links use `page:<key>` or an absolute URL.
- Deploy sequence and both sites: `references/poppynz.md` § Deploy.
