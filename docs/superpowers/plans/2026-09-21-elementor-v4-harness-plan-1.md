# Elementor V4 Landing Harness, Plan 1: foundation, header, footer, Home

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript builder that turns tokens, classes and page recipes into a site-agnostic Elementor V4 artefact, PHP scripts that import it through Novamira, a child theme, and the first deployed result on staging: header, footer and the Home page in English and French.

**Architecture:** `apps/landing-page/builder` (Bun + TypeScript) emits `apps/landing-page/json-artefacts/<build>/` with elements as V4 JSON and styles as CSS strings. `apps/landing-page/server/*.php` run through the Novamira `execute-php` ability, convert the CSS with Elementor's own `Css_Converter`, and save through Elementor's Document API. `apps/landing-page/theme` is a thin Hello Elementor child theme. Later plans add the remaining pages, blog templates and legal pages on the same harness.

**Tech Stack:** Bun 1.3 with `bun test`, TypeScript, Elementor 4.2.4 Free, Hello Elementor 3.5.1, Header & Footer Builder 2.9.4, Polylang 3.8.9, Novamira MCP (`mcp__novamira-staging-poppynz__*`), headless Chrome for renders.

**Spec:** `docs/superpowers/specs/2026-09-21-elementor-v4-landing-harness-design.md` (read section 0, the spike results, before any task).

## Global Constraints

- Elementor 4.2.4, Hello Elementor 3.5.1, Header & Footer Builder 2.9.4, Polylang 3.8.9, installed only from versioned wordpress.org zips (`https://downloads.wordpress.org/plugin/elementor.4.2.4.zip` and so on). No Pro features. No other plugins.
- Artefacts never contain a post ID, attachment ID, hostname or site URL. References go by slug plus language, media content hash, class or variable label, template title.
- Every visible value is a V4 control, a global variable or a global class. Hand CSS exists only in the child theme's `anim.css` (looping keyframes) and `faq.js`.
- CSS strings are flat declaration lists. Banned in CSS strings, enforced by the builder: `font`, `inset`, `text-wrap`, `text-underline-offset`, `animation`, `animation-*`, `transition` with an easing function. Breakpoint keys are `desktop`, `tablet`, `mobile`; state keys `hover`, `focus`, `active` appended as `desktop:hover`.
- Text props are `html-v3`. Inline tags allowed: `strong`, `em`, `b`, `i`, `u`, `s`, `span`, `a`, `br`. No attributes except `a[href]`.
- Container tags: `div, header, section, article, aside, footer, a, button`. Heading tags `h1..h6`. Paragraph tags `p, span`.
- Element ids are 7 lowercase hex characters, deterministic from the element's path. Local style ids are `e-<elementId>-<7hex>`. Global class ids are `g-<7hex>`; the HTML class name is the label.
- Two languages: `en` (locale `en_CA`, default, no URL prefix) and `fr` (locale `fr_CA`, prefix `/fr/`). Every page and template exists in both.
- All PHP for the server runs through `novamira/execute-php` with the leading `<?php` removed. Never modify the Novamira plugin or WordPress user 1's credentials.
- Never press Update or Publish in an Elementor editor tab except in the explicit round-trip check of Task 14.
- Commit after every task with a conventional message. Do not commit `node_modules`.
- Scratch files go to the session scratchpad directory, never into the repository.

## Out of scope for this plan

Pages other than Home (For families, For helpers, Safety, Daycare, Blog, legal), the blog child-theme templates `home.php` and `single.php`, blog post import, production deployment. Those are Plan 2 and Plan 3 on the same harness.

---

## File structure

```
apps/landing-page/
  design/                         existing static reference site, becomes tracked in Task 1
  builder/
    package.json                  bun scripts: build, check, test
    tsconfig.json
    src/
      cli.ts                      `bun run src/cli.ts build|check`
      ids.ts                      deterministic 7-hex ids
      css.ts                      CssMap type, lint, breakpoint/state key parsing
      props.ts                    typed setting helpers: str, html, classes, link, imageRef, svgRef, videoRef
      tokens.ts                   global variables (colors, fonts)
      classes.ts                  global classes as CssMap by label
      dsl.ts                      element constructors and Recipe type
      pages.ts                    page keys -> slug per language, link resolution
      media.ts                    media registry: file -> hash, icon lookup in line-awesome
      content/types.ts            Localized<T> helper and language list
      content/header.ts, footer.ts, home.ts
      recipes/header.ts, footer.ts, home.ts
      emit/artefact.ts            writes the artefact folder and manifest
    src/*.test.ts                 bun tests beside the modules
  json-artefacts/<build>/         committed output (Task 8 onward)
  server/
    lib.php                       shared helpers: converter, ids, media, report
    bootstrap.php
    import.php
    snapshot.php
    restore.php
    verify.php
  theme/poppynz/                  Hello Elementor child theme
    style.css, functions.php, assets/anim.css, assets/faq.js
.claude/skills/elementor-v4-port/
  SKILL.md
  references/v4-format.md, css-cheatsheet.md, pitfalls.md, worker-brief.md, poppynz.md
  scripts/dump_design.sh, render.sh, push.sh
.claude/agents/page-builder.md
```

---

### Task 1: Builder package scaffold and tracked design source

**Files:**
- Create: `apps/landing-page/builder/package.json`
- Create: `apps/landing-page/builder/tsconfig.json`
- Create: `apps/landing-page/builder/src/cli.ts`
- Create: `apps/landing-page/builder/src/cli.test.ts`
- Track: `apps/landing-page/design/**` (already on disk, untracked)

**Interfaces:**
- Produces: `bun run build` and `bun run check` entry points in `apps/landing-page/builder`; `runCli(argv: string[]): Promise<number>` in `cli.ts` that later tasks extend.

- [ ] **Step 1: Create the package**

`apps/landing-page/builder/package.json`:

```json
{
  "name": "landing-page-builder",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "bun run src/cli.ts build",
    "check": "bun run src/cli.ts check",
    "test": "bun test"
  },
  "dependencies": {
    "line-awesome": "1.3.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "5.9.3"
  }
}
```

`apps/landing-page/builder/tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "types": ["bun-types"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing CLI test**

`apps/landing-page/builder/src/cli.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { runCli } from "./cli";

describe("cli", () => {
  test("unknown command exits 2", async () => {
    expect(await runCli(["nope"])).toBe(2);
  });
  test("check with no recipes exits 0", async () => {
    expect(await runCli(["check"])).toBe(0);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run from `apps/landing-page/builder`: `bun install && bun test src/cli.test.ts`
Expected: FAIL, `Cannot find module "./cli"`.

- [ ] **Step 4: Implement the CLI skeleton**

`apps/landing-page/builder/src/cli.ts`:

```ts
export type Command = "build" | "check";

export async function runCli(argv: string[]): Promise<number> {
  const [cmd] = argv;
  if (cmd !== "build" && cmd !== "check") {
    console.error(`usage: bun run src/cli.ts build|check (got "${cmd ?? ""}")`);
    return 2;
  }
  // Later tasks register recipes here; with none registered both commands succeed.
  console.log(`${cmd}: nothing to do yet`);
  return 0;
}

if (import.meta.main) {
  process.exit(await runCli(process.argv.slice(2)));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/cli.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit, including the design source**

```bash
cd /run/media/hbt/work/poppynz/develop
git add apps/landing-page/design apps/landing-page/builder
git commit -m "feat(landing): scaffold Elementor V4 builder and track design source"
```

---

### Task 2: CSS map type and lint

**Files:**
- Create: `apps/landing-page/builder/src/css.ts`
- Create: `apps/landing-page/builder/src/css.test.ts`

**Interfaces:**
- Produces:
  - `type Breakpoint = "desktop" | "tablet" | "mobile"`
  - `type StateKey = "hover" | "focus" | "active"`
  - `type CssKey = Breakpoint | \`${Breakpoint}:${StateKey}\``
  - `type CssMap = Partial<Record<CssKey, string>>`
  - `parseCssKey(key: string): { breakpoint: Breakpoint; state: StateKey | null }` (throws on invalid key)
  - `lintCss(css: string): string[]` returns human-readable violations, empty when clean
  - `lintCssMap(map: CssMap, where: string): string[]` prefixes each violation with `where/key`
  - `normalizeCss(css: string): string` trims, collapses whitespace, ensures no trailing `;`

- [ ] **Step 1: Write the failing tests**

`apps/landing-page/builder/src/css.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { lintCss, lintCssMap, normalizeCss, parseCssKey } from "./css";

describe("parseCssKey", () => {
  test("desktop", () => expect(parseCssKey("desktop")).toEqual({ breakpoint: "desktop", state: null }));
  test("mobile hover", () => expect(parseCssKey("mobile:hover")).toEqual({ breakpoint: "mobile", state: "hover" }));
  test("rejects unknown", () => expect(() => parseCssKey("laptop")).toThrow(/breakpoint/));
  test("rejects unknown state", () => expect(() => parseCssKey("desktop:visited")).toThrow(/state/));
});

describe("lintCss", () => {
  test("clean css passes", () => {
    expect(lintCss("display:flex;gap:16px;color:var(--navy)")).toEqual([]);
  });
  test("font shorthand is banned", () => {
    expect(lintCss("font:600 16px Inter")).toEqual(["`font` shorthand is dropped by Elementor; use font-weight/font-size/font-family"]);
  });
  test("inset, text-wrap, text-underline-offset, animation are banned", () => {
    const out = lintCss("inset:0;text-wrap:balance;text-underline-offset:2px;animation:bob 2s;animation-delay:1s");
    expect(out).toHaveLength(5);
  });
  test("transition with easing is banned, plain transition passes", () => {
    expect(lintCss("transition:transform .25s cubic-bezier(.34,1.56,.64,1)")).toHaveLength(1);
    expect(lintCss("transition:transform .25s")).toEqual([]);
  });
  test("declarations without a colon are reported", () => {
    expect(lintCss("display flex")).toEqual(["`display flex` has no colon"]);
  });
});

describe("lintCssMap", () => {
  test("prefixes with location", () => {
    expect(lintCssMap({ desktop: "inset:0" }, "btn")).toEqual(["btn/desktop: `inset` shorthand is dropped by Elementor; use inset-block-start etc."]);
  });
});

describe("normalizeCss", () => {
  test("trims and drops trailing semicolon", () => {
    expect(normalizeCss("  display : flex ;\n gap:16px; ")).toBe("display:flex;gap:16px");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/css.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/landing-page/builder/src/css.ts`:

```ts
export type Breakpoint = "desktop" | "tablet" | "mobile";
export type StateKey = "hover" | "focus" | "active";
export type CssKey = Breakpoint | `${Breakpoint}:${StateKey}`;
export type CssMap = Partial<Record<CssKey, string>>;

const BREAKPOINTS: readonly Breakpoint[] = ["desktop", "tablet", "mobile"];
const STATES: readonly StateKey[] = ["hover", "focus", "active"];

export function parseCssKey(key: string): { breakpoint: Breakpoint; state: StateKey | null } {
  const [bp, state] = key.split(":");
  if (!BREAKPOINTS.includes(bp as Breakpoint)) throw new Error(`unknown breakpoint "${bp}" in "${key}"`);
  if (state !== undefined && !STATES.includes(state as StateKey)) throw new Error(`unknown state "${state}" in "${key}"`);
  return { breakpoint: bp as Breakpoint, state: (state as StateKey) ?? null };
}

const BANNED: Record<string, string> = {
  font: "`font` shorthand is dropped by Elementor; use font-weight/font-size/font-family",
  inset: "`inset` shorthand is dropped by Elementor; use inset-block-start etc.",
  "text-wrap": "`text-wrap` is not in the V4 style schema",
  "text-underline-offset": "`text-underline-offset` is not in the V4 style schema",
};

export function lintCss(css: string): string[] {
  const out: string[] = [];
  for (const raw of css.split(";")) {
    const decl = raw.trim();
    if (!decl) continue;
    const colon = decl.indexOf(":");
    if (colon < 0) { out.push(`\`${decl}\` has no colon`); continue; }
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (BANNED[prop]) out.push(BANNED[prop]);
    else if (prop === "animation" || prop.startsWith("animation-")) out.push(`\`${prop}\` is rejected by Elementor; use an anim-* class`);
    else if (prop === "transition" && /\b(cubic-bezier|ease|linear|steps)\b/.test(value)) out.push("`transition` easing is dropped by Elementor; write `transition: <prop> <duration>` only");
  }
  return out;
}

export function lintCssMap(map: CssMap, where: string): string[] {
  const out: string[] = [];
  for (const [key, css] of Object.entries(map)) {
    parseCssKey(key);
    for (const v of lintCss(css ?? "")) out.push(`${where}/${key}: ${v}`);
  }
  return out;
}

export function normalizeCss(css: string): string {
  return css
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      return i < 0 ? d : `${d.slice(0, i).trim()}:${d.slice(i + 1).trim().replace(/\s+/g, " ")}`;
    })
    .join(";");
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/css.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/landing-page/builder/src/css.ts apps/landing-page/builder/src/css.test.ts
git commit -m "feat(landing): CSS map type and lint for the V4 builder"
```

---

### Task 3: Deterministic ids and typed setting helpers

**Files:**
- Create: `apps/landing-page/builder/src/ids.ts`, `ids.test.ts`
- Create: `apps/landing-page/builder/src/props.ts`, `props.test.ts`

**Interfaces:**
- Produces in `ids.ts`: `hex7(seed: string): string` (md5, first 7 hex); `elementId(path: string): string`; `localStyleId(elementId: string): string` returns `e-<id>-<hex7(id + ":style")>`; `globalClassId(label: string): string` returns `g-<hex7(label)>`.
- Produces in `props.ts` (every helper returns the exact JSON Elementor 4.2.4 stores):
  - `str(v: string)` → `{ $$type: "string", value }`
  - `bool(v: boolean)`, `num(v: number)`
  - `html(v: string)` → `{ $$type: "html-v3", value: { content: str(v), children: [] } }`, throws if `v` contains a tag outside the allowed inline set or any attribute other than `href` on `a`
  - `classes(list: string[])` → `{ $$type: "classes", value: list }`, validates `/^[a-z][a-z0-9_-]*$/i`
  - `link(url: string, opts?: { blank?: boolean })` → link prop with `destination` url, `isTargetBlank`, `tag: "a"`
  - `svgRef(hash: string)` → `{ $$type: "svg-src", value: { id: { $$type: "media-hash", value: hash }, url: null } }` (placeholder type the importer replaces with `image-attachment-id`)
  - `imageRef(hash: string, alt: string, size = "full")` → `{ $$type: "image", value: { src: { $$type: "image-src", value: { id: { $$type: "media-hash", value: hash }, url: null, alt: str(alt) } }, size: str(size) } }`
  - `videoRef(url: string)` → `{ $$type: "video-src", value: { id: null, url: { $$type: "url", value: url } } }`
  - `ALLOWED_INLINE_TAGS` constant

- [ ] **Step 1: Write failing tests**

`ids.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { elementId, globalClassId, hex7, localStyleId } from "./ids";

describe("ids", () => {
  test("hex7 is 7 lowercase hex and deterministic", () => {
    expect(hex7("home/hero")).toMatch(/^[0-9a-f]{7}$/);
    expect(hex7("home/hero")).toBe(hex7("home/hero"));
    expect(hex7("home/hero")).not.toBe(hex7("home/hero2"));
  });
  test("element and style ids", () => {
    const id = elementId("home/hero/h1");
    expect(localStyleId(id)).toMatch(new RegExp(`^e-${id}-[0-9a-f]{7}$`));
    expect(globalClassId("btn-primary")).toMatch(/^g-[0-9a-f]{7}$/);
  });
});
```

`props.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { classes, html, imageRef, link, str, svgRef, videoRef } from "./props";

