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
  test("same-element modifier classes are declared before their base class", () => {
    // Elementor prints global classes to the compiled CSS bundle in REVERSED declaration order
    // (Atomic_Global_Styles::get_document_global_styles() does array_reverse() before building the
    // css), so for two classes applied to the same element with equal specificity, the one
    // declared LATER here is printed FIRST and loses any shared static property to the one
    // declared EARLIER. A modifier meant to override its base class's own properties (svc-pink
    // over svc's background/border-color, lang-on over lang-item's color, bubble-40/bubble-48
    // over bubble's width/height) must therefore sort before its base in Object.keys(CLASSES).
    const order = Object.keys(CLASSES);
    const idx = (label: string) => order.indexOf(label);
    expect(idx("svc-pink")).toBeLessThan(idx("svc"));
    expect(idx("lang-on")).toBeLessThan(idx("lang-item"));
    expect(idx("bubble-40")).toBeLessThan(idx("bubble"));
    expect(idx("bubble-48")).toBeLessThan(idx("bubble"));
    expect(idx("bubble-tint")).toBeLessThan(idx("bubble"));
    expect(idx("tint-blue")).toBeLessThan(idx("art-card"));
    expect(idx("tint-pink")).toBeLessThan(idx("art-card"));
  });
});
