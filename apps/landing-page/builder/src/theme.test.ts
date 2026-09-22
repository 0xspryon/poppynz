import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { VARIABLES } from "./tokens";

/**
 * The blog index and article layouts are child-theme templates, not Elementor documents, so their
 * CSS cannot come from the V4 global classes and declares the design tokens itself. This test is
 * what keeps that copy honest: every custom property in `theme/poppynz/assets/blog.css` must carry
 * the exact value `tokens.ts` gives it, and every token must be there.
 */
const BLOG_CSS = resolve(import.meta.dir, "../../theme/poppynz/assets/blog.css");

function declaredTokens(css: string): Record<string, string> {
  const block = css.match(/\.pz-blog\s*\{([\s\S]*?)\}/);
  if (!block) throw new Error("blog.css: no .pz-blog token block");
  return Object.fromEntries([...block[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe("theme", () => {
  test("blog.css declares every tokens.ts variable, with the same value", () => {
    const declared = declaredTokens(readFileSync(BLOG_CSS, "utf8"));
    for (const v of VARIABLES) {
      expect(declared[v.label], `blog.css is missing --${v.label}`).toBeDefined();
      expect(declared[v.label]!.toUpperCase()).toBe(v.value.toUpperCase());
    }
  });

  test("blog.css invents no colour of its own: every hex is a token value", () => {
    const css = readFileSync(BLOG_CSS, "utf8");
    const known = new Set(VARIABLES.map((v) => v.value.toUpperCase()));
    const body = css.replace(/\.pz-blog\s*\{[\s\S]*?\}/, ""); // skip the token block itself
    for (const hex of body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      expect(known.has(hex.toUpperCase()), `blog.css uses ${hex}, which is not in tokens.ts`).toBe(true);
    }
  });

  test("blog.css is scoped, so it can never reach an Elementor page", () => {
    // Walk the braces so an @media's inner rules are checked and a @keyframes' step selectors
    // ("from", "50%") are skipped along with the at-rule that owns them.
    const css = readFileSync(BLOG_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const stack: string[] = [];
    let head = "";
    for (const ch of css) {
      if (ch === "{") {
        const prelude = head.trim();
        head = "";
        const insideKeyframes = stack.some((s) => s.startsWith("@keyframes"));
        stack.push(prelude);
        if (prelude.startsWith("@") || insideKeyframes) continue;
        for (const selector of prelude.split(",")) {
          expect(selector.trim().startsWith(".pz-blog"), `unscoped selector "${selector.trim()}"`).toBe(true);
        }
      } else if (ch === "}") {
        stack.pop();
        head = "";
      } else {
        head += ch;
      }
    }
  });
});