describe("props", () => {
  test("str", () => expect(str("x")).toEqual({ $$type: "string", value: "x" }));
  test("html wraps in html-v3", () => {
    expect(html("Hi <strong>there</strong>")).toEqual({
      $$type: "html-v3",
      value: { content: { $$type: "string", value: "Hi <strong>there</strong>" }, children: [] },
    });
  });
  test("html rejects disallowed tags and attributes", () => {
    expect(() => html("<div>x</div>")).toThrow(/div/);
    expect(() => html('<span class="x">x</span>')).toThrow(/attribute/);
    expect(() => html('<a href="/x">ok</a>')).not.toThrow();
  });
  test("classes validates names", () => {
    expect(classes(["btn-primary"])).toEqual({ $$type: "classes", value: ["btn-primary"] });
    expect(() => classes(["1bad"])).toThrow();
  });
  test("link", () => {
    expect(link("https://app.poppynz.com/auth/sign-up")).toEqual({
      $$type: "link",
      value: {
        destination: { $$type: "url", value: "https://app.poppynz.com/auth/sign-up" },
        isTargetBlank: { $$type: "boolean", value: false },
        tag: { $$type: "string", value: "a" },
      },
    });
  });
  test("media refs carry a hash placeholder", () => {
    expect(svgRef("abc123def456").value.id).toEqual({ $$type: "media-hash", value: "abc123def456" });
    expect(imageRef("abc123def456", "Logo").value.src.value.alt).toEqual({ $$type: "string", value: "Logo" });
    expect(videoRef("https://v/x.mp4").value.url).toEqual({ $$type: "url", value: "https://v/x.mp4" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/ids.test.ts src/props.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `ids.ts`**

```ts
import { createHash } from "node:crypto";

export function hex7(seed: string): string {
  return createHash("md5").update(seed).digest("hex").slice(0, 7);
}
export function elementId(path: string): string {
  return hex7(`el:${path}`);
}
export function localStyleId(elementId: string): string {
  return `e-${elementId}-${hex7(`${elementId}:style`)}`;
}
export function globalClassId(label: string): string {
  return `g-${hex7(label)}`;
}
```

- [ ] **Step 4: Implement `props.ts`**

```ts
export const ALLOWED_INLINE_TAGS = ["strong", "em", "b", "i", "u", "s", "span", "a", "br"] as const;

export const str = (value: string) => ({ $$type: "string" as const, value });
export const bool = (value: boolean) => ({ $$type: "boolean" as const, value });
export const num = (value: number) => ({ $$type: "number" as const, value });

export function html(value: string) {
  for (const m of value.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    if (!(ALLOWED_INLINE_TAGS as readonly string[]).includes(tag)) throw new Error(`html(): tag <${tag}> is not allowed in V4 text`);
    const attrs = m[2].trim();
    if (attrs && !(tag === "a" && /^href="[^"]*"$/.test(attrs))) throw new Error(`html(): attribute "${attrs}" on <${tag}> is stripped by Elementor`);
  }
  return { $$type: "html-v3" as const, value: { content: str(value), children: [] as unknown[] } };
}

export function classes(list: string[]) {
  for (const c of list) if (!/^[a-z][a-z0-9_-]*$/i.test(c)) throw new Error(`classes(): invalid class name "${c}"`);
  return { $$type: "classes" as const, value: [...list] };
}

export function link(url: string, opts: { blank?: boolean } = {}) {
  return {
    $$type: "link" as const,
    value: { destination: { $$type: "url" as const, value: url }, isTargetBlank: bool(opts.blank ?? false), tag: str("a") },
  };
}

const mediaHash = (hash: string) => ({ $$type: "media-hash" as const, value: hash });

export function svgRef(hash: string) {
  return { $$type: "svg-src" as const, value: { id: mediaHash(hash), url: null as null } };
}
export function imageRef(hash: string, alt: string, size = "full") {
  return {
    $$type: "image" as const,
    value: { src: { $$type: "image-src" as const, value: { id: mediaHash(hash), url: null as null, alt: str(alt) } }, size: str(size) },
  };
}
export function videoRef(url: string) {
  return { $$type: "video-src" as const, value: { id: null as null, url: { $$type: "url" as const, value: url } } };
}
```

- [ ] **Step 5: Run tests**

Run: `bun test src/ids.test.ts src/props.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/landing-page/builder/src/ids.ts apps/landing-page/builder/src/ids.test.ts apps/landing-page/builder/src/props.ts apps/landing-page/builder/src/props.test.ts
git commit -m "feat(landing): deterministic ids and typed V4 setting helpers"
```

---

### Task 4: Tokens and global classes

**Files:**
- Create: `apps/landing-page/builder/src/tokens.ts`, `tokens.test.ts`
- Create: `apps/landing-page/builder/src/classes.ts`, `classes.test.ts`

**Interfaces:**
- Consumes: `CssMap`, `lintCssMap` from `css.ts`; `globalClassId` from `ids.ts`.
- Produces in `tokens.ts`:
  - `type VariableType = "global-color-variable" | "global-font-variable"`
  - `type Variable = { label: string; type: VariableType; value: string }`
  - `VARIABLES: Variable[]` (the palette below)
  - `v(label: string): string` returns `var(--label)` and throws if the label is not declared
- Produces in `classes.ts`:
  - `type GlobalClass = { label: string; id: string; css: CssMap }`
  - `CLASSES: Record<string, GlobalClass>` keyed by label
  - `ANIM_CLASSES: string[]` = `["anim-float","anim-wave","anim-bob","anim-wiggle","anim-wiggle-badge","anim-beat","anim-twinkle","anim-drift","anim-drift-rev","anim-drift-slow","anim-ring"]`, each also present in `CLASSES` with `css: { desktop: "" }`
  - `cls(label: string): string` returns the label and throws if undeclared (used by recipes)
  - `lintClasses(): string[]`

- [ ] **Step 1: Write failing tests**

`tokens.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { VARIABLES, v } from "./tokens";

describe("tokens", () => {
  test("labels are unique, no spaces, <= 50 chars", () => {
    const labels = VARIABLES.map((x) => x.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l).toMatch(/^[a-z][a-z0-9-]{0,49}$/);
  });
  test("v() references declared labels only", () => {
    expect(v("navy")).toBe("var(--navy)");
    expect(() => v("nope")).toThrow(/nope/);
  });
  test("core palette present", () => {
    const byLabel = Object.fromEntries(VARIABLES.map((x) => [x.label, x.value]));
    expect(byLabel.navy).toBe("#1A3375");
    expect(byLabel.sky).toBe("#37B5FF");
    expect(byLabel["font-display"]).toBe("Hanken Grotesk");
  });
});
```

`classes.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { ANIM_CLASSES, CLASSES, cls, lintClasses } from "./classes";

describe("classes", () => {
  test("every class lints clean", () => expect(lintClasses()).toEqual([]));
  test("ids derive from labels", () => expect(CLASSES["btn-primary"].id).toMatch(/^g-[0-9a-f]{7}$/));
  test("anim classes exist with empty css", () => {
    for (const a of ANIM_CLASSES) expect(CLASSES[a].css).toEqual({ desktop: "" });
  });
  test("cls guards", () => {
    expect(cls("eyebrow")).toBe("eyebrow");
    expect(() => cls("missing")).toThrow(/missing/);
  });
  test("btn-primary has hover and mobile variants using the sky variable", () => {
    expect(CLASSES["btn-primary"].css.desktop).toContain("var(--sky)");
    expect(CLASSES["btn-primary"].css["desktop:hover"]).toContain("transform");
    expect(CLASSES["btn-primary"].css.mobile).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/tokens.test.ts src/classes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `tokens.ts`**

```ts
export type VariableType = "global-color-variable" | "global-font-variable";
export type Variable = { label: string; type: VariableType; value: string };

const color = (label: string, value: string): Variable => ({ label, type: "global-color-variable", value });
const font = (label: string, value: string): Variable => ({ label, type: "global-font-variable", value });

export const VARIABLES: Variable[] = [
  color("navy", "#1A3375"),
  color("sky", "#37B5FF"),
  color("sky-hover", "#1FA6F3"),
  color("sky-light", "#8FCDFF"),
  color("teal", "#005782"),
  color("ink", "#001E30"),
  color("muted", "#444650"),
  color("muted-2", "#757681"),
  color("page", "#F7F9FF"),
  color("white", "#FFFFFF"),
  color("line", "#D6E2F2"),
  color("line-2", "#C5C6D2"),
  color("tint", "#E1F0FF"),
  color("tint-2", "#ECF4FF"),
  color("tint-line", "#CBE6FF"),
  color("pink", "#FCE3F4"),
  color("pink-line", "#F5C9E4"),
  color("magenta", "#EA42B9"),
  color("magenta-ink", "#A5106F"),
  color("ok", "#0B7A52"),
  color("ok-bg", "#E3F4EC"),
  color("navy-text", "#B9C6E8"),
  color("navy-note", "#8B9BC9"),
  color("orange", "#F26E21"),
  color("orange-bg", "#FDEBE0"),
  color("orange-line", "#F5C9A8"),
  font("font-display", "Hanken Grotesk"),
  font("font-body", "Inter"),
];

const LABELS = new Set(VARIABLES.map((x) => x.label));

export function v(label: string): string {
  if (!LABELS.has(label)) throw new Error(`v(): variable "${label}" is not declared in tokens.ts`);
  return `var(--${label})`;
}
```

- [ ] **Step 4: Implement `classes.ts`**

Font shorthands from `site.css` are expanded to longhands; `.bubble i` style descendant rules become their own classes for the icon element (`icon-22`, `icon-teal`, ...). `clamp()` values are kept: the converter stores them as custom sizes.

```ts
import { lintCssMap, type CssMap } from "./css";
import { globalClassId } from "./ids";
import { v } from "./tokens";

export type GlobalClass = { label: string; id: string; css: CssMap };

const BODY = `font-family:${v("font-body")}`;
const DISPLAY = `font-family:${v("font-display")}`;
const SHADOW_CARD = "box-shadow:0 1px 3px rgba(0,29,90,.06),0 8px 24px -12px rgba(0,29,90,.12)";
const SHADOW_DEEP = "box-shadow:0 28px 60px -30px rgba(0,29,90,.4)";
const SHADOW_SKY = "box-shadow:0 10px 24px -10px rgba(55,181,255,.65)";
const LIFT = "transform:translateY(-2px) scale(1.02)";

const defs: Record<string, CssMap> = {
  // layout
  wrap: { desktop: "max-width:1920px;margin-left:auto;margin-right:auto;width:100%" },
  sec: { desktop: "padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px)" },
  "sec-x": { desktop: "padding-left:clamp(24px,5vw,96px);padding-right:clamp(24px,5vw,96px)" },
  band: { desktop: `background-color:${v("white")};border-top-width:1.5px;border-bottom-width:1.5px;border-top-style:solid;border-bottom-style:solid;border-color:${v("line")}` },
  "band-top": { desktop: `background-color:${v("white")};border-top-width:1.5px;border-top-style:solid;border-color:${v("line")}` },
  navy: { desktop: `background-color:${v("navy")};color:${v("white")}` },
  "stack-16": { desktop: "display:flex;flex-direction:column;gap:16px" },
  "stack-20": { desktop: "display:flex;flex-direction:column;gap:20px" },
  "stack-24": { desktop: "display:flex;flex-direction:column;gap:24px" },
  "grid-2": { desktop: "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:clamp(32px,5vw,64px);align-items:center" },
  "grid-cards": { desktop: "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:20px" },
  "btn-row": { desktop: "display:flex;flex-wrap:wrap;gap:14px;align-items:center" },
  "btn-row-center": { desktop: "display:flex;flex-wrap:wrap;justify-content:center;gap:14px" },
  // type
  eyebrow: { desktop: `${BODY};font-weight:600;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${v("teal")};display:flex;align-items:center;gap:10px` },
  "eyebrow-light": { desktop: `${BODY};font-weight:600;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${v("sky-light")};display:flex;align-items:center;gap:10px` },
  dash: { desktop: "display:inline-block;width:22px;height:2px;border-radius:2px;background-color:currentColor" },
  label: { desktop: `${BODY};font-weight:600;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${v("teal")}` },
  h1: { desktop: `${DISPLAY};font-weight:800;font-size:clamp(38px,5vw,68px);line-height:1.05;letter-spacing:-.02em;color:${v("navy")}` },
  h2: { desktop: `${DISPLAY};font-weight:800;font-size:clamp(30px,3.6vw,44px);line-height:1.1;letter-spacing:-.02em;color:${v("navy")}` },
  "h2-light": { desktop: `${DISPLAY};font-weight:700;font-size:clamp(30px,3.6vw,44px);line-height:1.1;letter-spacing:-.02em;color:${v("white")}` },
  "h2-sm": { desktop: `${DISPLAY};font-weight:800;font-size:clamp(28px,3.4vw,40px);line-height:1.1;letter-spacing:-.02em;color:${v("navy")}` },
  "h2-cta": { desktop: `${DISPLAY};font-weight:800;font-size:clamp(32px,4.2vw,52px);line-height:1.05;letter-spacing:-.02em;color:${v("navy")}` },
  h3: { desktop: `${DISPLAY};font-weight:700;font-size:21px;letter-spacing:-.01em;color:${v("navy")}` },
  "h3-lg": { desktop: `${DISPLAY};font-weight:700;font-size:24px;letter-spacing:-.01em;color:${v("navy")}` },
  "h3-light": { desktop: `${DISPLAY};font-weight:700;font-size:24px;letter-spacing:-.01em;color:${v("white")}` },
  "hl-wavy": { desktop: "" }, // inner <em> styled by theme anim.css
  "em-accent": { desktop: "" }, // inner <em> styled by theme anim.css
  accent: { desktop: `color:${v("sky")}` },
  lead: { desktop: `${BODY};font-size:17px;line-height:1.6;color:${v("muted")}` },
  "lead-light": { desktop: `${BODY};font-size:17px;line-height:1.6;color:${v("navy-text")}` },
  "lead-lg": { desktop: `${BODY};font-size:clamp(16px,1.4vw,19px);line-height:1.6;color:${v("muted")};max-width:540px` },
  "body-15": { desktop: `${BODY};font-size:15px;line-height:1.55;color:${v("muted")}` },
  "body-15-light": { desktop: `${BODY};font-size:15px;line-height:1.6;color:${v("navy-text")}` },
  "body-16": { desktop: `${BODY};font-size:16px;line-height:1.6;color:${v("muted")}` },
  "body-18": { desktop: `${BODY};font-size:18px;line-height:1.6;color:${v("muted")}` },
  "muted-14": { desktop: `${BODY};font-size:14px;line-height:1.5;color:${v("muted")}` },
  "muted-13": { desktop: `${BODY};font-size:13px;line-height:1.5;color:${v("muted")}` },
  "note-light": { desktop: `display:flex;align-items:center;gap:8px;${BODY};font-size:13px;color:${v("navy-note")}` },
  trust: { desktop: `display:flex;align-items:flex-start;gap:8px;${BODY};font-size:14px;line-height:1.5;color:${v("muted")}` },
  // buttons
  "btn-primary": {
    desktop: `display:inline-block;padding:16px 30px;border-radius:999px;background-color:${v("sky")};color:${v("white")};${BODY};font-weight:600;font-size:16px;text-decoration:none;${SHADOW_SKY};transition:transform .25s`,
    "desktop:hover": `background-color:${v("sky-hover")};color:${v("white")};${LIFT}`,
    mobile: "padding:14px 24px",
  },
  "btn-primary-14": {
    desktop: `display:inline-block;padding:14px 26px;border-radius:999px;background-color:${v("sky")};color:${v("white")};${BODY};font-weight:600;font-size:15px;text-decoration:none;${SHADOW_SKY};transition:transform .25s`,
    "desktop:hover": `background-color:${v("sky-hover")};color:${v("white")};${LIFT}`,
  },
  "btn-outline": {
    desktop: `display:inline-block;padding:15px 26px;border-radius:8px;border-width:1.5px;border-style:solid;border-color:${v("navy")};color:${v("navy")};${BODY};font-weight:600;font-size:16px;text-decoration:none`,
    "desktop:hover": `background-color:${v("tint-2")}`,
  },
  "btn-ghost-light-15": {
    desktop: `display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:8px;border-width:1.5px;border-style:solid;border-color:rgba(255,255,255,.35);color:${v("white")};${BODY};font-weight:600;font-size:15px;text-decoration:none`,
    "desktop:hover": `background-color:rgba(255,255,255,.08);color:${v("white")}`,
  },
  "link-arrow": {
    desktop: `display:inline-flex;align-items:center;gap:8px;${BODY};font-weight:600;font-size:15px;color:${v("navy")};text-decoration:none`,
    "desktop:hover": `color:${v("teal")}`,
  },
  signin: {
    desktop: `padding:10px 14px;border-radius:8px;${BODY};font-weight:600;font-size:15px;color:${v("navy")};text-decoration:none`,
    "desktop:hover": `background-color:${v("tint-2")}`,
  },
  getstarted: {
    desktop: `padding:11px 22px;border-radius:999px;background-color:${v("sky")};color:${v("white")};${BODY};font-weight:600;font-size:15px;text-decoration:none;${SHADOW_SKY};transition:transform .25s`,
    "desktop:hover": `background-color:${v("sky-hover")};color:${v("white")};${LIFT}`,
  },
  "nav-link": {
    desktop: `padding:8px 12px;border-radius:8px;${BODY};font-weight:500;font-size:15px;color:${v("navy")};text-decoration:none;display:inline-flex;align-items:center;gap:6px`,
    "desktop:hover": `background-color:${v("tint-2")}`,
  },
  "badge-new": { desktop: `display:inline-flex;align-items:center;padding:2px 6px;border-radius:999px;background-color:${v("pink")};color:${v("magenta-ink")};${BODY};font-weight:700;font-size:10px;letter-spacing:.06em;text-transform:uppercase` },
  lang: { desktop: `display:flex;border-width:1.5px;border-style:solid;border-color:${v("line-2")};border-radius:8px;padding:2px;gap:0` },
  "lang-item": { desktop: `padding:5px 9px;border-radius:6px;color:${v("muted")};${BODY};font-weight:600;font-size:12px;letter-spacing:.04em;text-decoration:none` },
  "lang-on": { desktop: `background-color:${v("navy")};color:${v("white")}` },
  // icons
  "icon-18": { desktop: "width:18px;height:18px" },
  "icon-20": { desktop: "width:20px;height:20px" },
  "icon-22": { desktop: "width:22px;height:22px" },
  "icon-24": { desktop: "width:24px;height:24px" },
  "icon-teal": { desktop: `color:${v("teal")}` },
  "icon-ok": { desktop: `color:${v("ok")}` },
  "icon-sky": { desktop: `color:${v("sky")}` },
  "icon-sky-light": { desktop: `color:${v("sky-light")}` },
  "icon-magenta": { desktop: `color:${v("magenta")}` },
  "icon-white": { desktop: `color:${v("white")}` },
  // bubbles, avatars, chips
  bubble: { desktop: `display:flex;width:44px;height:44px;align-items:center;justify-content:center;border-radius:999px;background-color:${v("tint")};transition:transform .3s`, "desktop:hover": "transform:rotate(-8deg) scale(1.1)" },
  "bubble-40": { desktop: "width:40px;height:40px" },
  "bubble-48": { desktop: "width:48px;height:48px" },
  "bubble-light": { desktop: "display:flex;width:48px;height:48px;align-items:center;justify-content:center;border-radius:999px;background-color:rgba(255,255,255,.1)" },
  avatar: { desktop: `display:flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:999px;background-color:${v("sky")};color:${v("white")};${BODY};font-weight:700;font-size:14px` },
  vetted: { desktop: `display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:4px;background-color:${v("ok-bg")};color:${v("ok")};${BODY};font-weight:600;font-size:12px` },
  city: { desktop: `display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;background-color:${v("tint")};${BODY};font-weight:500;font-size:14px;color:${v("navy")};transition:transform .25s`, "desktop:hover": "transform:translateY(-3px) rotate(-2deg)" },
  "city-next": { desktop: `display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;border-width:1.5px;border-style:dashed;border-color:${v("line-2")};${BODY};font-weight:500;font-size:14px;color:${v("muted")};transform:rotate(-2deg)` },
  // cards
  card: { desktop: `display:flex;flex-direction:column;gap:14px;padding:28px;border-radius:8px;border-width:1.5px;border-style:solid;border-color:${v("line")};background-color:${v("page")};transition:transform .25s` },
  "card-lift": { "desktop:hover": `border-color:${v("sky-light")};background-color:${v("tint-2")};transform:translateY(-4px) rotate(-0.6deg)` },
  "card-lift-r": { "desktop:hover": `border-color:${v("sky-light")};background-color:${v("tint-2")};transform:translateY(-4px) rotate(0.6deg)` },
  "hero-card": { desktop: `display:flex;flex-direction:column;gap:14px;padding:22px;border-radius:12px;background-color:${v("white")};border-width:1.5px;border-style:solid;border-color:${v("line")};${SHADOW_CARD};text-decoration:none;transition:transform .25s` },
  "hero-card-l": { "desktop:hover": `border-color:${v("sky")};background-color:${v("tint-2")};transform:translateY(-4px) rotate(-0.8deg)` },
  "hero-card-r": { "desktop:hover": `border-color:${v("navy")};background-color:${v("tint-2")};transform:translateY(-4px) rotate(0.8deg)` },
  "hero-card-title": { desktop: `${DISPLAY};font-weight:700;font-size:18px;color:${v("navy")}` },
  "hero-card-text": { desktop: `${BODY};font-size:14px;line-height:1.5;color:${v("muted")}` },
  "go-sky": { desktop: `display:inline-flex;align-self:flex-start;align-items:center;gap:8px;padding:10px 18px;color:${v("white")};${BODY};font-weight:600;font-size:14px;border-radius:999px;background-color:${v("sky")};${SHADOW_SKY}` },
  "go-navy": { desktop: `display:inline-flex;align-self:flex-start;align-items:center;gap:8px;padding:10px 18px;color:${v("white")};${BODY};font-weight:600;font-size:14px;border-radius:8px;background-color:${v("navy")}` },
  "step-num": { desktop: `${BODY};font-weight:700;font-size:13px;letter-spacing:.08em;color:${v("teal")};display:inline-block;transform:rotate(6deg)` },
  "step-top": { desktop: "display:flex;justify-content:space-between;align-items:center;width:100%" },
  svc: { desktop: `position:relative;display:flex;flex-direction:column;gap:10px;min-height:320px;padding:24px 24px 0;border-radius:12px;border-width:1.5px;border-style:solid;border-color:${v("tint-line")};background-color:${v("tint")};overflow:hidden;text-decoration:none;transition:transform .25s`, "desktop:hover": `border-color:${v("sky-light")};transform:translateY(-4px) rotate(0.6deg)` },
  "svc-pink": { desktop: `background-color:${v("pink")};border-color:${v("pink-line")}`, "desktop:hover": `border-color:${v("magenta")}` },
  "svc-title": { desktop: `${DISPLAY};font-weight:700;font-size:21px;letter-spacing:-.01em;color:${v("navy")}` },
  "svc-text": { desktop: `${BODY};font-size:14px;line-height:1.5;color:${v("muted")};max-width:30ch` },
  "svc-art": { desktop: "display:block;align-self:flex-end;margin-top:auto;margin-right:-4px;margin-bottom:-6px;height:160px;width:auto;object-fit:contain;filter:drop-shadow(0 6px 10px rgba(0,29,90,.12))" },
  quote: { desktop: `display:flex;flex-direction:column;gap:20px;padding:32px;border-radius:8px;background-color:${v("white")};border-width:1.5px;border-style:solid;border-color:${v("line")};${SHADOW_CARD};transition:transform .3s`, "desktop:hover": "transform:rotate(0) translateY(-4px)" },
  "quote-text": { desktop: `${DISPLAY};font-weight:500;font-style:italic;font-size:22px;line-height:1.45;color:${v("navy")}` },
  "quote-who": { desktop: "display:flex;align-items:center;gap:12px;margin-top:auto" },
  panel: { desktop: `display:flex;flex-direction:column;gap:20px;padding:32px;border-radius:14px;background-color:${v("white")};border-width:1.5px;border-style:solid;border-color:${v("line")};${SHADOW_CARD}` },
  "panel-navy": { desktop: `display:flex;flex-direction:column;gap:20px;padding:32px;border-radius:14px;background-color:${v("navy")};color:${v("white")};${SHADOW_DEEP}` },
  "card-shadow": { desktop: SHADOW_CARD },
  "shadow-deep": { desktop: SHADOW_DEEP },
  checks: { desktop: `display:flex;flex-direction:column;gap:12px;${BODY};font-size:15px;line-height:1.5;color:${v("muted")}` },
  "check-row": { desktop: "display:flex;gap:10px;align-items:flex-start" },
  credibled: { desktop: `display:flex;align-items:center;gap:10px;margin-top:auto;padding:12px 14px;border-radius:8px;background-color:${v("orange-bg")};border-width:1.5px;border-style:solid;border-color:${v("orange-line")};${BODY};font-weight:500;font-size:13px;line-height:1.4;color:${v("ink")}` },
  dot: { desktop: `flex-shrink:0;width:10px;height:10px;border-radius:999px;background-color:${v("orange")}` },
  "float-card": { desktop: `position:absolute;inset-inline-end:16px;inset-block-start:24px;display:flex;align-items:center;gap:12px;padding:12px 14px;background-color:${v("white")};border-width:1.5px;border-style:solid;border-color:${v("line")};border-radius:8px;${SHADOW_CARD}` },
  "media-box": { desktop: `position:relative;height:clamp(320px,45vw,640px);border-radius:14px;overflow:hidden;${SHADOW_DEEP};background-color:${v("tint")}` },
  "cta-inner": { desktop: "display:flex;flex-direction:column;align-items:center;gap:24px;text-align:center;padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px)" },
  // footer
  ftr: { desktop: `padding:clamp(48px,6vw,64px) clamp(24px,5vw,96px) 40px;background-color:${v("page")};border-top-width:1.5px;border-top-style:solid;border-color:${v("line")}` },
  "ftr-grid": { desktop: "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:40px" },
  "ftr-col": { desktop: "display:flex;flex-direction:column;gap:12px" },
  "ftr-link": { desktop: `${BODY};font-size:15px;color:${v("navy")};text-decoration:none`, "desktop:hover": `color:${v("teal")}` },
  "ftr-bottom": { desktop: `display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;margin-top:48px;padding-top:24px;border-top-width:1.5px;border-top-style:solid;border-color:${v("line")};${BODY};font-size:13px;color:${v("muted")}` },
  brand: { desktop: `display:inline-flex;align-items:center;gap:10px;${DISPLAY};font-weight:800;font-size:20px;letter-spacing:-.02em;color:${v("navy")};text-decoration:none` },
  "brand-mark": { desktop: "width:32px;height:32px" },
  hdr: { desktop: `position:sticky;inset-block-start:0;z-index:20;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px;padding:14px clamp(24px,5vw,96px);border-bottom-width:1.5px;border-bottom-style:solid;border-color:${v("line")};background-color:rgba(247,249,255,.94);backdrop-filter:blur(8px)` },
  "hdr-nav": { desktop: "display:flex;flex-wrap:wrap;justify-content:center;gap:4px;flex-grow:1" },
  "hdr-actions": { desktop: "display:flex;align-items:center;gap:12px" },
  // hero decorations
  deco: { desktop: "position:absolute;inset-block-start:0;inset-inline-start:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:0" },
  "deco-d1": { desktop: `position:absolute;inset-inline-start:6%;inset-block-start:14%;width:14px;height:14px;border-radius:999px;background-color:${v("tint-line")}` },
  "deco-d2": { desktop: `position:absolute;inset-inline-start:44%;inset-block-start:8%;width:9px;height:9px;border-radius:999px;background-color:${v("magenta")};opacity:.55` },
  "deco-d3": { desktop: `position:absolute;inset-inline-start:52%;inset-block-start:70%;width:22px;height:22px;color:${v("sky")}` },
  "deco-d4": { desktop: `position:absolute;inset-inline-start:2%;inset-block-end:12%;width:22px;height:22px;border-radius:999px;border-width:2px;border-style:solid;border-color:${v("sky-light")}` },
  "deco-d5": { desktop: `position:absolute;inset-inline-end:4%;inset-block-end:18%;width:18px;height:18px;color:${v("magenta")};opacity:.5` },
  "hero-copy": { desktop: "position:relative;z-index:1;display:flex;flex-direction:column;gap:28px" },
  hero: { desktop: "position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:clamp(32px,5vw,64px);padding:clamp(48px,7vw,80px) clamp(24px,5vw,96px);align-items:center;max-width:1920px;margin-left:auto;margin-right:auto" },
};

export const ANIM_CLASSES = ["anim-float", "anim-wave", "anim-bob", "anim-wiggle", "anim-wiggle-badge", "anim-beat", "anim-twinkle", "anim-drift", "anim-drift-rev", "anim-drift-slow", "anim-ring"];
for (const a of ANIM_CLASSES) defs[a] = { desktop: "" };

export const CLASSES: Record<string, GlobalClass> = Object.fromEntries(
  Object.entries(defs).map(([label, css]) => [label, { label, id: globalClassId(label), css }]),
);

export function cls(label: string): string {
  if (!CLASSES[label]) throw new Error(`cls(): global class "${label}" is not declared in classes.ts`);
  return label;
}

export function lintClasses(): string[] {
  return Object.values(CLASSES).flatMap((c) => lintCssMap(c.css, c.label));
}
```

- [ ] **Step 5: Run tests**

Run: `bun test src/tokens.test.ts src/classes.test.ts`
Expected: PASS. If `lintClasses` reports a violation, fix the CSS in `defs`, never the lint.

- [ ] **Step 6: Commit**

```bash
git add apps/landing-page/builder/src/tokens.ts apps/landing-page/builder/src/tokens.test.ts apps/landing-page/builder/src/classes.ts apps/landing-page/builder/src/classes.test.ts
git commit -m "feat(landing): design tokens and global classes from site.css"
```

---

### Task 5: Element DSL

**Files:**
- Create: `apps/landing-page/builder/src/dsl.ts`, `dsl.test.ts`

**Interfaces:**
- Consumes: `elementId`, `localStyleId` from `ids.ts`; `str`, `html`, `classes`, `link`, `svgRef`, `imageRef`, `videoRef`, `bool` from `props.ts`; `CssMap`, `lintCssMap`, `normalizeCss` from `css.ts`; `cls` from `classes.ts`.
- Produces:
  - `type Interaction = { trigger: "load" | "scrollIn"; effect: "fade" | "slide" | "scale"; direction?: "left" | "right" | "top" | "bottom"; durationMs?: number; delayMs?: number }`
  - `type Common = { title: string; classes?: string[]; css?: CssMap; link?: string; blank?: boolean; interaction?: Interaction }`
  - `type El = { id: string; elType: string; widgetType?: string; settings: Record<string, unknown>; styles: Record<string, unknown>; elements: El[]; editor_settings: { title: string }; version: "0.0"; interactions?: unknown; _css: Record<string, CssMap> }`
  - Constructors, each taking `path: string` as first argument (used for the deterministic id):
    - `flex(path, c: Common & { tag?: ContainerTag }, children: El[])`
    - `block(path, c: Common & { tag?: ContainerTag }, children: El[])` → `e-div-block`
    - `grid(path, c: Common & { tag?: ContainerTag }, children: El[])` → `e-grid`
    - `heading(path, c: Common & { tag: "h1"|"h2"|"h3"|"h4"|"h5"|"h6"; text: string })`
    - `text(path, c: Common & { text: string; tag?: "p"|"span" })`
    - `button(path, c: Common & { text: string; link: string })`
    - `svg(path, c: Common & { icon: string })` where `icon` is a media hash placeholder string `icon:<name>` resolved in Task 8
    - `image(path, c: Common & { media: string; alt: string })` where `media` is `media:<key>`
    - `video(path, c: Common & { url: string; poster?: string })`
  - `collectCss(root: El): Record<string, CssMap>` merges every `_css` in the tree
  - `type ContainerTag = "div"|"header"|"section"|"article"|"aside"|"footer"|"a"|"button"`

Rules the constructors enforce: `classes` are checked with `cls()`; when `css` is given, a local style is created with id `localStyleId(id)` and added to `classes` first; a `_css` entry keyed by that style id holds the normalized CssMap; the `styles` object holds the id, `type: "class"`, `label: "local"` and one variant per CssMap key with `props: {}` (the importer fills props); `interaction` serialises to Elementor's `interactions` array with `interaction_id` `temp-<id>`.

- [ ] **Step 1: Write failing tests**

`dsl.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { button, collectCss, flex, heading, svg, text } from "./dsl";

describe("dsl", () => {
  const h1 = heading("home/hero/h1", { title: "H1", tag: "h1", classes: ["h1"], text: "Your Family’s <em>Perfect Helper</em>", interaction: { trigger: "load", effect: "slide", direction: "bottom" } });
  const btn = button("home/hero/cta", { title: "CTA", classes: ["btn-primary"], text: "Find a helper", link: "https://app.poppynz.com/auth/sign-up" });
  const icon = svg("home/hero/icon", { title: "Check", classes: ["icon-22", "icon-ok"], icon: "icon:check" });
  const root = flex("home/hero", { title: "Hero", tag: "section", classes: ["hero"], css: { desktop: "gap:28px", mobile: "gap:20px" } }, [h1, text("home/hero/p", { title: "Intro", classes: ["lead-lg"], text: "Connecting families." }), btn, icon]);

  test("ids are deterministic and 7 hex", () => {
    expect(h1.id).toMatch(/^[0-9a-f]{7}$/);
    expect(heading("home/hero/h1", { title: "x", tag: "h1", text: "y" }).id).toBe(h1.id);
  });
  test("heading settings", () => {
    expect(h1.elType).toBe("widget");
    expect(h1.widgetType).toBe("e-heading");
    expect(h1.settings.tag).toEqual({ $$type: "string", value: "h1" });
    expect((h1.settings.title as any).$$type).toBe("html-v3");
    expect((h1.settings.classes as any).value).toEqual(["h1"]);
  });
  test("interaction serialises", () => {
    const items = (h1.interactions as any).items;
    expect(items[0].value.trigger.value).toBe("load");
    expect(items[0].value.animation.value.direction.value).toBe("bottom");
    expect(items[0].value.interaction_id.value).toBe(`temp-${h1.id}`);
  });
  test("local css creates a style, prepends its id to classes and records _css", () => {
    const sid = (root.settings.classes as any).value[0];
    expect(sid).toMatch(new RegExp(`^e-${root.id}-[0-9a-f]{7}$`));
    expect((root.settings.classes as any).value).toEqual([sid, "hero"]);
    expect((root.styles as any)[sid].variants.map((v: any) => v.meta)).toEqual([
      { breakpoint: "desktop", state: null },
      { breakpoint: "mobile", state: null },
    ]);
    expect(root._css[sid]).toEqual({ desktop: "gap:28px", mobile: "gap:20px" });
  });
  test("container tag and children", () => {
    expect(root.elType).toBe("e-flexbox");
    expect(root.settings.tag).toEqual({ $$type: "string", value: "section" });
    expect(root.elements).toHaveLength(4);
  });
  test("button link and svg placeholder", () => {
    expect((btn.settings.link as any).value.destination.value).toBe("https://app.poppynz.com/auth/sign-up");
    expect((icon.settings.svg as any).value.id).toEqual({ $$type: "media-hash", value: "icon:check" });
  });
  test("undeclared class throws, banned css throws", () => {
    expect(() => text("x", { title: "x", classes: ["nope"], text: "x" })).toThrow(/nope/);
    expect(() => text("x", { title: "x", css: { desktop: "inset:0" }, text: "x" })).toThrow(/inset/);
  });
  test("collectCss walks the tree", () => {
    const all = collectCss(root);
    expect(Object.keys(all)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/dsl.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `dsl.ts`**

```ts
import { cls } from "./classes";
import { lintCssMap, normalizeCss, parseCssKey, type CssMap } from "./css";
import { elementId, localStyleId } from "./ids";
import { bool, classes as classesProp, html, imageRef, link as linkProp, num, str, svgRef, videoRef } from "./props";

export type ContainerTag = "div" | "header" | "section" | "article" | "aside" | "footer" | "a" | "button";
export type Interaction = { trigger: "load" | "scrollIn"; effect: "fade" | "slide" | "scale"; direction?: "left" | "right" | "top" | "bottom"; durationMs?: number; delayMs?: number };
export type Common = { title: string; classes?: string[]; css?: CssMap; link?: string; blank?: boolean; interaction?: Interaction };
export type El = {
  id: string; elType: string; widgetType?: string; settings: Record<string, unknown>; styles: Record<string, unknown>;
  elements: El[]; editor_settings: { title: string }; version: "0.0"; interactions?: unknown; _css: Record<string, CssMap>;
};

function size(ms: number) { return { $$type: "size", value: { size: ms, unit: "ms" } }; }

function interactions(id: string, i: Interaction) {
  return {
    items: [{
      $$type: "interaction-item",
      value: {
        interaction_id: str(`temp-${id}`),
        trigger: str(i.trigger),
        animation: {
          $$type: "animation-preset-props",
          value: {
            effect: str(i.effect), type: str("in"), direction: str(i.direction ?? ""),
            timing_config: { $$type: "timing-config", value: { duration: size(i.durationMs ?? 600), delay: size(i.delayMs ?? 0) } },
          },
        },
      },
    }],
    version: 1,
  };
}

function base(path: string, c: Common, elType: string, widgetType?: string): El {
  const id = elementId(path);
  const classList = (c.classes ?? []).map(cls);
  const styles: Record<string, unknown> = {};
  const _css: Record<string, CssMap> = {};
  if (c.css && Object.keys(c.css).length) {
    const problems = lintCssMap(c.css, path);
    if (problems.length) throw new Error(problems.join("\n"));
    const sid = localStyleId(id);
    const normalized: CssMap = Object.fromEntries(Object.entries(c.css).map(([k, v]) => [k, normalizeCss(v ?? "")]));
    styles[sid] = {
      id: sid, type: "class", label: "local",
      variants: Object.keys(normalized).map((k) => { const { breakpoint, state } = parseCssKey(k); return { meta: { breakpoint, state }, props: {} }; }),
    };
    _css[sid] = normalized;
    classList.unshift(sid);
  }
  const settings: Record<string, unknown> = { classes: classesProp(classList) };
  if (c.link) settings.link = linkProp(c.link, { blank: c.blank });
  const el: El = { id, elType, settings, styles, elements: [], editor_settings: { title: c.title }, version: "0.0", _css };
  if (widgetType) el.widgetType = widgetType;
  if (c.interaction) el.interactions = interactions(id, c.interaction);
  return el;
}

function container(elType: string) {
  return (path: string, c: Common & { tag?: ContainerTag }, children: El[]): El => {
    const el = base(path, c, elType);
    el.settings.tag = str(c.tag ?? "div");
    el.elements = children;
    return el;
  };
}
export const flex = container("e-flexbox");
export const block = container("e-div-block");
export const grid = container("e-grid");

export function heading(path: string, c: Common & { tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"; text: string }): El {
  const el = base(path, c, "widget", "e-heading");
  el.settings.tag = str(c.tag);
  el.settings.title = html(c.text);
  return el;
}
export function text(path: string, c: Common & { text: string; tag?: "p" | "span" }): El {
  const el = base(path, c, "widget", "e-paragraph");
  el.settings.tag = str(c.tag ?? "p");
  el.settings.paragraph = html(c.text);
  return el;
}
export function button(path: string, c: Common & { text: string; link: string }): El {
  const el = base(path, c, "widget", "e-button");
  el.settings.text = html(c.text);
  return el;
}
export function svg(path: string, c: Common & { icon: string }): El {
  const el = base(path, c, "widget", "e-svg");
  el.settings.svg = svgRef(c.icon);
  return el;
}
export function image(path: string, c: Common & { media: string; alt: string }): El {
  const el = base(path, c, "widget", "e-image");
  el.settings.image = imageRef(c.media, c.alt);
  return el;
}
export function video(path: string, c: Common & { url: string; poster?: string }): El {
  const el = base(path, c, "widget", "e-self-hosted-video");
  el.settings.source = videoRef(c.url);
  el.settings.autoplay = bool(true); el.settings.mute = bool(true); el.settings.loop = bool(true);
  el.settings.playsinline = bool(true); el.settings.controls = bool(false); el.settings.preload = str("metadata");
  if (c.poster) { el.settings.poster_enabled = bool(true); el.settings.poster = imageRef(c.poster, ""); }
  return el;
}

export function collectCss(root: El): Record<string, CssMap> {
  const out: Record<string, CssMap> = { ...root._css };
  for (const child of root.elements) Object.assign(out, collectCss(child));
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/dsl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/landing-page/builder/src/dsl.ts apps/landing-page/builder/src/dsl.test.ts
git commit -m "feat(landing): element DSL producing V4 JSON with CSS sidecar"
```

---

### Task 6: Page map, link resolution and media registry

**Files:**
- Create: `apps/landing-page/builder/src/pages.ts`, `pages.test.ts`
- Create: `apps/landing-page/builder/src/media.ts`, `media.test.ts`
- Create: `apps/landing-page/builder/src/content/types.ts`

**Interfaces:**
- Produces in `content/types.ts`: `type Lang = "en" | "fr"`, `const LANGS: Lang[] = ["en","fr"]`, `type Localized<T> = Record<Lang, T>`, `assertLocalizedKeys(obj: Localized<Record<string, unknown>>, where: string): void` throws listing keys present in one language and missing in another (deep, dotted paths).
- Produces in `pages.ts`:
  - `PAGES: Record<PageKey, { slug: Localized<string>; title: Localized<string> }>` with keys `home, families, helpers, safety, daycare, blog, privacy, terms, agreement`
  - `APP = { signUp: "https://app.poppynz.com/auth/sign-up", signIn: "https://app.poppynz.com/auth/sign-in" }`
  - `pageUrl(key: PageKey, lang: Lang): string` → `/` or `/fr/` for home, `/<slug>` or `/fr/<slug>` otherwise
  - `resolveLinks(el: El, lang: Lang): El` deep-clones and rewrites every `link.destination.value` of the form `page:<key>` to `pageUrl`
- Produces in `media.ts`:
  - `type MediaFile = { key: string; hash: string; ext: string; sourcePath: string; alt: string }`
  - `class MediaRegistry { add(key: string, sourcePath: string, alt?: string): MediaFile; icon(name: string): MediaFile; get(key: string): MediaFile; all(): MediaFile[] }` where `hash` is sha1 hex of the file contents, first 12 chars; `icon(name)` reads `node_modules/line-awesome/svg/<name>-solid.svg` and falls back to `<name>.svg`, registering key `icon:<name>`
  - `resolveMedia(el: El, reg: MediaRegistry): El` deep-clones and replaces every `{ $$type: "media-hash", value: "<key>" }` with `{ $$type: "media-hash", value: "<hash>" }`, throwing on an unknown key

- [ ] **Step 1: Write failing tests**

`pages.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { button } from "./dsl";
import { PAGES, pageUrl, resolveLinks } from "./pages";

describe("pages", () => {
  test("urls per language", () => {
    expect(pageUrl("home", "en")).toBe("/");
    expect(pageUrl("home", "fr")).toBe("/fr/");
    expect(pageUrl("families", "en")).toBe("/for-families");
    expect(pageUrl("families", "fr")).toBe("/fr/pour-les-familles");
  });
  test("every page has both languages", () => {
    for (const p of Object.values(PAGES)) { expect(p.slug.en).toBeDefined(); expect(p.slug.fr).toBeDefined(); expect(p.title.fr).toBeDefined(); }
  });
  test("resolveLinks rewrites page: links and leaves absolute ones", () => {
    const b = button("x", { title: "x", text: "x", link: "page:safety" });
    expect((resolveLinks(b, "fr").settings.link as any).value.destination.value).toBe("/fr/securite-et-confiance");
    expect((b.settings.link as any).value.destination.value).toBe("page:safety");
    const a = button("y", { title: "y", text: "y", link: "https://app.poppynz.com/auth/sign-up" });
    expect((resolveLinks(a, "en").settings.link as any).value.destination.value).toBe("https://app.poppynz.com/auth/sign-up");
  });
});
```

`media.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { svg } from "./dsl";
import { MediaRegistry, resolveMedia } from "./media";

describe("media", () => {
  test("registers a design asset with a content hash", () => {
    const reg = new MediaRegistry();
    const f = reg.add("logo-mark", "../../design/assets/logo-mark.svg", "Poppynz");
    expect(f.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(f.ext).toBe("svg");
    expect(reg.get("logo-mark")).toBe(f);
  });
  test("icons come from line-awesome solid set", () => {
    const reg = new MediaRegistry();
    const f = reg.icon("check");
    expect(f.key).toBe("icon:check");
    expect(f.sourcePath).toMatch(/line-awesome\/svg\/check-solid\.svg$/);
    expect(() => reg.icon("not-an-icon-xyz")).toThrow(/not-an-icon-xyz/);
  });
  test("resolveMedia swaps keys for hashes", () => {
    const reg = new MediaRegistry(); reg.icon("check");
    const el = resolveMedia(svg("s", { title: "s", icon: "icon:check" }), reg);
    expect((el.settings.svg as any).value.id.value).toBe(reg.get("icon:check").hash);
    expect(() => resolveMedia(svg("t", { title: "t", icon: "icon:missing" }), reg)).toThrow(/icon:missing/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/pages.test.ts src/media.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `content/types.ts`**

```ts
export type Lang = "en" | "fr";
export const LANGS: Lang[] = ["en", "fr"];
export type Localized<T> = Record<Lang, T>;

function paths(obj: unknown, prefix = ""): string[] {
  if (Array.isArray(obj)) return obj.flatMap((v, i) => paths(v, `${prefix}[${i}]`));
  if (obj && typeof obj === "object") return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}

export function assertLocalizedKeys(obj: Localized<Record<string, unknown>>, where: string): void {
  const en = new Set(paths(obj.en)), fr = new Set(paths(obj.fr));
  const missingFr = [...en].filter((p) => !fr.has(p)), missingEn = [...fr].filter((p) => !en.has(p));
  if (missingFr.length || missingEn.length) {
    throw new Error(`${where}: content keys differ between languages\n  missing in fr: ${missingFr.join(", ") || "-"}\n  missing in en: ${missingEn.join(", ") || "-"}`);
  }
}
```

- [ ] **Step 4: Implement `pages.ts`**

```ts
import type { Lang, Localized } from "./content/types";
import type { El } from "./dsl";

export type PageKey = "home" | "families" | "helpers" | "safety" | "daycare" | "blog" | "privacy" | "terms" | "agreement";

export const PAGES: Record<PageKey, { slug: Localized<string>; title: Localized<string> }> = {
  home: { slug: { en: "", fr: "" }, title: { en: "Home", fr: "Accueil" } },
  families: { slug: { en: "for-families", fr: "pour-les-familles" }, title: { en: "For families", fr: "Pour les familles" } },
  helpers: { slug: { en: "for-helpers", fr: "pour-les-aides" }, title: { en: "For helpers", fr: "Pour les aides" } },
  safety: { slug: { en: "safety-and-trust", fr: "securite-et-confiance" }, title: { en: "Safety & trust", fr: "Sécurité et confiance" } },
  daycare: { slug: { en: "daycare-matching", fr: "jumelage-garderie" }, title: { en: "Daycare matching", fr: "Jumelage garderie" } },
  blog: { slug: { en: "blog", fr: "blogue" }, title: { en: "Blog", fr: "Blogue" } },
  privacy: { slug: { en: "privacy-policy", fr: "politique-de-confidentialite" }, title: { en: "Privacy Policy", fr: "Politique de confidentialité" } },
  terms: { slug: { en: "terms-of-service", fr: "conditions-d-utilisation" }, title: { en: "Terms of Service", fr: "Conditions d’utilisation" } },
  agreement: { slug: { en: "service-agreement", fr: "entente-de-service" }, title: { en: "Service Agreement", fr: "Entente de service" } },
};

export const APP = { signUp: "https://app.poppynz.com/auth/sign-up", signIn: "https://app.poppynz.com/auth/sign-in" };

export function pageUrl(key: PageKey, lang: Lang): string {
  const slug = PAGES[key].slug[lang];
  const prefix = lang === "en" ? "" : "/fr";
  return slug ? `${prefix}/${slug}` : `${prefix}/`;
}

export function resolveLinks(el: El, lang: Lang): El {
  const out: El = structuredClone(el);
  const walk = (node: El) => {
    const link = node.settings.link as { value?: { destination?: { value: string } } } | undefined;
    const dest = link?.value?.destination;
    if (dest && dest.value.startsWith("page:")) {
      const key = dest.value.slice(5) as PageKey;
      if (!PAGES[key]) throw new Error(`resolveLinks(): unknown page key "${key}" on ${node.editor_settings.title}`);
      dest.value = pageUrl(key, lang);
    }
    node.elements.forEach(walk);
  };
  walk(out);
  return out;
}
```

- [ ] **Step 5: Implement `media.ts`**

```ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { El } from "./dsl";

export type MediaFile = { key: string; hash: string; ext: string; sourcePath: string; alt: string };

const HERE = import.meta.dir; // apps/landing-page/builder/src

export class MediaRegistry {
  private files = new Map<string, MediaFile>();

  add(key: string, sourcePath: string, alt = ""): MediaFile {
    const abs = resolve(HERE, sourcePath);
    if (!existsSync(abs)) throw new Error(`media "${key}": file not found ${abs}`);
    const hash = createHash("sha1").update(readFileSync(abs)).digest("hex").slice(0, 12);
    const f: MediaFile = { key, hash, ext: extname(abs).slice(1).toLowerCase(), sourcePath: abs, alt };
    this.files.set(key, f);
    return f;
  }

  icon(name: string): MediaFile {
    const key = `icon:${name}`;
    const existing = this.files.get(key);
    if (existing) return existing;
    const dir = resolve(HERE, "../node_modules/line-awesome/svg");
    for (const candidate of [`${name}-solid.svg`, `${name}.svg`]) {
      if (existsSync(resolve(dir, candidate))) return this.add(key, resolve(dir, candidate), "");
    }
    throw new Error(`icon "${name}" not found in line-awesome (tried ${name}-solid.svg, ${name}.svg)`);
  }

  get(key: string): MediaFile {
    const f = this.files.get(key);
    if (!f) throw new Error(`media key "${key}" is not registered`);
    return f;
  }

  all(): MediaFile[] { return [...this.files.values()]; }
}

export function resolveMedia(el: El, reg: MediaRegistry): El {
  const out = structuredClone(el);
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (o.$$type === "media-hash" && typeof o.value === "string" && !/^[0-9a-f]{12}$/.test(o.value)) o.value = reg.get(o.value).hash;
      Object.values(o).forEach(walk);
    }
  };
  walk(out);
  return out;
}
```

- [ ] **Step 6: Run tests**

Run: `bun test src/pages.test.ts src/media.test.ts`
Expected: PASS. (`media.test.ts` needs `bun install` to have run so `node_modules/line-awesome` exists.)

- [ ] **Step 7: Commit**

```bash
git add apps/landing-page/builder/src/pages.ts apps/landing-page/builder/src/pages.test.ts apps/landing-page/builder/src/media.ts apps/landing-page/builder/src/media.test.ts apps/landing-page/builder/src/content/types.ts
git commit -m "feat(landing): page map, link resolution and media registry"
```

---

### Task 7: Bilingual content for header, footer and Home

**Files:**
- Create: `apps/landing-page/builder/src/content/header.ts`
- Create: `apps/landing-page/builder/src/content/footer.ts`
- Create: `apps/landing-page/builder/src/content/home.ts`
- Create: `apps/landing-page/builder/src/content/content.test.ts`

**Interfaces:**
- Consumes: `Localized`, `assertLocalizedKeys` from `content/types.ts`; `PageKey` from `pages.ts`.
- Produces: `HEADER: Localized<HeaderContent>`, `FOOTER: Localized<FooterContent>`, `HOME: Localized<HomeContent>` with the types below. Recipes in Task 8 read only these objects; copy changes never touch recipes.

- [ ] **Step 1: Write the failing test**

`content/content.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { FOOTER } from "./footer";
import { HEADER } from "./header";
import { HOME } from "./home";
import { assertLocalizedKeys } from "./types";

describe("content", () => {
  test("header, footer, home have identical key sets in en and fr", () => {
    expect(() => assertLocalizedKeys(HEADER as any, "header")).not.toThrow();
    expect(() => assertLocalizedKeys(FOOTER as any, "footer")).not.toThrow();
    expect(() => assertLocalizedKeys(HOME as any, "home")).not.toThrow();
  });
  test("home has 4 steps, 8 services, 3 quotes, 5 cities in both languages", () => {
    for (const l of ["en", "fr"] as const) {
      expect(HOME[l].steps).toHaveLength(4);
      expect(HOME[l].services).toHaveLength(8);
      expect(HOME[l].quotes).toHaveLength(3);
      expect(HOME[l].cities).toHaveLength(5);
    }
  });
  test("nav links use page keys", () => {
    for (const item of HEADER.en.nav) expect(item.page).toMatch(/^(families|helpers|safety|daycare|blog)$/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/content/content.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `content/header.ts`**

```ts
import type { PageKey } from "../pages";
import type { Localized } from "./types";

export type HeaderContent = {
  brand: string;
  nav: { page: PageKey; label: string; badge?: string }[];
  signIn: string;
  getStarted: string;
  langLabels: { en: string; fr: string };
};

export const HEADER: Localized<HeaderContent> = {
  en: {
    brand: "poppynz",
    nav: [
      { page: "families", label: "For families" },
      { page: "helpers", label: "For helpers" },
      { page: "safety", label: "Safety & trust" },
      { page: "daycare", label: "Daycare", badge: "New" },
      { page: "blog", label: "Blog" },
    ],
    signIn: "Sign in",
    getStarted: "Get started",
    langLabels: { en: "EN", fr: "FR" },
  },
  fr: {
    brand: "poppynz",
    nav: [
      { page: "families", label: "Pour les familles" },
      { page: "helpers", label: "Pour les aides" },
      { page: "safety", label: "Sécurité et confiance" },
      { page: "daycare", label: "Garderie", badge: "Nouveau" },
      { page: "blog", label: "Blogue" },
    ],
    signIn: "Connexion",
    getStarted: "Commencer",
    langLabels: { en: "EN", fr: "FR" },
  },
};
```

- [ ] **Step 4: Write `content/footer.ts`**

```ts
import type { PageKey } from "../pages";
import type { Localized } from "./types";

export type FooterLink = { label: string; page?: PageKey; url?: string };
export type FooterContent = {
  tagline: string;
  trust: string;
  email: string;
  columns: { heading: string; links: FooterLink[] }[];
  copyright: string;
  prices: string;
};

export const FOOTER: Localized<FooterContent> = {
  en: {
    tagline: "Vetted Mom Helpers for Canadian families. Trust runs both ways.",
    trust: "Background-checked · PIPEDA-compliant · End-to-end encrypted",
    email: "support@poppynz.com",
    columns: [
      { heading: "Poppynz", links: [
        { label: "For families", page: "families" }, { label: "For helpers", page: "helpers" },
        { label: "Safety & trust", page: "safety" }, { label: "Daycare matching", page: "daycare" }, { label: "Blog", page: "blog" } ] },
      { heading: "Support", links: [
        { label: "Sign in", url: "https://app.poppynz.com/auth/sign-in" }, { label: "Contact", url: "mailto:support@poppynz.com" } ] },
      { heading: "Legal", links: [
        { label: "Privacy Policy", page: "privacy" }, { label: "Terms of Service", page: "terms" }, { label: "Service Agreement", page: "agreement" } ] },
    ],
    copyright: "© 2026 Poppynz Inc. · Made with care in Toronto, ON",
    prices: "Prices in CAD",
  },
  fr: {
    tagline: "Des aides familiales vérifiées pour les familles canadiennes. La confiance va dans les deux sens.",
    trust: "Vérification des antécédents · Conforme à la LPRPDE · Chiffrement de bout en bout",
    email: "support@poppynz.com",
    columns: [
      { heading: "Poppynz", links: [
        { label: "Pour les familles", page: "families" }, { label: "Pour les aides", page: "helpers" },
        { label: "Sécurité et confiance", page: "safety" }, { label: "Jumelage garderie", page: "daycare" }, { label: "Blogue", page: "blog" } ] },
      { heading: "Soutien", links: [
        { label: "Connexion", url: "https://app.poppynz.com/auth/sign-in" }, { label: "Nous joindre", url: "mailto:support@poppynz.com" } ] },
      { heading: "Mentions légales", links: [
        { label: "Politique de confidentialité", page: "privacy" }, { label: "Conditions d’utilisation", page: "terms" }, { label: "Entente de service", page: "agreement" } ] },
    ],
    copyright: "© 2026 Poppynz Inc. · Conçu avec soin à Toronto (Ontario)",
    prices: "Prix en CAD",
  },
};
```

- [ ] **Step 5: Write `content/home.ts`**

Copy is the English text of `apps/landing-page/design/index.html`. Icon names are Line Awesome names without the `la-` prefix. Service illustrations are files under `design/assets/services/`.

```ts
import type { Localized } from "./types";

export type HomeContent = {
  hero: {
    eyebrow: string; title: string; titleHighlight: string; lead: string;
    cardLeft: { title: string; text: string; cta: string }; cardRight: { title: string; text: string; cta: string };
    trust: string; floatCard: { initial: string; name: string; meta: string; vetted: string };
    video: { src: string; poster: string };
  };
  how: { eyebrow: string; title: string; lead: string };
  steps: { n: string; icon: string; title: string; text: string }[];
  safety: {
    eyebrow: string; title: string;
    helpers: { title: string; checks: string[]; optional: string; credibled: string };
    reviewed: { title: string; p1: string; p2: string; note: string };
    families: { title: string; text: string; link: string };
  };
  servicesHeader: { eyebrow: string; title: string; lead: string };
  services: { file: string; name: string; text: string }[];
  quotes: { initial: string; text: string; who: string }[];
  neighbourhood: { eyebrow: string; title: string; lead: string; next: string; note: string; alt: string };
  cities: string[];
  helpers: { eyebrow: string; title: string; titleAccent: string; titleTail: string; lead: string; ctaPrimary: string; ctaSecondary: string; alt: string };
  cta: { title: string; text: string; find: string; become: string };
};
```

Then the two objects. English:

```ts
const en: HomeContent = {
  hero: {
    eyebrow: "On-demand Family Support",
    title: "Your Family’s", titleHighlight: "Perfect Helper",
    lead: "Connecting busy families with certified Mom Helpers for childcare, meal prep, housekeeping, and more, all background-verified and ready to lend a hand.",
    cardLeft: { title: "I need help", text: "Browse verified Mom Helpers in your area and find the perfect fit for your family.", cta: "Find a helper" },
    cardRight: { title: "I want to help", text: "Set your own services and rates, and support families in your community.", cta: "Become a helper" },
    trust: "Background-checked helpers · PIPEDA-compliant · End-to-end encrypted",
    floatCard: { initial: "M", name: "Maria O.", meta: "Childcare · $28/hr · 1.2 km", vetted: "Vetted" },
    video: { src: "https://videos.pexels.com/video-files/7102352/7102352-hd_1920_1080_30fps.mp4", poster: "https://images.pexels.com/videos/7102352/art-beads-beads-bracelets-building-blocks-7102352.jpeg?auto=compress&w=1260" },
  },
  how: { eyebrow: "How It Works", title: "Getting Started Is Simple", lead: "Here’s how you can find the perfect Mom Helper for your family, no bidding, no surge pricing, just a clear hourly rate agreed in writing." },
  steps: [
    { n: "01", icon: "clipboard-list", title: "Create Your Account", text: "Sign up as a family with a magic link and tell us about your household and care needs. A quick safety check lets helpers know you’re verified too." },
    { n: "02", icon: "map-marked-alt", title: "Find Your Perfect Helper", text: "Browse profiles of verified Mom Helpers in your area, photo, bio, services with hourly rates, distance, and the Vetted badge." },
    { n: "03", icon: "file-signature", title: "Schedule Your Service", text: "Connect with your helper, book on-demand or regular help, and put the details into a simple written agreement." },
    { n: "04", icon: "stopwatch", title: "Simple Payment", text: "Enjoy secure, automated payments after each session based on the helper’s rate, plus a 5% service fee. That’s it!" },
  ],
  safety: {
    eyebrow: "Trusted Care, Both Ways",
    title: "Peace of mind for families, and dignity for helpers. Every Mom Helper is verified before you can find them, and every family is verified before helpers can find you.",
    helpers: { title: "Verified Helpers", checks: ["Government photo ID", "Vulnerable Sector Check", "Enhanced criminal record check"], optional: "Optional: First Aid, ECE, PSW credentials", credibled: "Record checks fetched through our partner <strong>Credibled</strong>" },
    reviewed: { title: "Reviewed by Real People", p1: "Before a helper appears in search, a member of the Poppynz team personally reviews their documents. Automated checks help us along, but a real person makes the call.", p2: "Know someone who’d make a great Mom Helper? Members can refer them, and referrals go through the very same review.", note: "PIPEDA-compliant · End-to-end encrypted messaging" },
    families: { title: "Verified Families", text: "Before a helper can see your profile, you’ll complete a short safety check. That way, helpers only ever hear from verified families.", link: "Learn about our safety checks" },
  },
  servicesHeader: { eyebrow: "What We Offer", title: "Support for Every Part of Family Life", lead: "Mom Helpers list the services they offer along with their hourly rate. Need something a little different? Helpers can offer custom services too." },
  services: [
    { file: "childcare", name: "Childcare", text: "Quality care for your children in your home, tailored to their age and interests." },
    { file: "tutoring", name: "Tutoring", text: "Academic support and homework help for students of all ages." },
    { file: "elderly-check-in", name: "Elderly check-in", text: "Compassionate check-ins for elderly family members, for peace of mind." },
    { file: "pet-minding", name: "Pet minding", text: "Caring attention for your furry family members, feeding, walking, and playtime." },
    { file: "meal-preparation", name: "Meal preparation", text: "Nutritious meals prepared fresh in your kitchen, to your family’s tastes." },
    { file: "light-housekeeping", name: "Light housekeeping", text: "Keeping your living space tidy, from vacuuming to laundry and dishes." },
    { file: "yard-help", name: "Yard help", text: "From weeding to light clean-ups, we keep your yard neat and tidy." },
    { file: "packages", name: "Small errands", text: "Out when a delivery arrives? Helpers bring in packages, water plants, and take out the rubbish!" },
  ],
  quotes: [
    { initial: "SJ", text: "“The daycare matching service helped us find a spot within a week after months of searching on our own. Worth every penny!”", who: "Sarah Johnson · Working Mom" },
    { initial: "ER", text: "“The daycare matching service helped us find a spot within a week after months of searching on our own. Worth every penny!”", who: "Emma Rodriguez · Parent of Three" },
    { initial: "MC", text: "“The meal prep service has been a game-changer for our busy household. I can finally enjoy quality time with my kids without stressing about dinner.”", who: "Michael Chen · Single Dad" },
  ],
  neighbourhood: { eyebrow: "Poppynz in Your Neighbourhood", title: "Trusted Help, Right Around the Corner", lead: "We match you with Mom Helpers by distance, so the person watering your plants or walking your dog is usually just a few blocks away, a trusted neighbour, ready when you need them.", next: "Your city next?", note: "All prices in CAD. Data handled under PIPEDA.", alt: "Front porch, residential Canadian street" },
  cities: ["Mississauga", "Toronto", "Ottawa", "Calgary", "Vancouver"],
  helpers: { eyebrow: "For helpers", title: "Earn Flexibly.", titleAccent: "Support", titleTail: "Your Community.", lead: "Become a Mom Helper and earn income on your own schedule. Set your services and hourly rate in CAD, work when and where you choose, and keep 85% of what you earn. Experienced helpers can grow into Major-domo status.", ctaPrimary: "Become a helper", ctaSecondary: "See what’s required", alt: "Tutor and student at a kitchen table" },
  cta: { title: "Ready to Find Your Perfect Helper?", text: "Join Poppynz today and connect with certified Mom Helpers in your area. Sign in with a magic link, no password needed.", find: "Find a helper", become: "Become a helper" },
};
```

French:

```ts
const fr: HomeContent = {
  hero: {
    eyebrow: "Soutien familial à la demande",
    title: "L’aide idéale pour", titleHighlight: "votre famille",
    lead: "Nous mettons en contact les familles occupées avec des aides familiales certifiées pour la garde d’enfants, la préparation des repas, l’entretien ménager et plus encore, toutes vérifiées et prêtes à donner un coup de main.",
    cardLeft: { title: "J’ai besoin d’aide", text: "Parcourez les aides familiales vérifiées de votre quartier et trouvez la personne idéale pour votre famille.", cta: "Trouver une aide" },
    cardRight: { title: "Je veux aider", text: "Définissez vos services et vos tarifs, et soutenez les familles de votre communauté.", cta: "Devenir aide familiale" },
    trust: "Aides vérifiées · Conforme à la LPRPDE · Chiffrement de bout en bout",
    floatCard: { initial: "M", name: "Maria O.", meta: "Garde d’enfants · 28 $/h · 1,2 km", vetted: "Vérifiée" },
    video: { src: "https://videos.pexels.com/video-files/7102352/7102352-hd_1920_1080_30fps.mp4", poster: "https://images.pexels.com/videos/7102352/art-beads-beads-bracelets-building-blocks-7102352.jpeg?auto=compress&w=1260" },
  },
  how: { eyebrow: "Comment ça marche", title: "Commencer, c’est simple", lead: "Voici comment trouver l’aide familiale idéale pour votre famille : pas d’enchères, pas de tarification dynamique, juste un tarif horaire clair convenu par écrit." },
  steps: [
    { n: "01", icon: "clipboard-list", title: "Créez votre compte", text: "Inscrivez-vous comme famille avec un lien magique et parlez-nous de votre foyer et de vos besoins. Une courte vérification de sécurité indique aux aides que vous êtes vérifiés aussi." },
    { n: "02", icon: "map-marked-alt", title: "Trouvez l’aide idéale", text: "Parcourez les profils d’aides familiales vérifiées près de chez vous : photo, bio, services et tarifs horaires, distance et badge Vérifiée." },
    { n: "03", icon: "file-signature", title: "Planifiez le service", text: "Entrez en contact avec votre aide, réservez une aide ponctuelle ou régulière, et consignez les détails dans une entente écrite simple." },
    { n: "04", icon: "stopwatch", title: "Paiement simple", text: "Profitez de paiements sécurisés et automatisés après chaque séance, selon le tarif de l’aide, plus des frais de service de 5 %. C’est tout!" },
  ],
  safety: {
    eyebrow: "Une confiance réciproque",
    title: "La tranquillité d’esprit pour les familles, la dignité pour les aides. Chaque aide familiale est vérifiée avant d’apparaître dans vos résultats, et chaque famille est vérifiée avant que les aides puissent la trouver.",
    helpers: { title: "Aides vérifiées", checks: ["Pièce d’identité gouvernementale avec photo", "Vérification du secteur vulnérable", "Vérification approfondie du casier judiciaire"], optional: "Facultatif : premiers soins, ÉPE, PSSP", credibled: "Vérifications obtenues auprès de notre partenaire <strong>Credibled</strong>" },
    reviewed: { title: "Révisé par de vraies personnes", p1: "Avant qu’une aide apparaisse dans la recherche, un membre de l’équipe Poppynz examine personnellement ses documents. Les vérifications automatisées nous aident, mais c’est une personne qui décide.", p2: "Vous connaissez quelqu’un qui ferait une excellente aide familiale? Les membres peuvent le recommander, et les recommandations passent par la même révision.", note: "Conforme à la LPRPDE · Messagerie chiffrée de bout en bout" },
    families: { title: "Familles vérifiées", text: "Avant qu’une aide puisse voir votre profil, vous effectuez une courte vérification de sécurité. Ainsi, les aides n’entendent parler que de familles vérifiées.", link: "En savoir plus sur nos vérifications" },
  },
  servicesHeader: { eyebrow: "Ce que nous offrons", title: "Un soutien pour chaque facette de la vie de famille", lead: "Les aides familiales indiquent les services qu’elles offrent ainsi que leur tarif horaire. Besoin de quelque chose d’un peu différent? Elles peuvent aussi proposer des services sur mesure." },
  services: [
    { file: "childcare", name: "Garde d’enfants", text: "Des soins de qualité pour vos enfants, à la maison, adaptés à leur âge et à leurs intérêts." },
    { file: "tutoring", name: "Tutorat", text: "Soutien scolaire et aide aux devoirs pour les élèves de tous âges." },
    { file: "elderly-check-in", name: "Visites aux aînés", text: "Des visites bienveillantes auprès des membres âgés de la famille, pour votre tranquillité d’esprit." },
    { file: "pet-minding", name: "Garde d’animaux", text: "Une attention affectueuse pour vos compagnons à quatre pattes : repas, promenades et jeux." },
    { file: "meal-preparation", name: "Préparation des repas", text: "Des repas nutritifs préparés dans votre cuisine, au goût de votre famille." },
    { file: "light-housekeeping", name: "Entretien ménager léger", text: "Un espace de vie en ordre : aspirateur, lessive et vaisselle." },
    { file: "yard-help", name: "Aide au jardin", text: "Du désherbage au petit nettoyage, votre cour reste nette et soignée." },
    { file: "packages", name: "Petites courses", text: "Absent lors d’une livraison? Les aides rentrent les colis, arrosent les plantes et sortent les poubelles!" },
  ],
  quotes: [
    { initial: "SJ", text: "« Le service de jumelage garderie nous a trouvé une place en une semaine, après des mois de recherche. Ça vaut chaque dollar! »", who: "Sarah Johnson · Maman au travail" },
    { initial: "ER", text: "« Le service de jumelage garderie nous a trouvé une place en une semaine, après des mois de recherche. Ça vaut chaque dollar! »", who: "Emma Rodriguez · Mère de trois enfants" },
    { initial: "MC", text: "« La préparation des repas a changé la donne pour notre famille occupée. Je profite enfin de mes enfants sans stresser pour le souper. »", who: "Michael Chen · Père monoparental" },
  ],
  neighbourhood: { eyebrow: "Poppynz dans votre quartier", title: "Une aide de confiance, tout près de chez vous", lead: "Nous vous jumelons avec des aides familiales selon la distance : la personne qui arrose vos plantes ou promène votre chien habite souvent à quelques rues, une voisine de confiance, prête quand vous en avez besoin.", next: "Votre ville ensuite?", note: "Tous les prix en CAD. Données traitées selon la LPRPDE.", alt: "Perron d’une rue résidentielle canadienne" },
  cities: ["Mississauga", "Toronto", "Ottawa", "Calgary", "Vancouver"],
  helpers: { eyebrow: "Pour les aides", title: "Gagnez avec souplesse.", titleAccent: "Soutenez", titleTail: "votre communauté.", lead: "Devenez aide familiale et gagnez un revenu selon votre horaire. Définissez vos services et votre tarif horaire en CAD, travaillez quand et où vous le voulez, et conservez 85 % de vos gains. Les aides expérimentées peuvent accéder au statut de Major-domo.", ctaPrimary: "Devenir aide familiale", ctaSecondary: "Voir les conditions", alt: "Tutrice et élève à une table de cuisine" },
  cta: { title: "Prêt à trouver l’aide idéale?", text: "Rejoignez Poppynz dès aujourd’hui et entrez en contact avec des aides familiales certifiées près de chez vous. Connexion par lien magique, sans mot de passe.", find: "Trouver une aide", become: "Devenir aide familiale" },
};

export const HOME: Localized<HomeContent> = { en, fr };
```


- [ ] **Step 6: Run tests**

Run: `bun test src/content/content.test.ts`
Expected: PASS. If `assertLocalizedKeys` fails, fix the missing key in the language it names.

- [ ] **Step 7: Commit**

```bash
git add apps/landing-page/builder/src/content
git commit -m "feat(landing): bilingual content for header, footer and Home"
```

---

### Task 8: Recipes, artefact writer and `bun run build`

**Files:**
- Create: `apps/landing-page/builder/src/recipes/header.ts`, `footer.ts`, `home.ts`
- Create: `apps/landing-page/builder/src/emit/artefact.ts`, `artefact.test.ts`
- Modify: `apps/landing-page/builder/src/cli.ts`
- Create: `apps/landing-page/json-artefacts/.gitkeep`

**Interfaces:**
- Consumes: everything from Tasks 2 to 7.
- Produces:
  - `type Recipe = { kind: "page" | "header" | "footer"; key: string; build(lang: Lang, media: MediaRegistry): El[] }` in `dsl.ts` (add the type there)
  - `headerRecipe: Recipe`, `footerRecipe: Recipe`, `homeRecipe: Recipe`
  - `buildArtefact(opts: { outDir: string; recipes: Recipe[] }): Promise<ArtefactManifest>` in `emit/artefact.ts`
  - Artefact layout, consumed verbatim by `server/import.php` (Task 11):
    ```
    manifest.json    { builderVersion, elementorVersion: "4.2.4", builtAt: "<ISO>", entries: string[], media: {hash: {ext, alt, key}} }
    variables.json   [ { label, type, value } ]
    classes.json     [ { id, label, css: CssMap } ]
    media/<hash>.<ext>
    templates/header.en.json  { title: "Site header (en)", type: "type_header", lang, elements, _css }
    templates/footer.en.json  ... and .fr variants
    pages/home.en.json        { key: "home", lang, slug, title, elements, _css }
    ```
    `elements` carry hashes in `media-hash` props and resolved URLs in links; `_css` maps every local style id to its CssMap. `builtAt` is the only non-deterministic field and is excluded from the determinism test.

- [ ] **Step 1: Add the Recipe type to `dsl.ts`**

Append to `dsl.ts`:

```ts
import type { Lang } from "./content/types";
import type { MediaRegistry } from "./media";
export type Recipe = { kind: "page" | "header" | "footer"; key: string; build(lang: Lang, media: MediaRegistry): El[] };
```

(Place the imports at the top of the file; `MediaRegistry` is a type-only import so there is no cycle at runtime.)

- [ ] **Step 2: Write the failing artefact test**

`emit/artefact.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { footerRecipe } from "../recipes/footer";
import { headerRecipe } from "../recipes/header";
import { homeRecipe } from "../recipes/home";
import { buildArtefact } from "./artefact";

const strip = (dir: string) => {
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  delete m.builtAt;
  return JSON.stringify(m) + readdirSync(dir, { recursive: true }).sort().join("\n") +
    readFileSync(join(dir, "pages/home.en.json"), "utf8") + readFileSync(join(dir, "templates/header.fr.json"), "utf8");
};

describe("artefact", () => {
  test("writes every entry and is deterministic", async () => {
    const a = mkdtempSync(join(tmpdir(), "art-a-")), b = mkdtempSync(join(tmpdir(), "art-b-"));
    const m = await buildArtefact({ outDir: a, recipes: [headerRecipe, footerRecipe, homeRecipe] });
    await buildArtefact({ outDir: b, recipes: [headerRecipe, footerRecipe, homeRecipe] });
    expect(m.entries.sort()).toEqual(["pages/home.en.json", "pages/home.fr.json", "templates/footer.en.json", "templates/footer.fr.json", "templates/header.en.json", "templates/header.fr.json"]);
    expect(strip(a)).toBe(strip(b));
  });
  test("home page has resolved links and hashed media, and _css covers every local style", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    await buildArtefact({ outDir: dir, recipes: [homeRecipe] });
    const page = JSON.parse(readFileSync(join(dir, "pages/home.fr.json"), "utf8"));
    const s = JSON.stringify(page.elements);
    expect(s).not.toContain('"page:');
    expect(s).toContain('"/fr/securite-et-confiance"');
    expect(s).not.toMatch(/"media-hash","value":"(icon|media):/);
    const styleIds = [...s.matchAll(/"e-[0-9a-f]{7}-[0-9a-f]{7}"/g)].map((x) => x[0].replace(/"/g, ""));
    for (const id of new Set(styleIds)) expect(page._css[id]).toBeDefined();
    expect(readdirSync(join(dir, "media")).length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test src/emit/artefact.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `recipes/header.ts`**

```ts
import { HEADER } from "../content/header";
import type { Lang } from "../content/types";
import { block, flex, image, text, type El, type Recipe } from "../dsl";
import type { MediaRegistry } from "../media";
import { APP } from "../pages";

export function langSwitch(path: string, lang: Lang, labels: { en: string; fr: string }): El {
  // Each item links to the same page in the other language; Polylang redirects "/" and "/fr/" to the right front page.
  const item = (l: Lang) => text(`${path}/${l}`, { title: labels[l], tag: "span", classes: ["lang-item", ...(l === lang ? ["lang-on"] : [])], text: labels[l], link: l === "en" ? "/" : "/fr/" });
  return flex(path, { title: "Language", classes: ["lang"] }, [item("en"), item("fr")]);
}

export const headerRecipe: Recipe = {
  kind: "header", key: "header",
  build(lang, media) {
    const c = HEADER[lang];
    media.add("logo-mark", "../../design/assets/logo-mark.svg", "Poppynz");
    const nav = c.nav.map((item) => flex(`header/nav/${item.page}`, { title: item.label, tag: "a", classes: ["nav-link"], link: `page:${item.page}` }, [
      text(`header/nav/${item.page}/label`, { title: item.label, tag: "span", text: item.label }),
      ...(item.badge ? [text(`header/nav/${item.page}/badge`, { title: "Badge", tag: "span", classes: ["badge-new", "anim-wiggle-badge"], text: item.badge })] : []),
    ]));
    return [flex("header", { title: `Header (${lang})`, tag: "header", classes: ["hdr"] }, [
      flex("header/brand", { title: "Brand", tag: "a", classes: ["brand"], link: "page:home" }, [
        image("header/brand/mark", { title: "Logo mark", classes: ["brand-mark"], media: "logo-mark", alt: "" }),
        text("header/brand/name", { title: "Brand name", tag: "span", text: c.brand }),
      ]),
      flex("header/nav", { title: "Nav", classes: ["hdr-nav"] }, nav),
      flex("header/actions", { title: "Actions", classes: ["hdr-actions"] }, [
        langSwitch("header/lang", lang, c.langLabels),
        text("header/signin", { title: c.signIn, tag: "span", classes: ["signin"], text: c.signIn, link: APP.signIn }),
        text("header/getstarted", { title: c.getStarted, tag: "span", classes: ["getstarted"], text: c.getStarted, link: APP.signUp }),
      ]),
    ])];
  },
};
```

- [ ] **Step 5: Write `recipes/footer.ts`**

```ts
import { FOOTER } from "../content/footer";
import { flex, image, svg, text, type Recipe } from "../dsl";
import { langSwitch } from "./header";
import { HEADER } from "../content/header";

export const footerRecipe: Recipe = {
  kind: "footer", key: "footer",
  build(lang, media) {
    const c = FOOTER[lang];
    media.add("logo-mark", "../../design/assets/logo-mark.svg", "Poppynz");
    media.icon("shield-alt"); media.icon("heart");
    const cols = c.columns.map((col, i) => flex(`footer/col/${i}`, { title: col.heading, classes: ["ftr-col"] }, [
      text(`footer/col/${i}/h`, { title: col.heading, tag: "span", classes: ["label"], text: col.heading }),
      ...col.links.map((l, j) => text(`footer/col/${i}/${j}`, { title: l.label, tag: "span", classes: ["ftr-link"], text: l.label, link: l.page ? `page:${l.page}` : l.url! })),
    ]));
    return [flex("footer", { title: `Footer (${lang})`, tag: "footer", classes: ["ftr"], css: { desktop: "flex-direction:column;gap:0" } }, [
      flex("footer/grid", { title: "Columns", classes: ["ftr-grid"], css: { desktop: "display:grid" } }, [
        flex("footer/brand", { title: "Brand", classes: ["stack-16"] }, [
          flex("footer/brand/link", { title: "Brand", tag: "a", classes: ["brand"], link: "page:home" }, [
            image("footer/brand/mark", { title: "Logo mark", classes: ["brand-mark"], media: "logo-mark", alt: "" }),
            text("footer/brand/name", { title: "Brand name", tag: "span", text: HEADER[lang].brand }),
          ]),
          text("footer/tagline", { title: "Tagline", classes: ["muted-14"], css: { desktop: "max-width:320px" }, text: c.tagline }),
          flex("footer/trust", { title: "Trust line", classes: ["trust"] }, [
            svg("footer/trust/icon", { title: "Shield", classes: ["icon-18", "icon-teal"], icon: "icon:shield-alt" }),
            text("footer/trust/text", { title: "Trust", tag: "span", classes: ["muted-13"], text: c.trust }),
          ]),
          text("footer/email", { title: "Email", tag: "span", classes: ["ftr-link"], text: c.email, link: `mailto:${c.email}` }),
        ]),
        ...cols,
      ]),
      flex("footer/bottom", { title: "Bottom bar", classes: ["ftr-bottom"] }, [
        flex("footer/bottom/copy", { title: "Copyright", css: { desktop: "align-items:center;gap:6px;flex-wrap:wrap" } }, [
          text("footer/bottom/copy/text", { title: "Copyright", tag: "span", classes: ["muted-13"], text: c.copyright }),
          svg("footer/bottom/heart", { title: "Heart", classes: ["icon-18", "icon-magenta", "anim-beat"], icon: "icon:heart" }),
          text("footer/bottom/prices", { title: "Prices", tag: "span", classes: ["muted-13"], text: `· ${c.prices}` }),
        ]),
        langSwitch("footer/lang", lang, HEADER[lang].langLabels),
      ]),
    ])];
  },
};
```

- [ ] **Step 6: Write `recipes/home.ts`**

```ts
import { HOME } from "../content/home";
import { block, button, flex, grid, heading, image, svg, text, video, type El, type Recipe } from "../dsl";
import { APP } from "../pages";

const eyebrow = (path: string, label: string, light = false) =>
  flex(path, { title: "Eyebrow", classes: [light ? "eyebrow-light" : "eyebrow"] }, [
    block(`${path}/dash`, { title: "Dash", classes: ["dash", "anim-wiggle"] }, []),
    text(`${path}/label`, { title: label, tag: "span", text: label }),
  ]);

const icon = (path: string, name: string, cls: string[]) => svg(path, { title: name, classes: cls, icon: `icon:${name}` });

export const homeRecipe: Recipe = {
  kind: "page", key: "home",
  build(lang, media) {
    const c = HOME[lang];
    for (const n of ["search", "hand-holding-heart", "arrow-right", "shield-alt", "check-circle", "clipboard-list", "map-marked-alt", "file-signature", "stopwatch", "id-card", "check", "plus", "user-shield", "lock", "home", "smile-wink", "map-marker", "star", "heart"]) media.icon(n);
    for (const s of c.services) media.add(`svc:${s.file}`, `../../design/assets/services/${s.file}.webp`, s.name);

    const heroCard = (path: string, side: "l" | "r", card: { title: string; text: string; cta: string }, iconName: string) =>
      flex(path, { title: card.title, tag: "a", classes: ["hero-card", side === "l" ? "hero-card-l" : "hero-card-r"], link: APP.signUp }, [
        flex(`${path}/bubble`, { title: "Icon", classes: ["bubble", "bubble-40"] }, [icon(`${path}/icon`, iconName, ["icon-20", "icon-teal", ...(side === "r" ? ["anim-wave"] : [])])]),
        text(`${path}/t`, { title: "Title", tag: "span", classes: ["hero-card-title"], text: card.title }),
        text(`${path}/d`, { title: "Text", tag: "span", classes: ["hero-card-text"], text: card.text }),
        flex(`${path}/go`, { title: "CTA", classes: [side === "l" ? "go-sky" : "go-navy"] }, [
          text(`${path}/go/t`, { title: card.cta, tag: "span", text: card.cta }),
          icon(`${path}/go/i`, "arrow-right", ["icon-18", "icon-white", "anim-bob"]),
        ]),
      ]);

    const hero = flex("home/hero", { title: "Hero", tag: "section", classes: ["hero"], css: { desktop: "display:grid" } }, [
      block("home/hero/deco", { title: "Decorations", classes: ["deco"] }, [
        block("home/hero/deco/1", { title: "Dot", classes: ["deco-d1", "anim-drift"] }, []),
        block("home/hero/deco/2", { title: "Dot", classes: ["deco-d2", "anim-drift-rev"] }, []),
        icon("home/hero/deco/3", "star", ["deco-d3", "anim-twinkle"]),
        block("home/hero/deco/4", { title: "Ring", classes: ["deco-d4", "anim-drift-slow"] }, []),
        icon("home/hero/deco/5", "heart", ["deco-d5", "anim-bob"]),
      ]),
      flex("home/hero/copy", { title: "Copy", classes: ["hero-copy"], interaction: { trigger: "load", effect: "slide", direction: "bottom", durationMs: 700 } }, [
        eyebrow("home/hero/eyebrow", c.hero.eyebrow),
        heading("home/hero/h1", { title: "H1", tag: "h1", classes: ["h1", "hl-wavy"], text: `${c.hero.title} <em>${c.hero.titleHighlight}</em>` }),
        text("home/hero/lead", { title: "Lead", classes: ["lead-lg"], text: c.hero.lead }),
        grid("home/hero/cards", { title: "Choice cards", css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px;max-width:580px" } }, [
          heroCard("home/hero/cards/l", "l", c.hero.cardLeft, "search"),
          heroCard("home/hero/cards/r", "r", c.hero.cardRight, "hand-holding-heart"),
        ]),
        flex("home/hero/trust", { title: "Trust line", classes: ["trust"] }, [icon("home/hero/trust/i", "shield-alt", ["icon-18", "icon-teal"]), text("home/hero/trust/t", { title: "Trust", tag: "span", text: c.hero.trust })]),
      ]),
      block("home/hero/media", { title: "Video", classes: ["media-box"] }, [
        video("home/hero/video", { title: "Hero video", css: { desktop: "width:100%;height:100%;object-fit:cover" }, url: c.hero.video.src }),
        flex("home/hero/float", { title: "Floating card", classes: ["float-card", "anim-float"] }, [
          text("home/hero/float/av", { title: "Avatar", tag: "span", classes: ["avatar"], text: c.hero.floatCard.initial }),
          flex("home/hero/float/lines", { title: "Lines", css: { desktop: "flex-direction:column;gap:3px" } }, [
            text("home/hero/float/name", { title: "Name", tag: "span", css: { desktop: "font-family:var(--font-display);font-weight:700;font-size:15px;color:var(--ink)" }, text: c.hero.floatCard.name }),
            text("home/hero/float/meta", { title: "Meta", tag: "span", classes: ["muted-13"], text: c.hero.floatCard.meta }),
          ]),
          flex("home/hero/float/vetted", { title: "Vetted", classes: ["vetted"], interaction: { trigger: "load", effect: "scale", delayMs: 400 } }, [icon("home/hero/float/vetted/i", "check-circle", ["icon-18", "icon-ok"]), text("home/hero/float/vetted/t", { title: "Vetted", tag: "span", text: c.hero.floatCard.vetted })]),
        ]),
      ]),
    ]);

    const steps = flex("home/how", { title: "How it works", tag: "section", classes: ["band"] }, [
      grid("home/how/wrap", { title: "Wrap", classes: ["wrap"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:clamp(32px,5vw,64px);padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px);align-items:start" } }, [
        flex("home/how/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:420px" } }, [
          text("home/how/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.how.eyebrow }),
          heading("home/how/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.how.title }),
          text("home/how/lead", { title: "Lead", classes: ["lead"], text: c.how.lead }),
        ]),
        grid("home/how/steps", { title: "Steps", css: { desktop: "grid-column:span 2;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:20px", mobile: "grid-column:span 1" } },
          c.steps.map((s, i) => flex(`home/how/steps/${i}`, { title: s.title, classes: ["card", "card-lift"], interaction: { trigger: "scrollIn", effect: "fade", delayMs: i * 80 } }, [
            flex(`home/how/steps/${i}/top`, { title: "Top", classes: ["step-top"] }, [
              flex(`home/how/steps/${i}/bubble`, { title: "Icon", classes: ["bubble"] }, [icon(`home/how/steps/${i}/icon`, s.icon, ["icon-22", "icon-teal"])]),
              text(`home/how/steps/${i}/n`, { title: "Number", tag: "span", classes: ["step-num"], text: s.n }),
            ]),
            heading(`home/how/steps/${i}/h3`, { title: s.title, tag: "h3", classes: ["h3"], text: s.title }),
            text(`home/how/steps/${i}/p`, { title: "Text", classes: ["body-15"], text: s.text }),
          ]))),
      ]),
    ]);

    const check = (path: string, label: string, plus = false) => flex(path, { title: label, classes: ["check-row"] }, [icon(`${path}/i`, plus ? "plus" : "check", ["icon-18", plus ? "icon-teal" : "icon-ok"]), text(`${path}/t`, { title: label, tag: "span", text: label })]);
    const safety = flex("home/safety", { title: "Two-way safety", tag: "section", classes: ["sec", "wrap"], css: { desktop: "flex-direction:column;gap:48px" } }, [
      flex("home/safety/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:800px" } }, [
        text("home/safety/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.safety.eyebrow }),
        heading("home/safety/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.safety.title }),
      ]),
      grid("home/safety/cards", { title: "Panels", classes: ["grid-cards"] }, [
        flex("home/safety/helpers", { title: c.safety.helpers.title, classes: ["panel"] }, [
          flex("home/safety/helpers/bubble", { title: "Icon", classes: ["bubble", "bubble-48"] }, [icon("home/safety/helpers/icon", "id-card", ["icon-24", "icon-teal"])]),
          heading("home/safety/helpers/h3", { title: "H3", tag: "h3", classes: ["h3-lg"], text: c.safety.helpers.title }),
          flex("home/safety/helpers/checks", { title: "Checks", classes: ["checks"] }, [...c.safety.helpers.checks.map((t, i) => check(`home/safety/helpers/checks/${i}`, t)), check("home/safety/helpers/checks/opt", c.safety.helpers.optional, true)]),
          flex("home/safety/helpers/credibled", { title: "Credibled", classes: ["credibled"] }, [block("home/safety/helpers/credibled/dot", { title: "Dot", classes: ["dot"] }, []), text("home/safety/helpers/credibled/t", { title: "Text", tag: "span", text: c.safety.helpers.credibled })]),
        ]),
        flex("home/safety/reviewed", { title: c.safety.reviewed.title, classes: ["panel-navy"] }, [
          flex("home/safety/reviewed/bubble", { title: "Icon", classes: ["bubble-light"] }, [icon("home/safety/reviewed/icon", "user-shield", ["icon-24", "icon-sky-light"])]),
          heading("home/safety/reviewed/h3", { title: "H3", tag: "h3", classes: ["h3-light"], text: c.safety.reviewed.title }),
          text("home/safety/reviewed/p1", { title: "P1", classes: ["body-15-light"], text: c.safety.reviewed.p1 }),
          text("home/safety/reviewed/p2", { title: "P2", classes: ["body-15-light"], text: c.safety.reviewed.p2 }),
          flex("home/safety/reviewed/note", { title: "Note", classes: ["note-light"], css: { desktop: "margin-top:auto" } }, [icon("home/safety/reviewed/note/i", "lock", ["icon-18", "icon-sky-light"]), text("home/safety/reviewed/note/t", { title: "Note", tag: "span", text: c.safety.reviewed.note })]),
        ]),
        flex("home/safety/families", { title: c.safety.families.title, classes: ["panel"] }, [
          flex("home/safety/families/bubble", { title: "Icon", classes: ["bubble", "bubble-48"] }, [icon("home/safety/families/icon", "home", ["icon-24", "icon-teal"])]),
          heading("home/safety/families/h3", { title: "H3", tag: "h3", classes: ["h3-lg"], text: c.safety.families.title }),
          text("home/safety/families/p", { title: "Text", classes: ["body-15"], text: c.safety.families.text }),
          flex("home/safety/families/link", { title: "Link", tag: "a", classes: ["link-arrow"], css: { desktop: "margin-top:auto" }, link: "page:safety" }, [text("home/safety/families/link/t", { title: "Link", tag: "span", text: c.safety.families.link }), icon("home/safety/families/link/i", "arrow-right", ["icon-18", "icon-teal"])]),
        ]),
      ]),
    ]);

    const services = flex("home/services", { title: "Services", tag: "section", classes: ["band"] }, [
      flex("home/services/wrap", { title: "Wrap", classes: ["sec", "wrap"], css: { desktop: "flex-direction:column;gap:40px" } }, [
        flex("home/services/head", { title: "Heading row", css: { desktop: "flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:24px 40px" } }, [
          flex("home/services/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:620px" } }, [
            text("home/services/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.servicesHeader.eyebrow }),
            flex("home/services/h2row", { title: "Title row", css: { desktop: "align-items:center;gap:12px;flex-wrap:wrap" } }, [heading("home/services/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.servicesHeader.title }), icon("home/services/wink", "smile-wink", ["icon-24", "icon-sky", "anim-wiggle"])]),
          ]),
          text("home/services/lead", { title: "Lead", classes: ["body-16"], css: { desktop: "max-width:380px" }, text: c.servicesHeader.lead }),
        ]),
        grid("home/services/grid", { title: "Service cards", css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px" } },
          c.services.map((s, i) => flex(`home/services/${s.file}`, { title: s.name, tag: "a", classes: ["svc", ...((i + Math.floor(i / 4)) % 2 ? ["svc-pink"] : [])], link: APP.signUp }, [
            text(`home/services/${s.file}/t`, { title: s.name, tag: "span", classes: ["svc-title"], text: s.name }),
            text(`home/services/${s.file}/d`, { title: "Text", tag: "span", classes: ["svc-text"], text: s.text }),
            image(`home/services/${s.file}/art`, { title: "Illustration", classes: ["svc-art"], media: `svc:${s.file}`, alt: "" }),
          ]))),
      ]),
    ]);

    const quotes = grid("home/quotes", { title: "Testimonials", tag: "section", classes: ["grid-cards", "wrap"], css: { desktop: "padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px) 48px" } },
      c.quotes.map((q, i) => flex(`home/quotes/${i}`, { title: q.who, classes: ["quote"], css: { desktop: `transform:rotate(${["-1.2deg", "0.8deg", "-0.6deg"][i]})` } }, [
        text(`home/quotes/${i}/q`, { title: "Quote", classes: ["quote-text"], text: q.text }),
        flex(`home/quotes/${i}/who`, { title: "Who", classes: ["quote-who"] }, [text(`home/quotes/${i}/av`, { title: "Avatar", tag: "span", classes: ["avatar"], text: q.initial }), text(`home/quotes/${i}/name`, { title: "Name", tag: "span", classes: ["muted-14"], text: q.who })]),
      ])));

    const neighbourhood = flex("home/hood", { title: "Neighbourhood", tag: "section", classes: ["wrap"], css: { desktop: "padding:0 clamp(24px,5vw,96px) clamp(56px,8vw,96px)" } }, [
      grid("home/hood/card", { title: "Card", classes: ["card-shadow"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));border-radius:14px;overflow:hidden;background-color:var(--white);border-width:1.5px;border-style:solid;border-color:var(--line)" } }, [
        block("home/hood/photo", { title: "Photo", css: { desktop: "min-height:320px;background-color:var(--tint);background-image:url(https://images.unsplash.com/photo-1658314755707-1fbdf7c40145?auto=format&fit=crop&w=1200&q=80);background-size:cover;background-position:center" } }, []),
        flex("home/hood/copy", { title: "Copy", classes: ["stack-24"], css: { desktop: "padding:clamp(28px,4vw,56px)" } }, [
          text("home/hood/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.neighbourhood.eyebrow }),
          heading("home/hood/h2", { title: "H2", tag: "h2", classes: ["h2-sm"], text: c.neighbourhood.title }),
          text("home/hood/lead", { title: "Lead", classes: ["lead"], text: c.neighbourhood.lead }),
          flex("home/hood/cities", { title: "Cities", css: { desktop: "flex-wrap:wrap;gap:10px" } }, [
            ...c.cities.map((city, i) => flex(`home/hood/cities/${i}`, { title: city, classes: ["city"] }, [icon(`home/hood/cities/${i}/i`, "map-marker", ["icon-18", "icon-teal"]), text(`home/hood/cities/${i}/t`, { title: city, tag: "span", text: city })])),
            flex("home/hood/cities/next", { title: "Next", classes: ["city-next"] }, [icon("home/hood/cities/next/i", "star", ["icon-18", "icon-magenta"]), text("home/hood/cities/next/t", { title: "Next", tag: "span", text: c.neighbourhood.next })]),
          ]),
          text("home/hood/note", { title: "Note", classes: ["muted-14"], text: c.neighbourhood.note }),
        ]),
      ]),
    ]);

    const helpers = flex("home/helpers", { title: "Become a helper", tag: "section", classes: ["wrap"], css: { desktop: "padding:0 clamp(24px,5vw,96px) clamp(56px,8vw,96px)" } }, [
      grid("home/helpers/card", { title: "Card", classes: ["grid-2", "navy", "shadow-deep"], css: { desktop: "padding:clamp(32px,5vw,64px);border-radius:14px" } }, [
        flex("home/helpers/copy", { title: "Copy", classes: ["stack-24"] }, [
          eyebrow("home/helpers/eyebrow", c.helpers.eyebrow, true),
          heading("home/helpers/h2", { title: "H2", tag: "h2", classes: ["h2-light"], text: `${c.helpers.title} <em>${c.helpers.titleAccent}</em> ${c.helpers.titleTail}`, css: { desktop: "font-style:normal" } }),
          text("home/helpers/lead", { title: "Lead", classes: ["lead-light"], css: { desktop: "max-width:560px" }, text: c.helpers.lead }),
          flex("home/helpers/btns", { title: "Buttons", classes: ["btn-row"] }, [
            button("home/helpers/cta1", { title: c.helpers.ctaPrimary, classes: ["btn-primary-14"], text: c.helpers.ctaPrimary, link: APP.signUp }),
            button("home/helpers/cta2", { title: c.helpers.ctaSecondary, classes: ["btn-ghost-light-15"], text: c.helpers.ctaSecondary, link: "page:helpers" }),
          ]),
        ]),
        block("home/helpers/photo", { title: "Photo", css: { desktop: "height:clamp(240px,30vw,340px);border-radius:14px;overflow:hidden;background-image:url(https://images.unsplash.com/photo-1583468991267-3f068b607ae1?auto=format&fit=crop&w=1000&q=80);background-size:cover;background-position:center" } }, []),
      ]),
    ]);

    const cta = flex("home/cta", { title: "Final CTA", tag: "section", classes: ["band-top"] }, [
      flex("home/cta/inner", { title: "Inner", classes: ["cta-inner"] }, [
        heading("home/cta/h2", { title: "H2", tag: "h2", classes: ["h2-cta"], text: c.cta.title }),
        text("home/cta/p", { title: "Text", classes: ["body-18"], text: c.cta.text }),
        flex("home/cta/btns", { title: "Buttons", classes: ["btn-row-center"] }, [
          button("home/cta/find", { title: c.cta.find, classes: ["btn-primary"], text: c.cta.find, link: APP.signUp }),
          button("home/cta/become", { title: c.cta.become, classes: ["btn-outline"], text: c.cta.become, link: APP.signUp }),
        ]),
      ]),
    ]);

    return [hero, steps, safety, services, quotes, neighbourhood, helpers, cta];
  },
};
```

The `em` inside the `h1` and the helpers `h2` is styled by the parent's class through the theme's `anim.css` rules `.hl-wavy em` and `.em-accent em` (Task 9); the classes themselves carry no props (Task 4). Use `classes: ["h2-light", "em-accent"]` on the helpers heading and remove its `css` entry.

- [ ] **Step 7: Write `emit/artefact.ts`**

```ts
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLASSES } from "../classes";
import { LANGS, type Lang } from "../content/types";
import { collectCss, type El, type Recipe } from "../dsl";
import { MediaRegistry, resolveMedia } from "../media";
import { PAGES, resolveLinks, type PageKey } from "../pages";
import { VARIABLES } from "../tokens";

export type ArtefactManifest = { builderVersion: string; elementorVersion: string; builtAt: string; entries: string[]; media: Record<string, { ext: string; alt: string; key: string }> };

const stable = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

function stripInternal(el: El): Record<string, unknown> {
  const { _css, ...rest } = el;
  return { ...rest, elements: el.elements.map(stripInternal) };
}

export async function buildArtefact(opts: { outDir: string; recipes: Recipe[] }): Promise<ArtefactManifest> {
  const { outDir, recipes } = opts;
  rmSync(outDir, { recursive: true, force: true });
  for (const d of ["media", "pages", "templates"]) mkdirSync(join(outDir, d), { recursive: true });
  const media = new MediaRegistry();
  const entries: string[] = [];

  const write = (rel: string, body: unknown) => { writeFileSync(join(outDir, rel), stable(body)); entries.push(rel); };

  for (const r of recipes) {
    for (const lang of LANGS) {
      const built = r.build(lang, media).map((el) => resolveMedia(resolveLinks(el, lang), media));
      const _css = Object.assign({}, ...built.map(collectCss));
      const elements = built.map(stripInternal);
      if (r.kind === "page") {
        const key = r.key as PageKey;
        write(`pages/${key}.${lang}.json`, { key, lang, slug: PAGES[key].slug[lang], title: PAGES[key].title[lang], elements, _css });
      } else {
        const title = `Site ${r.kind} (${lang})`;
        write(`templates/${r.kind}.${lang}.json`, { title, type: r.kind === "header" ? "type_header" : "type_footer", lang, elements, _css });
      }
    }
  }

  const mediaIndex: ArtefactManifest["media"] = {};
  for (const f of media.all().sort((a, b) => a.hash.localeCompare(b.hash))) {
    copyFileSync(f.sourcePath, join(outDir, "media", `${f.hash}.${f.ext}`));
    mediaIndex[f.hash] = { ext: f.ext, alt: f.alt, key: f.key };
  }
  writeFileSync(join(outDir, "variables.json"), stable(VARIABLES));
  writeFileSync(join(outDir, "classes.json"), stable(Object.values(CLASSES).map((c) => ({ id: c.id, label: c.label, css: c.css }))));
  const manifest: ArtefactManifest = { builderVersion: "1", elementorVersion: "4.2.4", builtAt: new Date().toISOString(), entries: entries.sort(), media: mediaIndex };
  writeFileSync(join(outDir, "manifest.json"), stable(manifest));
  return manifest;
}
```

- [ ] **Step 8: Wire the CLI**

Replace the body of `runCli` in `cli.ts`:

```ts
import { resolve } from "node:path";
import { lintClasses } from "./classes";
import { buildArtefact } from "./emit/artefact";
import { footerRecipe } from "./recipes/footer";
import { headerRecipe } from "./recipes/header";
import { homeRecipe } from "./recipes/home";

export const RECIPES = [headerRecipe, footerRecipe, homeRecipe];

export async function runCli(argv: string[]): Promise<number> {
  const [cmd, name = "current"] = argv;
  if (cmd !== "build" && cmd !== "check") {
    console.error(`usage: bun run src/cli.ts build|check [build-name] (got "${cmd ?? ""}")`);
    return 2;
  }
  const problems = lintClasses();
  if (problems.length) { console.error(problems.join("\n")); return 1; }
  const outDir = resolve(import.meta.dir, "../../json-artefacts", name);
  if (cmd === "check") {
    const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
    await buildArtefact({ outDir: mkdtempSync(resolve(tmpdir(), "poppynz-check-")), recipes: RECIPES });
    console.log("check: ok");
    return 0;
  }
  const m = await buildArtefact({ outDir, recipes: RECIPES });
  console.log(`build: ${m.entries.length} entries, ${Object.keys(m.media).length} media files -> ${outDir}`);
  return 0;
}
```

Update `cli.test.ts` so the second test reads `expect(await runCli(["check"])).toBe(0)` (unchanged) and add:

```ts
  test("build writes json-artefacts/<name>", async () => {
    const { existsSync, rmSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dir = resolve(import.meta.dir, "../../json-artefacts/test-build");
    expect(await runCli(["build", "test-build"])).toBe(0);
    expect(existsSync(resolve(dir, "pages/home.en.json"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
```

- [ ] **Step 9: Run all tests and a real build**

Run: `bun test` then `bun run build`
Expected: all tests PASS; `json-artefacts/current/` contains `manifest.json`, `variables.json`, `classes.json`, 6 entries and about 30 media files. Open `pages/home.en.json` and confirm no `page:` links, no `icon:` or `media:` hashes and no `"props": {}` variants without a `_css` entry.

- [ ] **Step 10: Commit including the artefact**

```bash
git add apps/landing-page/builder apps/landing-page/json-artefacts/current
git commit -m "feat(landing): recipes for header, footer and Home; artefact writer and build CLI"
```

---

### Task 9: Hello Elementor child theme

**Files:**
- Create: `apps/landing-page/theme/poppynz/style.css`
- Create: `apps/landing-page/theme/poppynz/functions.php`
- Create: `apps/landing-page/theme/poppynz/assets/anim.css`
- Create: `apps/landing-page/theme/poppynz/assets/faq.js`
- Create: `apps/landing-page/theme/poppynz/theme.test.sh`

**Interfaces:**
- Produces: theme slug `poppynz` (folder name) with template `hello-elementor`. `functions.php` enqueues Google Fonts (Hanken Grotesk, Inter), `anim.css`, `faq.js`; adds the SVG mime filters; filters `hfe_render_template_id` through `pll_get_post`; disables Hello's own header and footer via `hello_elementor_settings_header_footer`. `bootstrap.php` (Task 10) installs this folder from the artefact zip's `theme/` directory.

- [ ] **Step 1: Write the check script (the test for PHP and CSS syntax)**

`theme.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
php -l functions.php
grep -q '^Template: hello-elementor$' style.css
grep -q '@keyframes float' assets/anim.css
grep -q 'prefers-reduced-motion' assets/anim.css
node --check assets/faq.js
echo "theme: ok"
```

Run: `bash apps/landing-page/theme/poppynz/theme.test.sh`
Expected: FAIL (files missing). If `php` is not installed locally, run the `php -l` line through the Novamira `execute-php` ability instead: `return shell_exec('php -l '.escapeshellarg(get_theme_root().'/poppynz/functions.php'));` after Task 10 installs the theme, and skip that line locally.

- [ ] **Step 2: `style.css`**

```css
/*
Theme Name: Poppynz
Template: hello-elementor
Version: 1.0.0
Description: Poppynz marketing site, child of Hello Elementor. Styling lives in Elementor V4 classes; this theme holds keyframes and behaviour only.
Text Domain: poppynz
*/
```

- [ ] **Step 3: `functions.php`**

```php
<?php
/**
 * Poppynz child theme: fonts, keyframes, FAQ toggle, SVG uploads, per-language header/footer.
 */
defined( 'ABSPATH' ) || exit;

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style( 'poppynz-fonts', 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400..800&family=Inter:wght@400..700&display=swap', [], null );
	wp_enqueue_style( 'poppynz-anim', get_stylesheet_directory_uri() . '/assets/anim.css', [], wp_get_theme()->get( 'Version' ) );
	wp_enqueue_script( 'poppynz-faq', get_stylesheet_directory_uri() . '/assets/faq.js', [], wp_get_theme()->get( 'Version' ), true );
}, 20 );

// Hello's own header/footer stay off: the Header & Footer Builder templates render instead.
add_filter( 'hello_elementor_header_footer', '__return_false' );

// Header & Footer Builder: serve the template translated into the current Polylang language.
add_filter( 'hfe_render_template_id', function ( $id ) {
	if ( $id && function_exists( 'pll_get_post' ) ) {
		$translated = pll_get_post( (int) $id );
		if ( $translated ) {
			return $translated;
		}
	}
	return $id;
} );

// SVG uploads for icons and the logo (used by the importer and by the media library).
add_filter( 'upload_mimes', function ( $mimes ) {
	$mimes['svg'] = 'image/svg+xml';
	return $mimes;
} );
add_filter( 'wp_check_filetype_and_ext', function ( $data, $file, $filename ) {
	if ( str_ends_with( strtolower( $filename ), '.svg' ) ) {
		$data['ext']  = 'svg';
		$data['type'] = 'image/svg+xml';
	}
	return $data;
}, 10, 3 );
```

- [ ] **Step 4: `assets/anim.css`**

```css
/* Looping decorative motion. Applied through the anim-* global classes; entrance effects are V4 interactions. */
@keyframes float{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-8px) rotate(-1.5deg)}}
@keyframes wave{0%,100%{transform:rotate(0)}25%{transform:rotate(14deg)}75%{transform:rotate(-8deg)}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes wiggle{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
@keyframes wiggle-badge{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(2deg)}}
@keyframes beat{0%,100%{transform:scale(1)}30%{transform:scale(1.25)}50%{transform:scale(1)}}
@keyframes twinkle{0%,100%{opacity:.35;transform:scale(.8) rotate(0)}50%{opacity:1;transform:scale(1.1) rotate(20deg)}}
@keyframes ring{0%,100%{transform:translateY(-50%) rotate(0)}15%{transform:translateY(-50%) rotate(-3deg)}30%{transform:translateY(-50%) rotate(2.5deg)}45%{transform:translateY(-50%) rotate(-1.5deg)}60%{transform:translateY(-50%) rotate(1deg)}75%{transform:translateY(-50%) rotate(0)}}
@keyframes drift{0%,100%{transform:translate(0,0)}33%{transform:translate(6px,-10px)}66%{transform:translate(-4px,-4px)}}

.elementor .anim-float{animation:float 5s ease-in-out infinite}
.elementor .anim-wave{display:inline-block;transform-origin:70% 90%;animation:wave 3s ease-in-out infinite}
.elementor .anim-bob{display:inline-block;animation:bob 2.4s ease-in-out infinite}
.elementor .anim-wiggle{display:inline-block;transform-origin:left center;animation:wiggle 3s ease-in-out infinite}
.elementor .anim-wiggle-badge{animation:wiggle-badge 2s ease-in-out infinite}
.elementor .anim-beat{display:inline-block;animation:beat 1.6s ease-in-out infinite}
.elementor .anim-twinkle{animation:twinkle 4s ease-in-out infinite}
.elementor .anim-drift{animation:drift 9s ease-in-out infinite}
.elementor .anim-drift-rev{animation:drift 11s ease-in-out infinite reverse}
.elementor .anim-drift-slow{animation:drift 13s ease-in-out infinite}
.elementor .anim-ring{animation:ring 6s ease-in-out infinite}

/* The only descendant rules in the project: inline emphasis inside V4 headings (see pitfalls.md). */
.elementor .hl-wavy em{font-style:normal;text-decoration:underline wavy var(--sky);text-decoration-thickness:.06em;text-underline-offset:.14em}
.elementor .em-accent em{font-style:normal;color:var(--sky)}

/* FAQ items (Plan 2): the toggle script adds/removes .is-open on the item container. */
.elementor .faq-answer{display:none}
.elementor .faq-item.is-open .faq-answer{display:block}

@media (prefers-reduced-motion:reduce){.elementor [class*="anim-"]{animation:none!important}}
```

- [ ] **Step 5: `assets/faq.js`**

```js
// FAQ toggle for Plan 2 pages: an element with class faq-item contains a faq-question and a faq-answer.
(function () {
  document.addEventListener('click', function (e) {
    var q = e.target.closest('.faq-question');
    if (!q) return;
    var item = q.closest('.faq-item');
    if (!item) return;
    var list = item.parentElement;
    var open = item.classList.contains('is-open');
    if (list) list.querySelectorAll('.faq-item.is-open').forEach(function (i) { i.classList.remove('is-open'); });
    if (!open) item.classList.add('is-open');
  });
})();
```

- [ ] **Step 6: Run the check**

Run: `bash apps/landing-page/theme/poppynz/theme.test.sh`
Expected: `theme: ok`.

- [ ] **Step 7: Commit**

```bash
git add apps/landing-page/theme
git commit -m "feat(landing): Poppynz child theme with keyframes, FAQ toggle and language-aware header"
```

---

### Task 10: Server library and bootstrap script

**Files:**
- Create: `apps/landing-page/server/lib.php`
- Create: `apps/landing-page/server/bootstrap.php`
- Create: `apps/landing-page/server/README.md`

**Interfaces:**
- Consumes: the Novamira abilities `novamira/create-upload-link`, `novamira/execute-php`. `execute-php` rejects a leading `<?php`; the README explains that every script is pasted as the `code` parameter with its first line removed, and that `lib.php` is included from the sandbox where the artefact zip was unpacked.
- Produces in `lib.php` (all in namespace-free procedural PHP, prefixed `pz_`):
  - `pz_sandbox(): string` → `WP_CONTENT_DIR . '/novamira-sandbox/'`
  - `pz_artefact_dir(): string` → `pz_sandbox() . 'artefact/'`
  - `pz_json(string $file): array` reads and decodes a file from the artefact dir, throws on error
  - `pz_converter(): \Elementor\Modules\AtomicWidgets\CssConverter\Css_Converter`
  - `pz_convert_map(array $cssMap, string $where): array` returns V4 `variants` and throws listing every `rejected` or `customCss` output
  - `pz_find_media(string $hash): ?int`
  - `pz_report(): array` accumulator with `pz_note(string $section, string $key, string $status)`
- Produces `bootstrap.php`: idempotent install and configuration per the spec, returning a report array.

- [ ] **Step 1: Write `lib.php`**

```php
<?php
// Shared helpers for the Poppynz Elementor V4 importer. Included from the sandbox by the other scripts.

function pz_sandbox(): string { return WP_CONTENT_DIR . '/novamira-sandbox/'; }
function pz_artefact_dir(): string { return pz_sandbox() . 'artefact/'; }

function pz_json( string $file ): array {
	$path = pz_artefact_dir() . $file;
	$data = json_decode( (string) @file_get_contents( $path ), true );
	if ( ! is_array( $data ) ) { throw new Exception( "bad or missing json: $file (" . json_last_error_msg() . ')' ); }
	return $data;
}

$GLOBALS['pz_report'] = [];
function pz_note( string $section, string $key, string $status ): void { $GLOBALS['pz_report'][ $section ][ $key ] = $status; }
function pz_report(): array { return $GLOBALS['pz_report']; }

function pz_kit() { return \Elementor\Plugin::$instance->kits_manager->get_active_kit(); }

function pz_variables_service() {
	return new \Elementor\Modules\Variables\Services\Variables_Service(
		new \Elementor\Modules\Variables\Storage\Variables_Repository( pz_kit() ),
		new \Elementor\Modules\Variables\Services\Batch_Operations\Batch_Processor()
	);
}

function pz_converter() {
	static $conv = null;
	if ( $conv ) { return $conv; }
	$svc  = pz_variables_service();
	$conv = new \Elementor\Modules\AtomicWidgets\CssConverter\Css_Converter(
		\Elementor\Modules\AtomicWidgets\CssConverter\Converter_Registry_Factory::create( $svc ),
		new \Elementor\Modules\AtomicWidgets\CssConverter\Metrics\Null_Failure_Reporter(),
		\Elementor\Modules\AtomicWidgets\CssConverter\Expander_Registry_Factory::create( $svc ),
		new \Elementor\Modules\AtomicWidgets\CssConverter\Variable_Prop_Value_Transformer( $svc )
	);
	return $conv;
}

/** CssMap {"desktop":"...","desktop:hover":"...","mobile":"..."} -> V4 variants. Throws on anything Elementor would drop. */
function pz_convert_map( array $map, string $where ): array {
	$variants = [];
	$problems = [];
	foreach ( $map as $key => $css ) {
		[ $bp, $state ] = array_pad( explode( ':', $key, 2 ), 2, null );
		$props = [];
		if ( trim( (string) $css ) !== '' ) {
			$r = pz_converter()->convert( $css );
			if ( $r['rejected'] ) { $problems[] = "$where/$key rejected: " . implode( ' ', $r['rejected'] ); }
			if ( trim( $r['customCss'] ) !== '' ) { $problems[] = "$where/$key not convertible (would be dropped in Free): " . $r['customCss']; }
			$props = $r['props'];
		}
		$variants[] = [ 'meta' => [ 'breakpoint' => $bp, 'state' => $state ], 'props' => $props ];
	}
	if ( $problems ) { throw new Exception( implode( "\n", $problems ) ); }
	return $variants;
}

function pz_find_media( string $hash ): ?int {
	$ids = get_posts( [ 'post_type' => 'attachment', 'post_status' => 'inherit', 'meta_key' => '_poppynz_hash', 'meta_value' => $hash, 'fields' => 'ids', 'numberposts' => 1 ] );
	return $ids ? (int) $ids[0] : null;
}

function pz_front( string $url ): int {
	$r = wp_remote_get( add_query_arg( 'v', time(), $url ), [ 'timeout' => 40, 'sslverify' => false ] );
	return is_wp_error( $r ) ? 0 : (int) wp_remote_retrieve_response_code( $r );
}
```

- [ ] **Step 2: Write `bootstrap.php`**

```php
<?php
// One-time site bootstrap (idempotent). Run through novamira/execute-php without the first line,
// after uploading and unzipping the artefact (which carries theme/poppynz) into the sandbox.
set_time_limit( 600 );
require_once WP_CONTENT_DIR . '/novamira-sandbox/artefact/server/lib.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/theme.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/misc.php';

const PZ_VERSIONS = [
	'theme:hello-elementor'  => 'https://downloads.wordpress.org/theme/hello-elementor.3.5.1.zip',
	'plugin:elementor'       => 'https://downloads.wordpress.org/plugin/elementor.4.2.4.zip',
	'plugin:header-footer-elementor' => 'https://downloads.wordpress.org/plugin/header-footer-elementor.2.9.4.zip',
	'plugin:polylang'        => 'https://downloads.wordpress.org/plugin/polylang.3.8.9.zip',
];
const PZ_PLUGIN_MAIN = [
	'elementor' => 'elementor/elementor.php',
	'header-footer-elementor' => 'header-footer-elementor/header-footer-elementor.php',
	'polylang' => 'polylang/polylang.php',
];

wp_set_current_user( 1 );
$skin = new Automatic_Upgrader_Skin();

// 1. Theme and plugins at pinned versions.
if ( ! wp_get_theme( 'hello-elementor' )->exists() ) {
	$r = ( new Theme_Upgrader( $skin ) )->install( PZ_VERSIONS['theme:hello-elementor'] );
	pz_note( 'install', 'hello-elementor', is_wp_error( $r ) ? 'ERR ' . $r->get_error_message() : 'installed' );
} else { pz_note( 'install', 'hello-elementor', 'present ' . wp_get_theme( 'hello-elementor' )->get( 'Version' ) ); }

foreach ( PZ_PLUGIN_MAIN as $slug => $main ) {
	$want = preg_replace( '/.*\.(\d+\.\d+\.\d+)\.zip$/', '$1', PZ_VERSIONS[ "plugin:$slug" ] );
	$have = file_exists( WP_PLUGIN_DIR . '/' . $main ) ? get_plugin_data( WP_PLUGIN_DIR . '/' . $main )['Version'] : null;
	if ( $have !== $want ) {
		if ( $have ) { deactivate_plugins( $main ); delete_plugins( [ $main ] ); }
		$r = ( new Plugin_Upgrader( $skin ) )->install( PZ_VERSIONS[ "plugin:$slug" ] );
		pz_note( 'install', $slug, is_wp_error( $r ) ? 'ERR ' . $r->get_error_message() : "installed $want" . ( $have ? " (replaced $have)" : '' ) );
	} else { pz_note( 'install', $slug, "present $have" ); }
	if ( ! is_plugin_active( $main ) ) { $r = activate_plugin( $main ); pz_note( 'activate', $slug, is_wp_error( $r ) ? 'ERR ' . $r->get_error_message() : 'activated' ); }
}

// 2. Child theme from the artefact.
$src = pz_artefact_dir() . 'theme/poppynz';
$dst = get_theme_root() . '/poppynz';
if ( is_dir( $src ) ) {
	if ( ! is_dir( $dst ) ) { mkdir( $dst, 0755, true ); }
	foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $src, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::SELF_FIRST ) as $f ) {
		$rel = substr( $f->getPathname(), strlen( $src ) + 1 );
		if ( $f->isDir() ) { @mkdir( "$dst/$rel", 0755, true ); } else { copy( $f->getPathname(), "$dst/$rel" ); }
	}
	pz_note( 'theme', 'poppynz', 'copied' );
}
if ( wp_get_theme()->get_stylesheet() !== 'poppynz' ) { switch_theme( 'poppynz' ); pz_note( 'theme', 'active', 'switched to poppynz' ); }

// 3. WordPress and Elementor options.
update_option( 'permalink_structure', '/%postname%/' );
update_option( 'elementor_onboarded', true );
update_option( 'elementor_unfiltered_files_upload', '1' );
update_option( 'hello_elementor_settings_header_footer', 'true' );
update_option( 'hello_elementor_settings_skip_link', 'true' );
update_option( 'elementor_disable_color_schemes', 'yes' );
update_option( 'elementor_disable_typography_schemes', 'yes' );
flush_rewrite_rules();

// 4. Elementor kit defaults (V3 container width and padding so any legacy element behaves).
if ( class_exists( '\Elementor\Plugin' ) ) {
	$kit = pz_kit();
	$settings = $kit->get_meta( '_elementor_page_settings' ) ?: [];
	$settings['container_width']   = [ 'unit' => 'px', 'size' => 1920, 'sizes' => [] ];
	$settings['container_padding'] = [ 'unit' => 'px', 'top' => '0', 'right' => '0', 'bottom' => '0', 'left' => '0', 'isLinked' => true ];
	$settings['space_between_widgets'] = [ 'unit' => 'px', 'column' => '0', 'row' => '0', 'isLinked' => true, 'size' => 0 ];
	$kit->update_meta( '_elementor_page_settings', $settings );
	pz_note( 'kit', 'defaults', 'set' );
	pz_note( 'kit', 'atomic_active', \Elementor\Plugin::$instance->experiments->is_feature_active( 'e_atomic_elements' ) ? 'yes' : 'NO (turn on e_atomic_elements)' );
}

// 5. Polylang languages and translatable post types.
if ( function_exists( 'PLL' ) ) {
	$L = PLL()->model->languages;
	foreach ( [ [ 'locale' => 'en_CA', 'slug' => 'en', 'name' => 'English', 'flag' => 'ca', 'term_group' => 0 ], [ 'locale' => 'fr_CA', 'slug' => 'fr', 'name' => 'Français', 'flag' => 'ca', 'term_group' => 1 ] ] as $a ) {
		if ( ! $L->get( $a['slug'] ) ) { $r = $L->add( $a ); pz_note( 'polylang', $a['slug'], is_wp_error( $r ) ? 'ERR ' . $r->get_error_message() : 'added' ); } else { pz_note( 'polylang', $a['slug'], 'present' ); }
	}
	$L->clean_cache(); PLL()->model->clean_languages_cache();
	$o = PLL()->options;
	$o['default_lang'] = 'en';
	$o['hide_default'] = true;
	$o['post_types']   = array_values( array_unique( array_merge( (array) ( $o['post_types'] ?? [] ), [ 'elementor-hf', 'elementor_library' ] ) ) );
	if ( method_exists( $o, 'save' ) ) { $o->save(); }
	pz_note( 'polylang', 'options', 'default en, elementor-hf translatable' );
} else { pz_note( 'polylang', 'PLL', 'not loaded in this request; re-run bootstrap once' ); }

if ( class_exists( '\Elementor\Plugin' ) ) { \Elementor\Plugin::$instance->files_manager->clear_cache(); }
pz_note( 'front', home_url( '/' ), (string) pz_front( home_url( '/' ) ) );
return pz_report();
```

- [ ] **Step 3: Write `server/README.md`**

```markdown
# Server scripts

Every script here runs on the WordPress site through the Novamira MCP ability `novamira/execute-php`.
Paste the file content as the `code` parameter **without its first `<?php` line**.

Order for a fresh site:

1. Build: `cd apps/landing-page/builder && bun run build` (writes `json-artefacts/current`).
2. Zip the artefact together with `server/` and `theme/`:
   `bash .claude/skills/elementor-v4-port/scripts/pack.sh current` -> `<scratchpad>/poppynz-artefact.zip`
3. Upload link: ability `novamira/create-upload-link` with `{"path":"wp-content/novamira-sandbox/poppynz-artefact.zip","overwrite":true}`.
4. `bash .claude/skills/elementor-v4-port/scripts/push.sh <zip> <token> https://staging.poppynz.com`
5. Unzip on the server (execute-php): see `unpack.php`.
6. `bootstrap.php` once per site, then `import.php` for every deploy. `snapshot.php` before importing on production.
7. `verify.php` after every import.

Elementor must be active for `lib.php` to load (`bootstrap.php` handles a bare site: run it, then run it a second time so Polylang is loaded).
```

- [ ] **Step 4: Write `server/unpack.php`** (add to Files)

```php
<?php
// Unzip wp-content/novamira-sandbox/poppynz-artefact.zip into wp-content/novamira-sandbox/artefact/ (replacing it).
$dir = WP_CONTENT_DIR . '/novamira-sandbox/';
$zip = new ZipArchive();
if ( $zip->open( $dir . 'poppynz-artefact.zip' ) !== true ) { return [ 'error' => 'zip open failed' ]; }
$target = $dir . 'artefact/';
if ( is_dir( $target ) ) {
	foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $target, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::CHILD_FIRST ) as $f ) { $f->isDir() ? rmdir( $f->getPathname() ) : unlink( $f->getPathname() ); }
}
mkdir( $target, 0755, true );
$zip->extractTo( $target ); $zip->close();
@unlink( $dir . 'poppynz-artefact.zip' );
return [ 'files' => count( iterator_to_array( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $target, FilesystemIterator::SKIP_DOTS ) ) ) ), 'manifest' => json_decode( @file_get_contents( $target . 'manifest.json' ), true )['entries'] ?? 'missing' ];
```

- [ ] **Step 5: Lint locally**

Run: `php -l apps/landing-page/server/lib.php && php -l apps/landing-page/server/bootstrap.php && php -l apps/landing-page/server/unpack.php` (if PHP is not installed locally, the syntax check happens when Task 14 runs them; a parse error is reported by `execute-php`).

- [ ] **Step 6: Commit**

```bash
git add apps/landing-page/server
git commit -m "feat(landing): server library, bootstrap and unpack scripts for Novamira"
```

---

### Task 11: Import script

**Files:**
- Create: `apps/landing-page/server/import.php`

**Interfaces:**
- Consumes: the artefact layout from Task 8, `lib.php` from Task 10, Elementor internals verified in the spike: `Variables_Repository::load()/save()`, `Variables_Collection::add_variable()`, `Variable::from_array()`, `Global_Classes_Repository::make($kit)->all()/put($items,$order)`, `Plugin::$instance->documents->get($id)->save([...])`, Polylang `pll_set_post_language`, `pll_save_post_translations`, `pll_get_post_translations`.
- Produces: an import that is idempotent by slug+language, title+language, media hash and label; returns `pz_report()` with sections `media`, `variables`, `classes`, `templates`, `pages`, `polylang`, `options`, each key marked `created`, `updated` or `unchanged`; throws before writing any page when a CSS string fails conversion.

- [ ] **Step 1: Write `import.php`**

```php
<?php
// Import the unpacked artefact into this site. Idempotent. Run through novamira/execute-php without the first line.
set_time_limit( 600 );
require_once WP_CONTENT_DIR . '/novamira-sandbox/artefact/server/lib.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';
wp_set_current_user( 1 );
$manifest = pz_json( 'manifest.json' );
if ( ( $manifest['elementorVersion'] ?? '' ) !== ELEMENTOR_VERSION ) { throw new Exception( "artefact built for Elementor {$manifest['elementorVersion']}, site runs " . ELEMENTOR_VERSION ); }

// ---- 1. media by content hash
add_filter( 'upload_mimes', fn( $m ) => $m + [ 'svg' => 'image/svg+xml' ] );
add_filter( 'wp_check_filetype_and_ext', function ( $d, $file, $filename ) { if ( str_ends_with( strtolower( $filename ), '.svg' ) ) { $d['ext'] = 'svg'; $d['type'] = 'image/svg+xml'; } return $d; }, 10, 3 );
$media_ids = [];
foreach ( $manifest['media'] as $hash => $m ) {
	$id = pz_find_media( $hash );
	if ( ! $id ) {
		$src = pz_artefact_dir() . "media/$hash.{$m['ext']}";
		$name = preg_replace( '/[^a-z0-9-]+/', '-', strtolower( str_replace( [ 'icon:', 'svc:', 'media:' ], '', $m['key'] ) ) ) . "-$hash.{$m['ext']}";
		$up = wp_upload_bits( $name, null, file_get_contents( $src ) );
		if ( ! empty( $up['error'] ) ) { throw new Exception( "upload $name: {$up['error']}" ); }
		$type = wp_check_filetype( $up['file'] )['type'] ?: ( $m['ext'] === 'svg' ? 'image/svg+xml' : 'image/webp' );
		$id = wp_insert_attachment( [ 'post_mime_type' => $type, 'post_title' => $m['key'], 'post_status' => 'inherit' ], $up['file'] );
		if ( $m['ext'] !== 'svg' ) { wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $up['file'] ) ); }
		update_post_meta( $id, '_poppynz_hash', $hash );
		if ( $m['alt'] ) { update_post_meta( $id, '_wp_attachment_image_alt', $m['alt'] ); }
		pz_note( 'media', $m['key'], 'created' );
	} else { pz_note( 'media', $m['key'], 'unchanged' ); }
	$media_ids[ $hash ] = (int) $id;
}

// ---- 2. variables by label
$repo = new \Elementor\Modules\Variables\Storage\Variables_Repository( pz_kit() );
$coll = $repo->load();
$by_label = [];
foreach ( $coll->all() as $id => $var ) { $by_label[ $var->label() ] = $var; }
$order = count( $by_label ); $now = current_time( 'mysql' ); $changed = false;
foreach ( pz_json( 'variables.json' ) as $v ) {
	if ( isset( $by_label[ $v['label'] ] ) ) {
		$existing = $by_label[ $v['label'] ];
		$cur = $existing->value(); $cur = is_array( $cur ) ? ( $cur['value'] ?? null ) : $cur;
		if ( $cur !== $v['value'] ) { $existing->set_value( $v['value'] ); $changed = true; pz_note( 'variables', $v['label'], 'updated' ); } else { pz_note( 'variables', $v['label'], 'unchanged' ); }
	} else {
		$coll->add_variable( \Elementor\Modules\Variables\Storage\Entities\Variable::from_array( [ 'id' => \Elementor\Modules\AtomicWidgets\Utils\Utils::generate_id( 'e-gv-' ), 'type' => $v['type'], 'label' => $v['label'], 'value' => $v['value'], 'order' => ++$order, 'created_at' => $now, 'updated_at' => $now ] ) );
		$changed = true; pz_note( 'variables', $v['label'], 'created' );
	}
}
if ( $changed ) { $repo->save( $coll ); }

// ---- 3. global classes (convert first, abort on problems)
$gcr = \Elementor\Modules\GlobalClasses\Global_Classes_Repository::make( pz_kit() );
$current = $gcr->all(); $items = $current->get_items()->all(); $gorder = $current->get_order()->all();
foreach ( pz_json( 'classes.json' ) as $c ) {
	$variants = pz_convert_map( $c['css'], 'class ' . $c['label'] );
	$new = [ 'id' => $c['id'], 'label' => $c['label'], 'type' => 'class', 'variants' => $variants ];
	$was = $items[ $c['id'] ] ?? null;
	pz_note( 'classes', $c['label'], $was ? ( wp_json_encode( $was['variants'] ) === wp_json_encode( $variants ) ? 'unchanged' : 'updated' ) : 'created' );
	$items[ $c['id'] ] = $new;
	if ( ! in_array( $c['id'], $gorder, true ) ) { $gorder[] = $c['id']; }
}
$gcr->put( $items, $gorder );

// ---- helpers for documents
function pz_fill_styles( array &$elements, array $css_map, array $media_ids ): void {
	foreach ( $elements as &$el ) {
		foreach ( $el['styles'] ?? [] as $sid => &$style ) {
			if ( isset( $css_map[ $sid ] ) ) { $style['variants'] = pz_convert_map( $css_map[ $sid ], ( $el['editor_settings']['title'] ?? $el['id'] ) . " ($sid)" ); }
		}
		unset( $style );
		$el['settings'] = pz_swap_media( $el['settings'], $media_ids );
		if ( ! empty( $el['elements'] ) ) { pz_fill_styles( $el['elements'], $css_map, $media_ids ); }
	}
}
function pz_swap_media( $node, array $media_ids ) {
	if ( is_array( $node ) ) {
		if ( ( $node['$$type'] ?? null ) === 'media-hash' ) {
			if ( ! isset( $media_ids[ $node['value'] ] ) ) { throw new Exception( 'unknown media hash ' . $node['value'] ); }
			return [ '$$type' => 'image-attachment-id', 'value' => $media_ids[ $node['value'] ] ];
		}
		foreach ( $node as $k => $v ) { $node[ $k ] = pz_swap_media( $v, $media_ids ); }
	}
	return $node;
}
function pz_save_document( int $post_id, array $elements, array $page_settings ): bool {
	$doc = \Elementor\Plugin::$instance->documents->get( $post_id, false );
	$doc->set_is_built_with_elementor( true );
	$before = get_post_meta( $post_id, '_elementor_data', true );
	$ok = $doc->save( [ 'elements' => $elements, 'settings' => $page_settings ] );
	if ( ! $ok ) { throw new Exception( "document save returned false for post $post_id" ); }
	return get_post_meta( $post_id, '_elementor_data', true ) !== $before;
}

// ---- 4. header/footer templates per language
$hf_ids = [ 'header' => [], 'footer' => [] ];
foreach ( $manifest['entries'] as $entry ) {
	if ( ! str_starts_with( $entry, 'templates/' ) ) { continue; }
	$t = pz_json( $entry ); $kind = str_contains( $entry, 'header' ) ? 'header' : 'footer';
	$ex = get_posts( [ 'post_type' => 'elementor-hf', 'title' => $t['title'], 'post_status' => 'any', 'numberposts' => 1 ] );
	$pid = $ex ? $ex[0]->ID : wp_insert_post( [ 'post_title' => $t['title'], 'post_type' => 'elementor-hf', 'post_status' => 'publish' ] );
	update_post_meta( $pid, 'ehf_template_type', $t['type'] );
	update_post_meta( $pid, 'ehf_target_include_locations', [ 'rule' => [ 'basic-global' ], 'specific' => [] ] );
	update_post_meta( $pid, 'ehf_target_exclude_locations', [ 'rule' => [], 'specific' => [] ] );
	update_post_meta( $pid, 'ehf_target_user_roles', [] );
	$elements = $t['elements']; pz_fill_styles( $elements, $t['_css'], $media_ids );
	$changed = pz_save_document( $pid, $elements, [] );
	pz_note( 'templates', $entry, $ex ? ( $changed ? 'updated' : 'unchanged' ) : 'created' );
	$hf_ids[ $kind ][ $t['lang'] ] = $pid;
}
// ---- 5. pages per key and language
$page_ids = [];
foreach ( $manifest['entries'] as $entry ) {
	if ( ! str_starts_with( $entry, 'pages/' ) ) { continue; }
	$p = pz_json( $entry );
	$slug = $p['slug'] !== '' ? $p['slug'] : ( $p['lang'] === 'en' ? 'home' : 'accueil' );
	$found = null;
	foreach ( get_posts( [ 'post_type' => 'page', 'name' => $slug, 'post_status' => 'any', 'numberposts' => -1, 'lang' => '' ] ) as $cand ) {
		if ( ! function_exists( 'pll_get_post_language' ) || pll_get_post_language( $cand->ID ) === $p['lang'] ) { $found = $cand->ID; break; }
	}
	$pid = $found ?: wp_insert_post( [ 'post_title' => $p['title'], 'post_name' => $slug, 'post_type' => 'page', 'post_status' => 'publish', 'post_content' => '' ] );
	if ( function_exists( 'pll_set_post_language' ) ) { pll_set_post_language( $pid, $p['lang'] ); }
	$elements = $p['elements']; pz_fill_styles( $elements, $p['_css'], $media_ids );
	$changed = pz_save_document( $pid, $elements, [ 'hide_title' => 'yes', 'template' => 'elementor_header_footer' ] );
	update_post_meta( $pid, '_wp_page_template', 'elementor_header_footer' );
	pz_note( 'pages', $entry, $found ? ( $changed ? 'updated' : 'unchanged' ) : 'created' );
	$page_ids[ $p['key'] ][ $p['lang'] ] = $pid;
}
// ---- 6. Polylang links
if ( function_exists( 'pll_save_post_translations' ) ) {
	foreach ( array_merge( array_values( $page_ids ), array_values( $hf_ids ) ) as $group ) { if ( count( $group ) > 1 ) { pll_save_post_translations( $group ); } }
	pz_note( 'polylang', 'links', count( $page_ids ) . ' page groups, ' . count( array_filter( $hf_ids ) ) . ' template kinds' );
}
// ---- 7. front page
if ( isset( $page_ids['home']['en'] ) ) {
	update_option( 'show_on_front', 'page' ); update_option( 'page_on_front', $page_ids['home']['en'] );
	pz_note( 'options', 'front_page', 'home.en' );
}
\Elementor\Plugin::$instance->files_manager->clear_cache();
$report = pz_report();
$report['urls'] = [];
foreach ( $page_ids as $key => $langs ) { foreach ( $langs as $lang => $pid ) { $u = get_permalink( $pid ); $report['urls'][ "$key.$lang" ] = [ 'url' => $u, 'status' => pz_front( $u ) ]; } }
return $report;
```

- [ ] **Step 2: Lint**

Run: `php -l apps/landing-page/server/import.php` (or rely on `execute-php` reporting a parse error in Task 14).

- [ ] **Step 3: Commit**

```bash
git add apps/landing-page/server/import.php
git commit -m "feat(landing): idempotent Elementor V4 importer for pages, templates, classes, variables and media"
```

---

### Task 12: Snapshot, restore and verify scripts

**Files:**
- Create: `apps/landing-page/server/snapshot.php`, `restore.php`, `verify.php`

**Interfaces:**
- Produces: `snapshot.php` writes `wp-content/novamira-sandbox/snapshots/<Y-m-d_His>.json` holding pages (`page`), templates (`elementor-hf`), `e_global_class` posts, kit meta (`_elementor_page_settings`, `_elementor_global_variables`, `_elementor_global_classes_order`, `_elementor_global_classes_labels`, `_elementor_global_classes_post_ids`), options `show_on_front`, `page_on_front`; returns the path and counts. `restore.php` takes `$snapshot` (filename) and puts every captured post's content, meta and status back, and the kit meta. `verify.php` fetches every page and template-bearing URL and returns `{url: {status, hash}}` where `hash` is sha1 of the HTML with `?v=` cache-busters and nonces stripped.

- [ ] **Step 1: `snapshot.php`**

```php
<?php
set_time_limit( 300 );
$dir = WP_CONTENT_DIR . '/novamira-sandbox/snapshots/'; if ( ! is_dir( $dir ) ) { mkdir( $dir, 0755, true ); }
$kit_id = (int) get_option( 'elementor_active_kit' );
$snap = [ 'taken' => current_time( 'mysql' ), 'posts' => [], 'kit' => [ 'id' => $kit_id, 'meta' => [] ], 'options' => [] ];
foreach ( get_posts( [ 'post_type' => [ 'page', 'elementor-hf', 'e_global_class' ], 'post_status' => 'any', 'numberposts' => -1 ] ) as $p ) {
	$snap['posts'][ $p->ID ] = [ 'post' => [ 'post_title' => $p->post_title, 'post_name' => $p->post_name, 'post_type' => $p->post_type, 'post_status' => $p->post_status, 'post_content' => $p->post_content ], 'meta' => get_post_meta( $p->ID ), 'lang' => function_exists( 'pll_get_post_language' ) ? pll_get_post_language( $p->ID ) : null ];
}
foreach ( [ '_elementor_page_settings', '_elementor_global_variables', '_elementor_global_classes_order', '_elementor_global_classes_labels', '_elementor_global_classes_post_ids' ] as $k ) { $snap['kit']['meta'][ $k ] = get_post_meta( $kit_id, $k, true ); }
foreach ( [ 'show_on_front', 'page_on_front' ] as $o ) { $snap['options'][ $o ] = get_option( $o ); }
$file = $dir . date( 'Y-m-d_His' ) . '.json';
file_put_contents( $file, wp_json_encode( $snap ) );
return [ 'file' => $file, 'posts' => count( $snap['posts'] ), 'size' => filesize( $file ) ];
```

- [ ] **Step 2: `restore.php`**

```php
<?php
// Edit the next line to the filename returned by snapshot.php (e.g. 2026-09-22_101500.json) before running.
$snapshot = '';
set_time_limit( 300 );
$snap = json_decode( file_get_contents( WP_CONTENT_DIR . '/novamira-sandbox/snapshots/' . $snapshot ), true );
if ( ! $snap ) { return [ 'error' => 'snapshot not found or invalid' ]; }
wp_set_current_user( 1 );
$out = [ 'restored' => 0, 'missing' => [] ];
foreach ( $snap['posts'] as $id => $rec ) {
	if ( ! get_post( $id ) ) { $out['missing'][] = $id; continue; }
	wp_update_post( array_merge( [ 'ID' => (int) $id ], $rec['post'] ) );
	foreach ( $rec['meta'] as $k => $vals ) { delete_post_meta( $id, $k ); foreach ( $vals as $v ) { add_post_meta( $id, $k, maybe_unserialize( $v ) ); } }
	if ( $rec['lang'] && function_exists( 'pll_set_post_language' ) ) { pll_set_post_language( $id, $rec['lang'] ); }
	$out['restored']++;
}
foreach ( $snap['kit']['meta'] as $k => $v ) { update_post_meta( $snap['kit']['id'], $k, $v ); }
foreach ( $snap['options'] as $o => $v ) { update_option( $o, $v ); }
\Elementor\Plugin::$instance->files_manager->clear_cache();
return $out;
```

- [ ] **Step 3: `verify.php`**

```php
<?php
set_time_limit( 300 );
$out = [];
$urls = [ home_url( '/' ), home_url( '/fr/' ) ];
foreach ( get_posts( [ 'post_type' => 'page', 'post_status' => 'publish', 'numberposts' => -1, 'lang' => '' ] ) as $p ) { $urls[] = get_permalink( $p->ID ); }
foreach ( array_unique( $urls ) as $u ) {
	$r = wp_remote_get( add_query_arg( 'v', time(), $u ), [ 'timeout' => 40, 'sslverify' => false ] );
	$body = is_wp_error( $r ) ? '' : wp_remote_retrieve_body( $r );
	$norm = preg_replace( [ '/\?v=\d+/', '/nonce":"[a-f0-9]+"/', '/ver=[a-f0-9.]+/', '/_wpnonce=[a-f0-9]+/' ], '', $body );
	$out[ $u ] = [ 'status' => is_wp_error( $r ) ? $r->get_error_message() : wp_remote_retrieve_response_code( $r ), 'hash' => sha1( $norm ), 'bytes' => strlen( $body ), 'has_header' => str_contains( $body, 'ehf-header' ), 'lang' => preg_match( '/<html[^>]*lang="([^"]+)"/', $body, $m ) ? $m[1] : null ];
}
return $out;
```

- [ ] **Step 4: Commit**

```bash
git add apps/landing-page/server/snapshot.php apps/landing-page/server/restore.php apps/landing-page/server/verify.php
git commit -m "feat(landing): snapshot, restore and verify scripts"
```

---

### Task 13: Skill, agent and scripts

**Files:**
- Create: `.claude/skills/elementor-v4-port/SKILL.md`
- Create: `.claude/skills/elementor-v4-port/references/v4-format.md`, `css-cheatsheet.md`, `pitfalls.md`, `worker-brief.md`, `poppynz.md`
- Create: `.claude/skills/elementor-v4-port/scripts/dump_design.sh`, `render.sh`, `push.sh`, `pack.sh`
- Create: `.claude/agents/page-builder.md`

**Interfaces:**
- Consumes: the old scripts at `/run/media/hbt/work/poppynz-landing-page/.opencode/skills/elementor-design-port/scripts/{dump_design.sh,render.sh,push.sh}` (copy, then edit as below), the spec's section 0 and the pitfalls learned in the spike.
- Produces: `pack.sh <build>` zips `json-artefacts/<build>/*`, `server/` and `theme/` into `$SCRATCH/poppynz-artefact.zip`; `push.sh <zip> <token> <site>`; `render.sh <url> <prefix>`; `dump_design.sh <file.html> <slug>` serving `apps/landing-page/design`.

- [ ] **Step 1: Copy and adapt the scripts**

```bash
mkdir -p .claude/skills/elementor-v4-port/scripts .claude/skills/elementor-v4-port/references
SRC=/run/media/hbt/work/poppynz-landing-page/.opencode/skills/elementor-design-port/scripts
cp $SRC/dump_design.sh $SRC/render.sh $SRC/push.sh .claude/skills/elementor-v4-port/scripts/
```

Edit `push.sh`: default site `https://staging.poppynz.com`. Edit `render.sh` and `dump_design.sh`: replace `${OPENCODE_SCRATCHPAD:-/tmp}` with `${CLAUDE_SCRATCHPAD:-${OPENCODE_SCRATCHPAD:-/tmp}}`. Edit `dump_design.sh` usage to take `<Page file.html> <slug>` and hard-code `DIR="$(git rev-parse --show-toplevel)/apps/landing-page/design"`.

`pack.sh`:

```bash
#!/usr/bin/env bash
# Zip one artefact build together with the server scripts and the child theme for upload.
# Usage: pack.sh <build-name> [out-zip]
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)/apps/landing-page"
BUILD="${1:?build name}"; OUT="${2:-${CLAUDE_SCRATCHPAD:-/tmp}/poppynz-artefact.zip}"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cp -r "$ROOT/json-artefacts/$BUILD/." "$STAGE/"
mkdir -p "$STAGE/server" "$STAGE/theme"
cp "$ROOT"/server/*.php "$STAGE/server/"
cp -r "$ROOT/theme/poppynz" "$STAGE/theme/"
rm -f "$OUT"; (cd "$STAGE" && zip -qr "$OUT" .)
echo "$OUT ($(du -h "$OUT" | cut -f1))"
```

- [ ] **Step 2: Write `SKILL.md`**

```markdown
---
name: elementor-v4-port
description: Build, import and verify Poppynz marketing pages as editable Elementor V4 (atomic) pages from the TypeScript builder in apps/landing-page, deploying the same artefact to staging and production through Novamira. Use whenever a landing/marketing page, header, footer or global class of poppynz.com must be built, changed, re-imported, compared with the design, or deployed.
---

# Elementor V4 port (Poppynz)

Read `references/poppynz.md` (site profile: MCP servers, versions, page map, what is live) and
`references/pitfalls.md` first. The spec is `docs/superpowers/specs/2026-09-21-elementor-v4-landing-harness-design.md`.

## Loop for a page

1. Render the design: `bash .claude/skills/elementor-v4-port/scripts/dump_design.sh "<page>.html" <key>`; Read the slices.
2. Content in `apps/landing-page/builder/src/content/<key>.ts` (en + fr), recipe in `recipes/<key>.ts`, register it in `cli.ts` `RECIPES`. Reuse classes from `classes.ts`; add a class only when two elements share it. `bun test && bun run build`.
3. Pack and push: `pack.sh current`, ability `novamira/create-upload-link` (`wp-content/novamira-sandbox/poppynz-artefact.zip`, overwrite), `push.sh`, then `server/unpack.php` and `server/import.php` through `novamira/execute-php` (first `<?php` line removed). The import aborts with the exact CSS declaration when something would be dropped: fix the CSS, rebuild, push again.
4. Verify: `server/verify.php`; `render.sh <url> wp-<key>`; compare slices with the design section by section, reading both as images. Then the editor check (`references/poppynz.md` § Editor check). Never press Update or Publish.
5. Commit builder changes and `json-artefacts/current` together. Record new IDs or decisions in `references/poppynz.md`.

## Rules

- No Pro features. Only V4 elements: `e-flexbox`, `e-div-block`, `e-grid`, `e-heading`, `e-paragraph`, `e-button`, `e-image`, `e-svg`, `e-self-hosted-video`.
- Styling only through `classes.ts` (global) or the `css:` map of an element (local). Keyframes only in the theme, via `anim-*` classes.
- CSS is flat declarations per breakpoint/state key. The builder lint and the importer enforce `references/css-cheatsheet.md`.
- Text through `html-v3`: inline tags only, no attributes except `a[href]`. Emphasis is `<em>` styled by the parent's class (`hl-wavy`, `em-accent`).
- Every element has an editor title. Links use `page:<key>` or an absolute URL.
- Deploy sequence and both sites: `references/poppynz.md` § Deploy.
```

- [ ] **Step 3: Write `references/v4-format.md`**

Copy the spec's section 0 bullets and add the element JSON example from the spike:

```markdown
# Elementor 4.2.4 V4 data format (verified on staging 2026-09-21)

Element: { id (7 hex), elType ("e-flexbox"|"e-div-block"|"e-grid"|"widget"), widgetType ("e-heading"|"e-paragraph"|"e-button"|"e-image"|"e-svg"|"e-self-hosted-video"), settings, styles, elements, editor_settings: {title}, version: "0.0", interactions? }

settings.classes = {"$$type":"classes","value":["<local style id>","<global label>"]}
settings.tag = {"$$type":"string","value":"section"}  (containers: div header section article aside footer a button; heading: h1..h6; paragraph: p span)
settings.title / paragraph / text = {"$$type":"html-v3","value":{"content":{"$$type":"string","value":"..."},"children":[]}}
settings.link = {"$$type":"link","value":{"destination":{"$$type":"url","value":"/x"},"isTargetBlank":{"$$type":"boolean","value":false},"tag":{"$$type":"string","value":"a"}}}
settings.svg = {"$$type":"svg-src","value":{"id":{"$$type":"image-attachment-id","value":9},"url":null}}
settings.image = {"$$type":"image","value":{"src":{"$$type":"image-src","value":{"id":{"$$type":"image-attachment-id","value":12},"url":null,"alt":{"$$type":"string","value":""}}},"size":{"$$type":"string","value":"full"}}}
settings.source (video) = {"$$type":"video-src","value":{"id":null,"url":{"$$type":"url","value":"https://..."}}}

styles = { "<id>": { id, type:"class", label:"local", variants:[ { meta:{breakpoint:"desktop"|"tablet"|"mobile", state:null|"hover"|"focus"|"active"}, props:{...} } ] } }
Local style id: e-<elementId>-<7hex>. Global class: e_global_class post, id g-<7hex>, HTML class = label, CSS `.elementor .<label>{}`.
Props are produced by Css_Converter::convert(css) on the server; never hand-write them.

Variables: kit meta _elementor_global_variables v2: {"data":{"e-gv-xxxxxxx":{"type":"global-color-variable","label":"sky","value":{"$$type":"color","value":"#37B5FF"},"order":1,...}},"watermark":N,"version":2}. Referenced as var(--label) in CSS; the converter emits {"$$type":"global-color-variable","value":"e-gv-..."}.

Interactions (Free: triggers load, scrollIn; effects fade, slide, scale): element.interactions = {"items":[{"$$type":"interaction-item","value":{"interaction_id":{"$$type":"string","value":"temp-..."},"trigger":{"$$type":"string","value":"scrollIn"},"animation":{"$$type":"animation-preset-props","value":{"effect":...,"type":{"$$type":"string","value":"in"},"direction":...,"timing_config":{"$$type":"timing-config","value":{"duration":{"$$type":"size","value":{"size":600,"unit":"ms"}},"delay":...}}}}}}],"version":1}

Save path: Plugin::$instance->documents->get($id)->save(['elements'=>..., 'settings'=>[...]]) with wp_set_current_user(1). Front-end CSS lands in uploads/elementor/css/{global,local}-<postid>-frontend-{desktop,mobile}.css; variables on the kit selector in post-<kit>.css.
```

- [ ] **Step 4: Write `references/css-cheatsheet.md`**

```markdown
# What the 4.2.4 converter does with CSS

Converted to props: width/height/min/max, padding, margin (shorthand and longhands), border-* (shorthand `border: 1.5px solid #x` ok), border-radius, background-color, background-image/size/position (via `background` shorthand or longhands), color, font-family/size/weight/style, line-height (unitless ok), letter-spacing, text-align, text-transform, text-decoration, display, flex-direction, flex-wrap, gap, justify-*, align-*, order, flex (grow/shrink/basis), grid-template-columns/rows (raw string), grid-column/row, position, inset-block-start/inset-inline-end/inset-block-end/inset-inline-start (also top/right/bottom/left -> converted to logical), z-index, overflow, opacity, object-fit, box-shadow, filter, backdrop-filter, transform, transform-origin, transition (duration kept, easing DROPPED), clamp()/min()/max() as custom sizes, var(--label) -> variable reference.

Dropped (lands in customCss, which Free strips): `font` shorthand, `inset` shorthand, `text-wrap`, `text-underline-offset`, `text-decoration-thickness`, descendant or pseudo-element selectors (impossible by construction).

Rejected: `animation`, `animation-*`. Use an `anim-*` class.

Breakpoints: desktop (base), tablet (<=1024), mobile (<=767). States: hover, focus, active as `desktop:hover`.
```

- [ ] **Step 5: Write `references/pitfalls.md`**

```markdown
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
```

- [ ] **Step 6: Write `references/poppynz.md`**

```markdown
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
```

- [ ] **Step 7: Write `references/worker-brief.md`**

```markdown
# Worker brief template (one page per worker)

You are building the "<Page title>" page (key `<key>`) of poppynz.com as an Elementor V4 page in EN and FR.
Read in order: .claude/skills/elementor-v4-port/SKILL.md, references/poppynz.md, references/pitfalls.md,
references/css-cheatsheet.md, apps/landing-page/builder/src/{classes.ts,dsl.ts,recipes/home.ts}.

Task
- Design source: apps/landing-page/design/<file>.html. Render it with dump_design.sh and Read the slices.
- Write content/<key>.ts (en + fr, same keys) and recipes/<key>.ts; register in cli.ts RECIPES.
- Reuse existing classes; add a class in classes.ts only when two or more elements share it, and name it after site.css.
- Run bun test, bun run build; pack, push, unpack, import (staging server), verify; render and compare; editor check.
- Earlier pages' JSON in json-artefacts/current must stay byte-identical unless you changed a shared class; explain any diff.
- Commit builder + artefact together.

Report: page URLs (en, fr) and post ids · import report summary (created/updated/unchanged) · render comparison findings
and remaining deviations · classes added · anything unfinished, stated plainly.
```

- [ ] **Step 8: Write `.claude/agents/page-builder.md`**

```markdown
---
name: page-builder
description: Builds one poppynz.com marketing page (both languages) as Elementor V4 from its design file using the elementor-v4-port skill, imports it to staging through Novamira, verifies it against the design and reports. Invoke with the page key and the brief from references/worker-brief.md.
tools: Read, Edit, Write, Bash, Grep, Glob, Skill, mcp__novamira-staging-poppynz__mcp-adapter-execute-ability, mcp__novamira-staging-poppynz__mcp-adapter-get-ability-info
---
You build ONE page key in EN and FR. Load the skill `elementor-v4-port` first and follow its loop.
Never touch pages you were not asked to build, never change server/*.php, never press Publish in the editor.
End with the report skeleton from references/worker-brief.md.
```

- [ ] **Step 9: Check the scripts run**

```bash
bash .claude/skills/elementor-v4-port/scripts/pack.sh current && bash .claude/skills/elementor-v4-port/scripts/dump_design.sh index.html home | head -3
```

Expected: a zip path with size, then `DOM: .../home-dom.txt` and slice paths.

- [ ] **Step 10: Commit**

```bash
git add .claude/skills/elementor-v4-port .claude/agents/page-builder.md
git commit -m "docs(landing): elementor-v4-port skill, references, scripts and page-builder agent"
```

---

### Task 14: Deploy header, footer and Home to staging and verify

**Files:**
- Modify: `.claude/skills/elementor-v4-port/references/poppynz.md` (record ids and results)
- Modify: `.claude/skills/elementor-v4-port/references/pitfalls.md` (anything new)
- Output: render slices in the scratchpad (not committed)

**Interfaces:**
- Consumes: `json-artefacts/current` (Task 8), `server/*.php` (Tasks 10 to 12), scripts (Task 13), the Novamira MCP tools `mcp__novamira-staging-poppynz__mcp-adapter-execute-ability` and `mcp__novamira-staging-poppynz__mcp-adapter-get-ability-info`, the built-in browser tools.
- Produces: staging serving `/` and `/fr/` with the V4 header, footer and Home; the profile updated.

- [ ] **Step 1: Build and pack**

```bash
cd apps/landing-page/builder && bun test && bun run build && cd ../../.. && bash .claude/skills/elementor-v4-port/scripts/pack.sh current
```

Expected: tests pass, zip path printed.

- [ ] **Step 2: Upload**

Call `mcp__novamira-staging-poppynz__mcp-adapter-execute-ability` with `ability_name: novamira/create-upload-link`, parameters `{"path":"wp-content/novamira-sandbox/poppynz-artefact.zip","overwrite":true}`. Then:

```bash
bash .claude/skills/elementor-v4-port/scripts/push.sh "$CLAUDE_SCRATCHPAD/poppynz-artefact.zip" <token> https://staging.poppynz.com
```

Expected: JSON with `"success":true` (or the file path) from the upload endpoint.

- [ ] **Step 3: Unpack, bootstrap, import**

For each of `server/unpack.php`, `server/bootstrap.php`, `server/import.php`: read the file, drop the first line, call `novamira/execute-php` with the rest as `code`.
Expected: `unpack.php` returns the six manifest entries. `bootstrap.php` reports every install as `present <version>` (staging was bootstrapped in the spike) and `theme.poppynz: copied`, `theme.active: switched to poppynz`, `kit.atomic_active: yes`, `polylang.en/fr: present`. `import.php` returns `created` for every media file, variable, class, template and page, and `urls.home.en.status: 200`, `urls.home.fr.status: 200`. If it throws with a CSS message, fix the CSS in `classes.ts` or the recipe, then repeat from Step 1.

- [ ] **Step 4: Run the import a second time**

Same `import.php` call. Expected: every entry `unchanged` (media, variables, classes) or `unchanged` (templates, pages). Any `updated` means the artefact or the importer is not deterministic; find the field that differs (compare `_elementor_data` before and after) and fix before continuing.

- [ ] **Step 5: verify.php**

Run `server/verify.php`. Expected: `https://staging.poppynz.com/` and `/fr/` status 200, `has_header: true`, `lang: en-CA` and `fr-CA` respectively.

- [ ] **Step 6: Render and compare**

```bash
bash .claude/skills/elementor-v4-port/scripts/dump_design.sh index.html home
bash .claude/skills/elementor-v4-port/scripts/render.sh https://staging.poppynz.com/ wp-home
bash .claude/skills/elementor-v4-port/scripts/render.sh https://staging.poppynz.com/fr/ wp-home-fr
```

Read each design slice and the matching WordPress slice as images. Check, section by section: header sticky bar with five links and the New badge, hero grid with video box and floating card, four step cards, three safety panels, eight service cards with illustrations and alternating tints, three tilted quotes, neighbourhood card with photo and city pills, navy helpers card, final CTA, footer columns and bottom bar. Mobile slices: single column everywhere, side padding 24px, header wraps. Fix deviations in classes or recipes, rebuild, re-import (Steps 1 to 3), re-render. Stop when the remaining differences are ones you can name and justify (for example the hero video poster) and list them in the report.

- [ ] **Step 7: Editor check and round-trip**

Get the Home EN post id from the import report. Call `novamira/create-admin-access-link` with `{"expires_in":600,"session_expires_in":3600,"admin_path":"post.php?post=<id>&action=elementor"}`, exchange with the returned curl example, open `login_url` with the built-in browser `navigate` within 60 seconds. In the editor: click the H1, Style tab, confirm chips `local` and `h1` and `hl-wavy`; select a service card, confirm `svc` (and `svc-pink` on alternating ones) and the Spacing values; select the CTA button, confirm `btn-primary`. Take a screenshot as evidence. Then make one real edit (append `!` to the CTA button text via the General tab), press Publish, and confirm with `execute-php` that `_elementor_data` for the post now contains `Find a helper!` and still contains the local style ids and interactions. Revert by re-running `import.php` (Step 3) and confirm the button text is back to the artefact's value. Close the browser tab.

- [ ] **Step 8: Record**

Update `references/poppynz.md`: post ids for header/footer templates and Home (en, fr), the attachment count, the date, and the named deviations. Add anything learned to `pitfalls.md`.

- [ ] **Step 9: Commit**

```bash
git add .claude/skills/elementor-v4-port/references apps/landing-page/json-artefacts/current apps/landing-page/builder
git commit -m "feat(landing): deploy header, footer and Home to staging; record profile"
```

---

## Self-review notes

- Spec coverage: sections 3 to 7 and 9 to 10 are implemented by Tasks 1 to 14. Section 8's blog templates and legal pages and section 5's FAQ items are deferred to Plan 2, as stated under "Out of scope". `menus.json` from the spec's artefact list is not produced: navigation is built into the header and footer templates, and the spec is amended accordingly.
- The `hl-wavy` and `em-accent` classes carry no props; the theme's `anim.css` styles the inner `em`. This is the one place where a class name is a hook for theme CSS, recorded in `pitfalls.md`.
- Every path in the builder that reaches the design source is `../../design/...` relative to `builder/src`.
