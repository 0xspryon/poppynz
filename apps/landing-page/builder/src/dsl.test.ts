import { describe, expect, test } from "bun:test";
import { assertUniqueIds, button, collectCss, flex, heading, svg, text } from "./dsl";

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
