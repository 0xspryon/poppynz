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
