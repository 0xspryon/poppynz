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
  test("pointer-events is banned (never expressible in V4)", () => {
    expect(lintCss("pointer-events:none")).toHaveLength(1);
  });
  test("per-side border-*-style is banned in favour of border-style + per-side border-*-width", () => {
    expect(lintCss("border-top-style:solid")).toHaveLength(1);
    expect(lintCss("border-right-style:solid")).toHaveLength(1);
    expect(lintCss("border-bottom-style:solid")).toHaveLength(1);
    expect(lintCss("border-left-style:solid")).toHaveLength(1);
    expect(lintCss("border-style:solid")).toEqual([]);
  });
  test("flex-grow/flex-shrink/flex-basis longhands are banned in favour of the flex shorthand", () => {
    expect(lintCss("flex-grow:1")).toHaveLength(1);
    expect(lintCss("flex-shrink:0")).toHaveLength(1);
    expect(lintCss("flex-basis:auto")).toHaveLength(1);
    expect(lintCss("flex:1 1 auto")).toEqual([]);
  });
  test("two-value gap is banned in favour of gap + column-gap", () => {
    expect(lintCss("gap:12px 24px")).toHaveLength(1);
    expect(lintCss("gap:12px")).toEqual([]);
    expect(lintCss("gap:12px;column-gap:24px")).toEqual([]);
  });
  test("unitless decimal opacity is banned in favour of a percentage", () => {
    expect(lintCss("opacity:.55")).toHaveLength(1);
    expect(lintCss("opacity:0.5")).toHaveLength(1);
    expect(lintCss("opacity:1")).toHaveLength(1);
    expect(lintCss("opacity:50%")).toEqual([]);
  });
  test("unitless zero angle in transform is banned in favour of an explicit unit", () => {
    expect(lintCss("transform:rotate(0)")).toHaveLength(1);
    expect(lintCss("transform:rotate(0) translateY(-4px)")).toHaveLength(1);
    expect(lintCss("transform:rotate(0deg)")).toEqual([]);
    expect(lintCss("transform:translateY(-4px)")).toEqual([]);
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
