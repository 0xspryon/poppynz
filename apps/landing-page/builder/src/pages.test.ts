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
