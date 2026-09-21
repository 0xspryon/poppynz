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
