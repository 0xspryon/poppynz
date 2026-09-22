import { describe, expect, test } from "bun:test";
import { assertUniqueIds, block, button, collectCss, flex, grid, heading, svg, text, withDefaults } from "./dsl";

describe("dsl", () => {
  const h1 = heading("home/hero/h1", { title: "H1", tag: "h1", classes: ["h1"], text: "Your Family's <em>Perfect Helper</em>", interaction: { trigger: "load", effect: "slide", direction: "bottom" } });
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
  test("assertUniqueIds passes on valid tree", () => {
    expect(() => assertUniqueIds([root])).not.toThrow();
  });
  test("assertUniqueIds throws on duplicate element ids", () => {
    const a = text("dup", { title: "Dup A", text: "a" });
    const b = text("dup", { title: "Dup B", text: "b" });
    expect(() => assertUniqueIds([a, b])).toThrow(/duplicate element id/);
  });
});

describe("withDefaults (native base-style overrides)", () => {
  test("flex with no padding anywhere gets padding:0 prepended", () => {
    expect(withDefaults("flex", undefined, undefined)).toEqual({ desktop: "padding:0" });
  });
  test("flex with a class that sets padding (card) is left alone", () => {
    expect(withDefaults("flex", ["card"], undefined)).toBeUndefined();
  });
  test("block with no min-width anywhere gets min-width:0 and padding:0 prepended", () => {
    expect(withDefaults("block", undefined, undefined)).toEqual({ desktop: "min-width:0;padding:0" });
  });
  test("grid with no grid-template-rows anywhere gets grid-template-rows:auto and padding:0 prepended", () => {
    expect(withDefaults("grid", undefined, undefined)).toEqual({ desktop: "grid-template-rows:auto;padding:0" });
  });
  test("element whose own css already sets padding is left alone (other defaults still prepended)", () => {
    expect(withDefaults("flex", undefined, { desktop: "padding:24px" })).toEqual({ desktop: "padding:24px" });
    expect(withDefaults("grid", undefined, { desktop: "padding:24px;grid-template-columns:1fr 1fr" })).toEqual({
      desktop: "grid-template-rows:auto;padding:24px;grid-template-columns:1fr 1fr",
    });
  });
  test("block() and grid() constructors apply the defaults through local css", () => {
    const b = block("wd/block", { title: "Block" }, []);
    expect(b._css[(b.settings.classes as any).value[0]]).toEqual({ desktop: "min-width:0;padding:0" });
    const g = grid("wd/grid", { title: "Grid" }, []);
    expect(g._css[(g.settings.classes as any).value[0]]).toEqual({ desktop: "grid-template-rows:auto;padding:0" });
  });
  test("flex() with an explicit padding-bearing class (card) creates no local style at all", () => {
    const f = flex("wd/flex-card", { title: "Card", classes: ["card"] }, []);
    expect(Object.keys(f._css)).toHaveLength(0);
    expect((f.settings.classes as any).value).toEqual(["card"]);
  });
  test("a class that only sets padding-top (ftr-bottom) gets the other three sides zeroed, not padding-top", () => {
    expect(withDefaults("flex", ["ftr-bottom"], undefined)).toEqual({ desktop: "padding-right:0;padding-bottom:0;padding-left:0" });
  });
  test("own css with only padding-left set gets the other three sides zeroed", () => {
    expect(withDefaults("flex", undefined, { desktop: "padding-left:12px" })).toEqual({
      desktop: "padding-top:0;padding-right:0;padding-bottom:0;padding-left:12px",
    });
  });
  test("padding-inline shorthand covers left and right, leaving top/bottom zeroed", () => {
    expect(withDefaults("flex", undefined, { desktop: "padding-inline:12px" })).toEqual({
      desktop: "padding-top:0;padding-bottom:0;padding-inline:12px",
    });
  });
  // `_cssid` is what makes the legal pages' in-page anchors work: it is the only V4 setting that
  // renders a real `id` attribute (verified live on Elementor 4.2.4 for every element type).
  test("cssId is emitted as the _cssid setting", () => {
    const f = flex("wd/anchor", { title: "Section", tag: "section", cssId: "s3" }, []);
    expect(f.settings._cssid).toEqual({ $$type: "string", value: "s3" });
  });
  test("an element without cssId sets no _cssid", () => {
    expect(flex("wd/plain", { title: "Plain" }, []).settings._cssid).toBeUndefined();
  });
  test("cssId rejects a value that is not a valid HTML id", () => {
    expect(() => flex("wd/bad", { title: "Bad", cssId: "1s" }, [])).toThrow(/invalid element id/);
    expect(() => flex("wd/bad2", { title: "Bad", cssId: "a b" }, [])).toThrow(/invalid element id/);
  });
});
